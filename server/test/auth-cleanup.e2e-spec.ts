import { randomBytes, randomUUID } from 'node:crypto'

import { Client, type QueryResultRow } from 'pg'

import {
  AUTH_CLEANUP_BATCH_SIZE,
  AuthCleanupExecutionError,
  type AuthCleanupPgClient,
  cleanupAuthenticationData,
} from '../src/commands/auth-cleanup'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
const FIXED_CUTOFF_MARGIN_MILLISECONDS = 250
const FIXED_CUTOFF_DELAY_MILLISECONDS = 600
const BATCH_FAILURE_STATEMENT_TIMEOUT = '30s'
const TEST_PREFIX = `cln-${randomUUID()}`

jest.setTimeout(30_000)

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL

  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }

  return value
}

function offsetDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MILLISECONDS)
}

function offsetMilliseconds(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
}

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve() {
      resolvePromise?.()
    },
  }
}

interface CleanupClientHooks {
  readonly afterCutoff?: (cutoff: Date) => Promise<void>
  readonly beforeSessionDelete?: (invocation: number) => Promise<void>
  readonly observedDeleteCutoffs?: Date[]
  readonly observedStatementTimeouts?: string[]
  readonly statementTimeoutOverride?: string
}

/**
 * 仍使用真实 `pg.Client` 和真实 PostgreSQL，只在测试边界增加确定性的暂停或故障点。
 * 这样可验证锁与事务语义，同时避免为 E2E 在生产 CLI 中加入测试开关。
 */
class HookedCleanupClient implements AuthCleanupPgClient {
  private readonly client: Client
  private sessionDeleteInvocation = 0

  constructor(
    connectionString: string,
    private readonly hooks: CleanupClientHooks,
  ) {
    this.client = new Client({ connectionString })
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    const normalizedSql = text.replace(/\s+/gu, ' ').trim()
    const isStatementTimeoutConfiguration = normalizedSql.includes(
      "set_config('statement_timeout'",
    )
    const forwardedValues = [...values]

    // 该覆盖只属于测试 Client，用于确保“大批次已提交、第二批失败”场景命中
    // 预定 failpoint；生产 Client 仍由单元测试锁定为 5s。
    if (
      isStatementTimeoutConfiguration &&
      this.hooks.statementTimeoutOverride !== undefined
    ) {
      forwardedValues[0] = this.hooks.statementTimeoutOverride
    }
    if (
      isStatementTimeoutConfiguration &&
      typeof forwardedValues[0] === 'string'
    ) {
      this.hooks.observedStatementTimeouts?.push(forwardedValues[0])
    }

    if (
      normalizedSql.startsWith('DELETE FROM "auth_sessions"') &&
      this.hooks.beforeSessionDelete
    ) {
      this.sessionDeleteInvocation += 1
      await this.hooks.beforeSessionDelete(this.sessionDeleteInvocation)
    }

    const result = await this.client.query<Row>(text, forwardedValues)

    if (normalizedSql.startsWith('DELETE FROM')) {
      const cutoff = values[0]
      if (cutoff instanceof Date) {
        this.hooks.observedDeleteCutoffs?.push(cutoff)
      }
    }

    if (
      normalizedSql.includes('clock_timestamp() AS "cutoff"') &&
      this.hooks.afterCutoff
    ) {
      const cutoff: unknown = Reflect.get(result.rows[0] ?? {}, 'cutoff')
      if (!(cutoff instanceof Date)) {
        throw new Error('Cleanup E2E cutoff was invalid')
      }
      await this.hooks.afterCutoff(cutoff)
    }

    return result
  }

  async end(): Promise<void> {
    await this.client.end()
  }
}

describe('auth cleanup against isolated PostgreSQL', () => {
  const databaseUrl = requireDatabaseUrl()
  const createdUserIds: string[] = []
  const rateLimitHashes: Buffer[] = []
  let controlClient: Client

  beforeAll(async () => {
    controlClient = new Client({ connectionString: databaseUrl })
    await controlClient.connect()
  })

  afterEach(async () => {
    await controlClient.query(
      `DELETE FROM audit_events WHERE request_id LIKE $1`,
      [`${TEST_PREFIX}-%`],
    )

    for (const subjectHash of rateLimitHashes.splice(0)) {
      await controlClient.query(
        `DELETE FROM auth_rate_limits WHERE subject_key_hash = $1`,
        [subjectHash],
      )
    }

    const userIds = createdUserIds.splice(0)
    if (userIds.length > 0) {
      await controlClient.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[])`,
        [userIds],
      )
    }
  })

  afterAll(async () => {
    await controlClient.end()
  })

  async function databaseNow(): Promise<Date> {
    const result = await controlClient.query<{ databaseNow: Date }>(
      `SELECT clock_timestamp() AS "databaseNow"`,
    )
    const value = result.rows[0]?.databaseNow

    if (!(value instanceof Date)) {
      throw new Error('Cleanup E2E database clock was invalid')
    }

    return value
  }

  async function createUser(label: string): Promise<string> {
    const username = `${TEST_PREFIX}-${label}-${randomUUID()}`
    const result = await controlClient.query<{ id: string }>(
      `
        WITH created_user AS (
          INSERT INTO users (
            username,
            username_normalized,
            display_name,
            password_hash,
            password_changed_at,
            updated_at
          )
          VALUES ($1, $1, 'Cleanup E2E', 'test-only-hash', clock_timestamp(), clock_timestamp())
          RETURNING id
        )
        INSERT INTO user_profiles (user_id)
        SELECT id FROM created_user
        RETURNING user_id AS id
      `,
      [username],
    )
    const userId = result.rows[0]?.id

    if (!userId) {
      throw new Error('Cleanup E2E user was not created')
    }

    createdUserIds.push(userId)
    return userId
  }

  async function createSession(input: {
    userId: string
    createdAt: Date
    idleExpiresAt: Date
    absoluteExpiresAt: Date
    revokedAt?: Date
  }): Promise<string> {
    const result = await controlClient.query<{ id: string }>(
      `
        INSERT INTO auth_sessions (
          user_id,
          token_hash,
          auth_version,
          created_at,
          last_activity_at,
          idle_expires_at,
          absolute_expires_at,
          revoked_at,
          revoked_reason
        )
        VALUES (
          $1,
          $2,
          0,
          $3,
          $3,
          $4,
          $5,
          $6,
          CASE WHEN $6::timestamptz IS NULL THEN NULL ELSE 'LOGOUT'::session_revoked_reason END
        )
        RETURNING id
      `,
      [
        input.userId,
        randomBytes(32),
        input.createdAt,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.revokedAt ?? null,
      ],
    )
    const sessionId = result.rows[0]?.id

    if (!sessionId) {
      throw new Error('Cleanup E2E session was not created')
    }

    return sessionId
  }

  async function createRateLimit(input: {
    updatedAt: Date
    blockedUntil?: Date
  }): Promise<Buffer> {
    const subjectHash = randomBytes(32)
    rateLimitHashes.push(subjectHash)
    await controlClient.query(
      `
        INSERT INTO auth_rate_limits (
          scope,
          subject_key_hash,
          bucket_started_at,
          attempt_count,
          blocked_until,
          updated_at
        )
        VALUES ('LOGIN_IP', $1, $2, 1, $3, $2)
      `,
      [subjectHash, input.updatedAt, input.blockedUntil ?? null],
    )
    return subjectHash
  }

  async function createAuditEvent(
    label: string,
    occurredAt: Date,
  ): Promise<string> {
    const requestId = `${TEST_PREFIX}-${label}`
    const result = await controlClient.query<{ id: string }>(
      `
        INSERT INTO audit_events (
          event_type,
          outcome,
          occurred_at,
          actor_type,
          request_id,
          metadata
        )
        VALUES (
          'AUTH_RETENTION_PURGED',
          'SUCCESS',
          $1,
          'SYSTEM',
          $2,
          '{}'::jsonb
        )
        RETURNING id
      `,
      [occurredAt, requestId],
    )
    const auditEventId = result.rows[0]?.id

    if (!auditEventId) {
      throw new Error('Cleanup E2E audit event was not created')
    }

    return auditEventId
  }

  async function existingIds(
    table: 'auth_sessions' | 'audit_events',
    ids: readonly string[],
  ): Promise<string[]> {
    const result = await controlClient.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [ids],
    )
    return result.rows.map(({ id }) => id)
  }

  it('uses one fixed cutoff for idle, absolute, revoke, rate-limit and audit retention', async () => {
    const now = await databaseNow()
    const userId = await createUser('retention')
    const createdAt = offsetDays(now, -40)
    const idleExpiredId = await createSession({
      userId,
      createdAt,
      idleExpiresAt: offsetDays(now, -31),
      absoluteExpiresAt: offsetDays(now, -10),
    })
    const absoluteExpiredId = await createSession({
      userId,
      createdAt,
      idleExpiresAt: offsetDays(now, -31),
      absoluteExpiresAt: offsetDays(now, -31),
    })
    const revokedEarlyId = await createSession({
      userId,
      createdAt,
      idleExpiresAt: offsetDays(now, -10),
      absoluteExpiresAt: offsetDays(now, -10),
      revokedAt: offsetDays(now, -31),
    })
    const expiredThenRevokedId = await createSession({
      userId,
      createdAt,
      idleExpiresAt: offsetDays(now, -31),
      absoluteExpiresAt: offsetDays(now, -10),
      revokedAt: offsetDays(now, -1),
    })
    const recentSessionId = await createSession({
      userId,
      createdAt,
      idleExpiresAt: offsetDays(now, -29),
      absoluteExpiresAt: offsetDays(now, -10),
    })

    const staleRateHash = await createRateLimit({
      updatedAt: offsetDays(now, -8),
    })
    const expiredBlockHash = await createRateLimit({
      updatedAt: offsetDays(now, -8),
      blockedUntil: offsetDays(now, -1),
    })
    const activeBlockHash = await createRateLimit({
      updatedAt: offsetDays(now, -8),
      blockedUntil: offsetDays(now, 1),
    })
    const recentRateHash = await createRateLimit({
      updatedAt: offsetDays(now, -6),
    })

    const oldAuditId = await createAuditEvent('old-audit', offsetDays(now, -366))
    const recentAuditId = await createAuditEvent(
      'recent-audit',
      offsetDays(now, -364),
    )
    const observedDeleteCutoffs: Date[] = []
    let boundarySessionId = ''
    let fixedCutoffSessionId = ''
    let capturedCutoff: Date | undefined
    const purgeRequestId = `${TEST_PREFIX}-purge`

    const result = await cleanupAuthenticationData({
      connectionString: databaseUrl,
      createAuditRequestId: () => purgeRequestId,
      createClient: (connectionString) =>
        new HookedCleanupClient(connectionString, {
          observedDeleteCutoffs,
          async afterCutoff(cutoff) {
            capturedCutoff = cutoff
            boundarySessionId = await createSession({
              userId,
              createdAt,
              idleExpiresAt: offsetDays(cutoff, -30),
              absoluteExpiresAt: offsetDays(cutoff, -10),
            })
            fixedCutoffSessionId = await createSession({
              userId,
              createdAt,
              idleExpiresAt: offsetMilliseconds(
                offsetDays(cutoff, -30),
                FIXED_CUTOFF_MARGIN_MILLISECONDS,
              ),
              absoluteExpiresAt: offsetDays(cutoff, -10),
            })
            await wait(FIXED_CUTOFF_DELAY_MILLISECONDS)
          },
        }),
    })

    expect(result).toEqual({
      status: 'completed',
      counts: {
        authSessionsDeleted: 5,
        authRateLimitsDeleted: 2,
        auditEventsDeleted: 1,
      },
    })
    const purgeAudit = await controlClient.query<{
      actorType: string
      eventType: string
      metadata: Record<string, number>
      outcome: string
    }>(
      `
        SELECT
          actor_type AS "actorType",
          event_type AS "eventType",
          metadata,
          outcome
        FROM audit_events
        WHERE request_id = $1
      `,
      [purgeRequestId],
    )
    expect(purgeAudit.rows).toEqual([{
      actorType: 'SYSTEM',
      eventType: 'AUTH_RETENTION_PURGED',
      metadata: {
        authRecordsDeleted: 5,
        rateLimitRecordsDeleted: 2,
        auditRecordsDeleted: 1,
      },
      outcome: 'SUCCESS',
    }])
    expect(capturedCutoff).toBeInstanceOf(Date)
    expect(observedDeleteCutoffs).toHaveLength(3)
    expect(
      observedDeleteCutoffs.every(
        (value) => value.getTime() === capturedCutoff?.getTime(),
      ),
    ).toBe(true)

    await expect(
      existingIds('auth_sessions', [
        idleExpiredId,
        absoluteExpiredId,
        revokedEarlyId,
        expiredThenRevokedId,
        recentSessionId,
        boundarySessionId,
        fixedCutoffSessionId,
      ]),
    ).resolves.toEqual(
      [recentSessionId, fixedCutoffSessionId].sort(),
    )

    const fixedCutoffState = await controlClient.query<{
      eligibleAtCurrentDatabaseTime: boolean
    }>(
      `
        SELECT
          LEAST(
            idle_expires_at,
            absolute_expires_at,
            COALESCE(revoked_at, 'infinity'::timestamptz)
          ) <= clock_timestamp() - INTERVAL '30 days'
            AS "eligibleAtCurrentDatabaseTime"
        FROM auth_sessions
        WHERE id = $1
      `,
      [fixedCutoffSessionId],
    )
    expect(
      fixedCutoffState.rows[0]?.eligibleAtCurrentDatabaseTime,
    ).toBe(true)

    const rateLimitStates: boolean[] = []
    // `pg.Client` 是单连接；测试控制连接也保持串行，避免用客户端查询队列
    // 掩盖被测 cleanup 专用连接的真实并发行为。
    for (const subjectHash of [
      staleRateHash,
      expiredBlockHash,
      activeBlockHash,
      recentRateHash,
    ]) {
      const stored = await controlClient.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM auth_rate_limits
            WHERE subject_key_hash = $1
          ) AS "exists"
        `,
        [subjectHash],
      )
      rateLimitStates.push(stored.rows[0]?.exists ?? false)
    }
    expect(rateLimitStates).toEqual([false, false, true, true])
    await expect(
      existingIds('audit_events', [oldAuditId, recentAuditId]),
    ).resolves.toEqual([recentAuditId])
  })

  it('commits full batches, releases the lock after failure and continues on retry', async () => {
    const userId = await createUser('batch-failure')
    const tokenSeed = randomUUID()
    const deleteInvocations: number[] = []
    const observedStatementTimeouts: string[] = []
    await controlClient.query(
      `
        INSERT INTO auth_sessions (
          user_id,
          token_hash,
          auth_version,
          created_at,
          last_activity_at,
          idle_expires_at,
          absolute_expires_at
        )
        SELECT
          $1,
          decode(md5($2 || ':' || "sequence"::text), 'hex')
            || decode(md5($2 || ':second:' || "sequence"::text), 'hex'),
          0,
          clock_timestamp() - INTERVAL '40 days',
          clock_timestamp() - INTERVAL '32 days',
          clock_timestamp() - INTERVAL '31 days',
          clock_timestamp() - INTERVAL '30 days 12 hours'
        FROM generate_series(1, $3::integer) AS "generated"("sequence")
      `,
      [userId, tokenSeed, AUTH_CLEANUP_BATCH_SIZE + 1],
    )

    const failure = await cleanupAuthenticationData({
      connectionString: databaseUrl,
      createAuditRequestId: () => `${TEST_PREFIX}-failed`,
      createClient: (connectionString) =>
        new HookedCleanupClient(connectionString, {
          beforeSessionDelete(invocation) {
            deleteInvocations.push(invocation)
            if (invocation === 2) {
              return Promise.reject(
                new Error('Injected cleanup batch failure'),
              )
            }
            return Promise.resolve()
          },
          observedStatementTimeouts,
          statementTimeoutOverride: BATCH_FAILURE_STATEMENT_TIMEOUT,
        }),
    }).catch((error: unknown) => error)

    expect(deleteInvocations).toEqual([1, 2])
    expect(observedStatementTimeouts).toEqual([
      BATCH_FAILURE_STATEMENT_TIMEOUT,
      BATCH_FAILURE_STATEMENT_TIMEOUT,
    ])
    expect(failure).toBeInstanceOf(AuthCleanupExecutionError)
    expect(failure).toMatchObject({
      message: 'Authentication cleanup failed',
      committedCounts: {
        authSessionsDeleted: AUTH_CLEANUP_BATCH_SIZE,
        authRateLimitsDeleted: 0,
        auditEventsDeleted: 0,
      },
    })
    const afterFailure = await controlClient.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM auth_sessions WHERE user_id = $1`,
      [userId],
    )
    expect(afterFailure.rows[0]?.count).toBe('1')

    await expect(
      cleanupAuthenticationData({
        connectionString: databaseUrl,
        createAuditRequestId: () => `${TEST_PREFIX}-retry`,
      }),
    ).resolves.toEqual({
      status: 'completed',
      counts: {
        authSessionsDeleted: 1,
        authRateLimitsDeleted: 0,
        auditEventsDeleted: 0,
      },
    })
    const afterRetry = await controlClient.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM auth_sessions WHERE user_id = $1`,
      [userId],
    )
    expect(afterRetry.rows[0]?.count).toBe('0')
  }, 60_000)

  it('allows only one of two concurrent cleanup instances to execute deletion', async () => {
    const now = await databaseNow()
    const userId = await createUser('concurrent')
    await createSession({
      userId,
      createdAt: offsetDays(now, -40),
      idleExpiresAt: offsetDays(now, -31),
      absoluteExpiresAt: offsetDays(now, -10),
    })
    const firstHasLock = createDeferred()
    const releaseFirst = createDeferred()
    const firstCleanup = cleanupAuthenticationData({
      connectionString: databaseUrl,
      createAuditRequestId: () => `${TEST_PREFIX}-first`,
      createClient: (connectionString) =>
        new HookedCleanupClient(connectionString, {
          async afterCutoff() {
            firstHasLock.resolve()
            await releaseFirst.promise
          },
        }),
    })

    const acquiredBeforeFirstSettled = await Promise.race([
      firstHasLock.promise.then(() => true),
      firstCleanup.then(
        () => false,
        () => false,
      ),
    ])
    expect(acquiredBeforeFirstSettled).toBe(true)

    let secondResult: Awaited<ReturnType<typeof cleanupAuthenticationData>> | undefined
    let secondFailed = false
    try {
      secondResult = await cleanupAuthenticationData({
        connectionString: databaseUrl,
        createAuditRequestId: () => `${TEST_PREFIX}-second`,
      })
    } catch {
      secondFailed = true
    } finally {
      releaseFirst.resolve()
    }
    const firstResult = await firstCleanup

    expect(secondFailed).toBe(false)
    expect(secondResult).toEqual({
      status: 'skipped_already_running',
      counts: {
        authSessionsDeleted: 0,
        authRateLimitsDeleted: 0,
        auditEventsDeleted: 0,
      },
    })
    expect(firstResult).toEqual({
      status: 'completed',
      counts: {
        authSessionsDeleted: 1,
        authRateLimitsDeleted: 0,
        auditEventsDeleted: 0,
      },
    })
    const remaining = await controlClient.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM auth_sessions WHERE user_id = $1`,
      [userId],
    )
    expect(remaining.rows[0]?.count).toBe('0')
  })
})
