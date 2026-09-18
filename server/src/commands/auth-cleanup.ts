import 'dotenv/config'

import { randomUUID } from 'node:crypto'

import { Client, type QueryResultRow } from 'pg'

export const AUTH_CLEANUP_BATCH_SIZE = 500

const AUTH_CLEANUP_LOCK_KEY = '7449355537723376177'
const AUTH_CLEANUP_STATEMENT_TIMEOUT = '5s'
const AUTH_CLEANUP_FAILURE_MESSAGE = 'Authentication cleanup failed'

// 候选集合必须先物化再删除。否则 PostgreSQL 可在 Nested Loop Semi Join 中
// 多次执行含 FOR UPDATE SKIP LOCKED 的 LIMIT 子查询，导致单批实际删除超过上限。
// 三类清理共用这一边界；排序、行锁、截止时间和每批事务语义保持一致。
const DELETE_EXPIRED_SESSIONS_SQL = `
  WITH "candidates" AS MATERIALIZED (
    SELECT "id"
    FROM "auth_sessions"
    WHERE LEAST(
      "idle_expires_at",
      "absolute_expires_at",
      COALESCE("revoked_at", 'infinity'::timestamptz)
    ) <= $1::timestamptz - INTERVAL '30 days'
    ORDER BY
      LEAST(
        "idle_expires_at",
        "absolute_expires_at",
        COALESCE("revoked_at", 'infinity'::timestamptz)
      ),
      "id"
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM "auth_sessions" AS "target"
  USING "candidates"
  WHERE "target"."id" = "candidates"."id"
`

const DELETE_STALE_RATE_LIMITS_SQL = `
  WITH "candidates" AS MATERIALIZED (
    SELECT "scope", "subject_key_hash"
    FROM "auth_rate_limits"
    WHERE "updated_at" <= $1::timestamptz - INTERVAL '7 days'
      AND (
        "blocked_until" IS NULL
        OR "blocked_until" <= $1::timestamptz
      )
    ORDER BY "updated_at", "scope", "subject_key_hash"
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM "auth_rate_limits" AS "target"
  USING "candidates"
  WHERE "target"."scope" = "candidates"."scope"
    AND "target"."subject_key_hash" = "candidates"."subject_key_hash"
`

const DELETE_EXPIRED_AUDIT_EVENTS_SQL = `
  WITH "candidates" AS MATERIALIZED (
    SELECT "id"
    FROM "audit_events"
    WHERE "occurred_at" <= $1::timestamptz - INTERVAL '365 days'
    ORDER BY "occurred_at", "id"
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM "audit_events" AS "target"
  USING "candidates"
  WHERE "target"."id" = "candidates"."id"
`

export interface AuthCleanupCounts {
  readonly authSessionsDeleted: number
  readonly authRateLimitsDeleted: number
  readonly auditEventsDeleted: number
}

export type AuthCleanupResult =
  | {
      readonly status: 'completed'
      readonly counts: AuthCleanupCounts
    }
  | {
      readonly status: 'skipped_already_running'
      readonly counts: AuthCleanupCounts
    }

interface AuthCleanupQueryResult<Row extends QueryResultRow> {
  readonly rows: Row[]
  readonly rowCount: number | null
}

/**
 * cleanup 必须独占一个 PostgreSQL backend；这个最小接口让单元测试能够验证
 * acquire、所有批次、release 与 disconnect 的完整生命周期，而不接触真实数据库。
 */
export interface AuthCleanupPgClient {
  connect(): Promise<void>
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<AuthCleanupQueryResult<Row>>
  end(): Promise<void>
}

export type AuthCleanupClientFactory = (
  connectionString: string,
) => AuthCleanupPgClient

export interface CleanupAuthenticationDataOptions {
  readonly connectionString: string
  readonly createClient?: AuthCleanupClientFactory
  readonly createAuditRequestId?: () => string
}

interface LockRow extends QueryResultRow {
  backendPid: number
  lockAcquired: boolean
}

interface CutoffRow extends QueryResultRow {
  backendPid: number
  cutoff: Date
}

interface UnlockRow extends QueryResultRow {
  backendPid: number
  lockReleased: boolean
}

type MutableAuthCleanupCounts = {
  -readonly [Key in keyof AuthCleanupCounts]: AuthCleanupCounts[Key]
}

type CleanupCountKey = keyof MutableAuthCleanupCounts

class DedicatedAuthCleanupPgClient implements AuthCleanupPgClient {
  private readonly client: Client

  constructor(connectionString: string) {
    // 不能使用 Pool 或 Prisma：session-level advisory lock 只属于取得它的
    // PostgreSQL backend，整轮清理必须由这个专用 Client 持有同一连接。
    this.client = new Client({
      connectionString,
      connectionTimeoutMillis: 5_000,
    })
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<AuthCleanupQueryResult<Row>> {
    return this.client.query<Row>(text, [...values])
  }

  async end(): Promise<void> {
    await this.client.end()
  }
}

export class AuthCleanupExecutionError extends Error {
  readonly committedCounts: AuthCleanupCounts

  constructor(committedCounts: AuthCleanupCounts) {
    super(AUTH_CLEANUP_FAILURE_MESSAGE)
    this.name = 'AuthCleanupExecutionError'
    // 错误只携带已提交的稳定计数，不保留驱动错误、SQL 参数或连接信息。
    this.committedCounts = Object.freeze({ ...committedCounts })
  }
}

function createDedicatedClient(
  connectionString: string,
): AuthCleanupPgClient {
  return new DedicatedAuthCleanupPgClient(connectionString)
}

function emptyCounts(): MutableAuthCleanupCounts {
  return {
    authSessionsDeleted: 0,
    authRateLimitsDeleted: 0,
    auditEventsDeleted: 0,
  }
}

function safeCounts(counts: AuthCleanupCounts): AuthCleanupCounts {
  return Object.freeze({ ...counts })
}

function isBackendPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function requireSingleRow<Row extends QueryResultRow>(
  rows: readonly Row[],
): Row {
  if (rows.length !== 1) {
    throw new Error(AUTH_CLEANUP_FAILURE_MESSAGE)
  }

  return rows[0]
}

async function acquireCleanupLock(
  client: AuthCleanupPgClient,
): Promise<LockRow> {
  const result = await client.query<LockRow>(
    `
      SELECT
        pg_backend_pid() AS "backendPid",
        pg_try_advisory_lock($1::bigint) AS "lockAcquired"
    `,
    [AUTH_CLEANUP_LOCK_KEY],
  )
  const row = requireSingleRow(result.rows)

  if (
    !isBackendPid(row.backendPid) ||
    typeof row.lockAcquired !== 'boolean'
  ) {
    throw new Error(AUTH_CLEANUP_FAILURE_MESSAGE)
  }

  return row
}

async function readFixedCutoff(
  client: AuthCleanupPgClient,
  lockBackendPid: number,
): Promise<Date> {
  const result = await client.query<CutoffRow>(`
    SELECT
      pg_backend_pid() AS "backendPid",
      clock_timestamp() AS "cutoff"
  `)
  const row = requireSingleRow(result.rows)

  if (
    row.backendPid !== lockBackendPid ||
    !(row.cutoff instanceof Date) ||
    Number.isNaN(row.cutoff.getTime())
  ) {
    throw new Error(AUTH_CLEANUP_FAILURE_MESSAGE)
  }

  return row.cutoff
}

async function releaseCleanupLock(
  client: AuthCleanupPgClient,
  lockBackendPid: number,
): Promise<void> {
  const result = await client.query<UnlockRow>(
    `
      SELECT
        pg_backend_pid() AS "backendPid",
        pg_advisory_unlock($1::bigint) AS "lockReleased"
    `,
    [AUTH_CLEANUP_LOCK_KEY],
  )
  const row = requireSingleRow(result.rows)

  if (row.backendPid !== lockBackendPid || row.lockReleased !== true) {
    throw new Error(AUTH_CLEANUP_FAILURE_MESSAGE)
  }
}

async function rollbackQuietly(client: AuthCleanupPgClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // 连接异常时 rollback 也可能失败；外层仍需继续释放 advisory lock 并断开。
  }
}

async function deleteOneBatch(
  client: AuthCleanupPgClient,
  sql: string,
  cutoff: Date,
): Promise<number> {
  await client.query('BEGIN')

  try {
    // statement_timeout 使用 transaction-local 配置，COMMIT/ROLLBACK 后不会污染
    // 后续批次；每个批次都是独立事务，失败只重试尚未确认提交的部分。
    await client.query(
      `SELECT set_config('statement_timeout', $1, true)`,
      [AUTH_CLEANUP_STATEMENT_TIMEOUT],
    )
    const result = await client.query(sql, [
      cutoff,
      AUTH_CLEANUP_BATCH_SIZE,
    ])
    const deletedCount = result.rowCount

    if (
      deletedCount === null ||
      !Number.isSafeInteger(deletedCount) ||
      deletedCount < 0 ||
      deletedCount > AUTH_CLEANUP_BATCH_SIZE
    ) {
      throw new Error(AUTH_CLEANUP_FAILURE_MESSAGE)
    }

    await client.query('COMMIT')
    return deletedCount
  } catch {
    await rollbackQuietly(client)
    throw new Error(AUTH_CLEANUP_FAILURE_MESSAGE)
  }
}

async function deleteInBatches(
  client: AuthCleanupPgClient,
  sql: string,
  cutoff: Date,
  counts: MutableAuthCleanupCounts,
  countKey: CleanupCountKey,
): Promise<void> {
  let deletedCount: number

  do {
    deletedCount = await deleteOneBatch(client, sql, cutoff)
    // deleteOneBatch 只有在 COMMIT 成功返回后才会触达这里，因此统计不会包含
    // rollback、超时或提交结果未知的批次。
    counts[countKey] += deletedCount
  } while (deletedCount === AUTH_CLEANUP_BATCH_SIZE)
}

function createCleanupAuditRequestId(): string {
  return `cleanup:${randomUUID()}`
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
}

function validateCleanupAuditRequestId(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || Array.from(value).length > 64
    || containsControlCharacter(value)
  ) {
    throw new Error(AUTH_CLEANUP_FAILURE_MESSAGE)
  }

  return value
}

/**
 * 只有三类删除批次全部提交后才写成功 Audit。Audit 自身使用独立短事务；写入失败
 * 会让命令非零退出，但绝不会把 skip 或中途失败伪造成成功清理。
 */
async function recordCleanupAudit(
  client: AuthCleanupPgClient,
  counts: AuthCleanupCounts,
  requestId: string,
): Promise<void> {
  await client.query('BEGIN')

  try {
    await client.query(
      `SELECT set_config('statement_timeout', $1, true)`,
      [AUTH_CLEANUP_STATEMENT_TIMEOUT],
    )
    await client.query(
      `
        INSERT INTO "audit_events" (
          "event_type",
          "outcome",
          "actor_type",
          "target_type",
          "request_id",
          "metadata"
        )
        VALUES (
          'AUTH_RETENTION_PURGED',
          'SUCCESS',
          'SYSTEM',
          'AuthenticationRetention',
          $1,
          $2::jsonb
        )
      `,
      [
        requestId,
        JSON.stringify({
          authRecordsDeleted: counts.authSessionsDeleted,
          rateLimitRecordsDeleted: counts.authRateLimitsDeleted,
          auditRecordsDeleted: counts.auditEventsDeleted,
        }),
      ],
    )
    await client.query('COMMIT')
  } catch {
    await rollbackQuietly(client)
    throw new Error(AUTH_CLEANUP_FAILURE_MESSAGE)
  }
}

/**
 * 使用一个专用 pg Client 完成认证保留数据清理。
 *
 * cutoff 只读取一次并复用于全部批次，避免长时间任务中保留边界不断移动。
 */
export async function cleanupAuthenticationData(
  options: CleanupAuthenticationDataOptions,
): Promise<AuthCleanupResult> {
  const client = (options.createClient ?? createDedicatedClient)(
    options.connectionString,
  )
  const counts = emptyCounts()
  let lockBackendPid: number | undefined
  let result: AuthCleanupResult | undefined
  let executionError: AuthCleanupExecutionError | undefined

  try {
    await client.connect()
    const lock = await acquireCleanupLock(client)

    if (!lock.lockAcquired) {
      result = {
        status: 'skipped_already_running',
        counts: safeCounts(counts),
      }
    } else {
      lockBackendPid = lock.backendPid
      const cutoff = await readFixedCutoff(client, lockBackendPid)

      await deleteInBatches(
        client,
        DELETE_EXPIRED_SESSIONS_SQL,
        cutoff,
        counts,
        'authSessionsDeleted',
      )
      await deleteInBatches(
        client,
        DELETE_STALE_RATE_LIMITS_SQL,
        cutoff,
        counts,
        'authRateLimitsDeleted',
      )
      await deleteInBatches(
        client,
        DELETE_EXPIRED_AUDIT_EVENTS_SQL,
        cutoff,
        counts,
        'auditEventsDeleted',
      )

      const auditRequestId = validateCleanupAuditRequestId(
        (options.createAuditRequestId ?? createCleanupAuditRequestId)(),
      )
      await recordCleanupAudit(client, counts, auditRequestId)

      result = { status: 'completed', counts: safeCounts(counts) }
    }
  } catch {
    executionError = new AuthCleanupExecutionError(counts)
  } finally {
    let releaseFailed = false

    if (lockBackendPid !== undefined) {
      try {
        await releaseCleanupLock(client, lockBackendPid)
      } catch {
        releaseFailed = true
      }
    }

    try {
      await client.end()
    } catch {
      releaseFailed = true
    }

    if (releaseFailed && executionError === undefined) {
      executionError = new AuthCleanupExecutionError(counts)
    }
  }

  if (executionError !== undefined) {
    throw executionError
  }

  if (result === undefined) {
    throw new AuthCleanupExecutionError(counts)
  }

  return result
}

interface AuthCleanupOutput {
  log(message: string): void
  error(message: string): void
}

type AuthCleanupRunner = () => Promise<AuthCleanupResult>

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AuthCleanupExecutionError(emptyCounts())
  }

  return value.trim()
}

async function runDefaultCleanup(): Promise<AuthCleanupResult> {
  return cleanupAuthenticationData({
    connectionString: requireDatabaseUrl(),
  })
}

function cleanupMetric(
  status: AuthCleanupResult['status'] | 'failed',
  counts: AuthCleanupCounts,
  durationMs: number,
): string {
  return JSON.stringify({
    kind: 'metric',
    metric: 'auth_cleanup',
    status,
    durationMs,
    ...counts,
  })
}

function readMonotonicTime(clock: () => number): number | null {
  try {
    const value = clock()
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function cleanupDuration(
  startedAt: number | null,
  clock: () => number,
): number {
  const completedAt = readMonotonicTime(clock)
  if (startedAt === null || completedAt === null) {
    return 0
  }

  return Math.round(Math.max(0, completedAt - startedAt) * 1_000) / 1_000
}

export async function runAuthCleanupCli(
  cleanup: AuthCleanupRunner = runDefaultCleanup,
  output: AuthCleanupOutput = console,
  monotonicNow: () => number = () => performance.now(),
): Promise<void> {
  const startedAt = readMonotonicTime(monotonicNow)

  try {
    const result = await cleanup()
    output.log(cleanupMetric(
      result.status,
      result.counts,
      cleanupDuration(startedAt, monotonicNow),
    ))
  } catch (error) {
    const counts =
      error instanceof AuthCleanupExecutionError
        ? error.committedCounts
        : emptyCounts()

    // CLI 只输出固定枚举与已提交计数；原始异常、连接串、SQL 和参数均不进入日志。
    output.error(cleanupMetric(
      'failed',
      counts,
      cleanupDuration(startedAt, monotonicNow),
    ))
    process.exitCode = 1
  }
}

// 被测试或其他工具导入时不得执行；仅直接运行编译产物才启动清理。
if (require.main === module) {
  void runAuthCleanupCli()
}
