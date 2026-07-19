import type { QueryResultRow } from 'pg'

import {
  AUTH_CLEANUP_BATCH_SIZE,
  AuthCleanupExecutionError,
  type AuthCleanupPgClient,
  cleanupAuthenticationData,
  runAuthCleanupCli,
} from './auth-cleanup'

const DATABASE_URL = 'postgresql://localhost:5432/qianshu_test'
const BACKEND_PID = 4_312
const CUTOFF = new Date('2026-07-17T00:00:00.000Z')
const AUDIT_REQUEST_ID = 'cleanup:test-request-id'

interface ObservedQuery {
  text: string
  values: readonly unknown[]
}

interface FakeClientOptions {
  lockAcquired?: boolean
  lockBackendPid?: number
  cutoffBackendPid?: number
  unlockBackendPid?: number
  sessionBatchCounts?: readonly number[]
  rateLimitBatchCounts?: readonly number[]
  auditBatchCounts?: readonly number[]
  failDeleteAt?: number
  failUnlock?: boolean
  failEnd?: boolean
}

interface FakeClientFixture {
  client: AuthCleanupPgClient
  connect: jest.Mock<Promise<void>, []>
  end: jest.Mock<Promise<void>, []>
  observedQueries: ObservedQuery[]
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function createFakeClient(
  options: FakeClientOptions = {},
): FakeClientFixture {
  const observedQueries: ObservedQuery[] = []
  const sessionBatchCounts = [...(options.sessionBatchCounts ?? [0])]
  const rateLimitBatchCounts = [
    ...(options.rateLimitBatchCounts ?? [0]),
  ]
  const auditBatchCounts = [...(options.auditBatchCounts ?? [0])]
  const connect = jest.fn<Promise<void>, []>().mockResolvedValue(undefined)
  const end = options.failEnd
    ? jest
        .fn<Promise<void>, []>()
        .mockRejectedValue(new Error('contains DATABASE_URL canary'))
    : jest.fn<Promise<void>, []>().mockResolvedValue(undefined)
  let deleteCount = 0

  const query = jest.fn(
    async <Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<{ rows: Row[]; rowCount: number | null }> => {
      await Promise.resolve()
      const normalizedSql = normalizeSql(text)
      observedQueries.push({ text: normalizedSql, values })

      if (normalizedSql.includes('pg_try_advisory_lock')) {
        return {
          rows: [
            {
              backendPid: options.lockBackendPid ?? BACKEND_PID,
              lockAcquired: options.lockAcquired ?? true,
            } as unknown as Row,
          ],
          rowCount: 1,
        }
      }

      if (normalizedSql.includes('clock_timestamp() AS "cutoff"')) {
        return {
          rows: [
            {
              backendPid: options.cutoffBackendPid ?? BACKEND_PID,
              cutoff: CUTOFF,
            } as unknown as Row,
          ],
          rowCount: 1,
        }
      }

      if (normalizedSql.includes('pg_advisory_unlock')) {
        if (options.failUnlock) {
          throw new Error('unlock driver failure with secret')
        }

        return {
          rows: [
            {
              backendPid: options.unlockBackendPid ?? BACKEND_PID,
              lockReleased: true,
            } as unknown as Row,
          ],
          rowCount: 1,
        }
      }

      if (normalizedSql.startsWith('DELETE FROM')) {
        deleteCount += 1
        if (deleteCount === options.failDeleteAt) {
          throw new Error('delete failure with SQL parameter canary')
        }

        let batchCount: number | undefined
        if (normalizedSql.includes('"auth_sessions"')) {
          batchCount = sessionBatchCounts.shift()
        } else if (normalizedSql.includes('"auth_rate_limits"')) {
          batchCount = rateLimitBatchCounts.shift()
        } else if (normalizedSql.includes('"audit_events"')) {
          batchCount = auditBatchCounts.shift()
        }

        if (batchCount === undefined) {
          throw new Error('Unexpected cleanup delete query')
        }

        return { rows: [], rowCount: batchCount }
      }

      return { rows: [], rowCount: null }
    },
  )

  return {
    client: {
      connect,
      query: query as unknown as AuthCleanupPgClient['query'],
      end,
    },
    connect,
    end,
    observedQueries,
  }
}

function queriesContaining(
  observedQueries: readonly ObservedQuery[],
  fragment: string,
): ObservedQuery[] {
  return observedQueries.filter(({ text }) => text.includes(fragment))
}

describe('cleanupAuthenticationData', () => {
  it('records one completed-only AUTH_RETENTION_PURGED Audit after committed deletion batches', async () => {
    const fixture = createFakeClient({
      sessionBatchCounts: [2],
      rateLimitBatchCounts: [3],
      auditBatchCounts: [4],
    })

    await cleanupAuthenticationData({
      connectionString: DATABASE_URL,
      createClient: () => fixture.client,
      createAuditRequestId: () => AUDIT_REQUEST_ID,
    })

    const auditInserts = fixture.observedQueries.filter(({ text }) =>
      text.startsWith('INSERT INTO "audit_events"'),
    )
    expect(auditInserts).toHaveLength(1)
    expect(auditInserts[0]?.text).toContain("'AUTH_RETENTION_PURGED'")
    expect(auditInserts[0]?.text).toContain("'SUCCESS'")
    expect(auditInserts[0]?.text).toContain("'SYSTEM'")
    expect(auditInserts[0]?.values).toEqual([
      AUDIT_REQUEST_ID,
      JSON.stringify({
        authRecordsDeleted: 2,
        rateLimitRecordsDeleted: 3,
        auditRecordsDeleted: 4,
      }),
    ])

    const insertIndex = fixture.observedQueries.indexOf(auditInserts[0])
    const lastDeleteCommitIndex = fixture.observedQueries
      .map(({ text }, index) => (text === 'COMMIT' ? index : -1))
      .filter((index) => index >= 0)
      .at(-2)
    expect(lastDeleteCommitIndex).toBeDefined()
    expect(insertIndex).toBeGreaterThan(lastDeleteCommitIndex!)
  })

  it('uses one dedicated backend for lock, fixed cutoff, all batches and unlock', async () => {
    const fixture = createFakeClient({
      sessionBatchCounts: [AUTH_CLEANUP_BATCH_SIZE, 2],
      rateLimitBatchCounts: [1],
      auditBatchCounts: [3],
    })
    const createClient = jest.fn().mockReturnValue(fixture.client)

    const result = await cleanupAuthenticationData({
      connectionString: DATABASE_URL,
      createClient,
    })

    expect(result).toEqual({
      status: 'completed',
      counts: {
        authSessionsDeleted: AUTH_CLEANUP_BATCH_SIZE + 2,
        authRateLimitsDeleted: 1,
        auditEventsDeleted: 3,
      },
    })
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient).toHaveBeenCalledWith(DATABASE_URL)
    expect(fixture.connect).toHaveBeenCalledTimes(1)
    expect(fixture.end).toHaveBeenCalledTimes(1)
    const lockQuery = queriesContaining(
      fixture.observedQueries,
      'pg_try_advisory_lock',
    )
    const cutoffQuery = queriesContaining(
      fixture.observedQueries,
      'clock_timestamp() AS "cutoff"',
    )
    const unlockQuery = queriesContaining(
      fixture.observedQueries,
      'pg_advisory_unlock',
    )
    expect(lockQuery).toHaveLength(1)
    expect(cutoffQuery).toHaveLength(1)
    expect(unlockQuery).toHaveLength(1)
    expect(lockQuery[0]?.text).toContain('pg_backend_pid() AS "backendPid"')
    expect(cutoffQuery[0]?.text).toContain(
      'pg_backend_pid() AS "backendPid"',
    )
    expect(unlockQuery[0]?.text).toContain(
      'pg_backend_pid() AS "backendPid"',
    )

    const deleteQueries = queriesContaining(
      fixture.observedQueries,
      'DELETE FROM',
    )
    expect(deleteQueries).toHaveLength(4)
    for (const query of deleteQueries) {
      expect(query.values[0]).toBe(CUTOFF)
      expect(query.values[1]).toBe(AUTH_CLEANUP_BATCH_SIZE)
    }

    const beginIndexes = fixture.observedQueries
      .map(({ text }, index) => (text === 'BEGIN' ? index : -1))
      .filter((index) => index >= 0)
    const commitIndexes = fixture.observedQueries
      .map(({ text }, index) => (text === 'COMMIT' ? index : -1))
      .filter((index) => index >= 0)
    expect(beginIndexes).toHaveLength(deleteQueries.length + 1)
    expect(commitIndexes).toHaveLength(deleteQueries.length + 1)

    for (const beginIndex of beginIndexes.slice(0, -1)) {
      expect(fixture.observedQueries[beginIndex + 1]?.text).toContain(
        "set_config('statement_timeout'",
      )
      expect(fixture.observedQueries[beginIndex + 2]?.text).toContain(
        'DELETE FROM',
      )
      expect(fixture.observedQueries[beginIndex + 3]?.text).toBe('COMMIT')
    }

    const auditBeginIndex = beginIndexes.at(-1)
    expect(auditBeginIndex).toBeDefined()
    expect(fixture.observedQueries[auditBeginIndex! + 1]?.text).toContain(
      "set_config('statement_timeout'",
    )
    expect(fixture.observedQueries[auditBeginIndex! + 2]?.text).toContain(
      'AUTH_RETENTION_PURGED',
    )
    expect(fixture.observedQueries[auditBeginIndex! + 3]?.text).toBe('COMMIT')
  })

  it('encodes the three retention rules and equality boundaries in parameterized SQL', async () => {
    const fixture = createFakeClient()

    await cleanupAuthenticationData({
      connectionString: DATABASE_URL,
      createClient: () => fixture.client,
    })

    const sessionDelete = queriesContaining(
      fixture.observedQueries,
      '"auth_sessions"',
    ).find(({ text }) => text.startsWith('DELETE FROM'))
    const rateLimitDelete = queriesContaining(
      fixture.observedQueries,
      '"auth_rate_limits"',
    ).find(({ text }) => text.startsWith('DELETE FROM'))
    const auditDelete = queriesContaining(
      fixture.observedQueries,
      '"audit_events"',
    ).find(({ text }) => text.startsWith('DELETE FROM'))

    expect(sessionDelete?.text).toMatch(
      /LEAST\(\s*"idle_expires_at", "absolute_expires_at", COALESCE\("revoked_at", 'infinity'::timestamptz\)\s*\)/,
    )
    expect(sessionDelete?.text).toContain("<= $1::timestamptz - INTERVAL '30 days'")
    expect(sessionDelete?.text).toContain('LIMIT $2')
    expect(rateLimitDelete?.text).toContain(
      '"updated_at" <= $1::timestamptz - INTERVAL \'7 days\'',
    )
    expect(rateLimitDelete?.text).toMatch(
      /\(\s*"blocked_until" IS NULL OR "blocked_until" <= \$1::timestamptz\s*\)/,
    )
    expect(auditDelete?.text).toContain(
      '"occurred_at" <= $1::timestamptz - INTERVAL \'365 days\'',
    )
  })

  it('successfully skips all mutation work when another cleanup owns the lock', async () => {
    const fixture = createFakeClient({ lockAcquired: false })

    await expect(
      cleanupAuthenticationData({
        connectionString: DATABASE_URL,
        createClient: () => fixture.client,
      }),
    ).resolves.toEqual({
      status: 'skipped_already_running',
      counts: {
        authSessionsDeleted: 0,
        authRateLimitsDeleted: 0,
        auditEventsDeleted: 0,
      },
    })

    expect(queriesContaining(fixture.observedQueries, 'DELETE FROM')).toEqual(
      [],
    )
    expect(queriesContaining(fixture.observedQueries, 'BEGIN')).toEqual([])
    expect(
      queriesContaining(fixture.observedQueries, 'pg_advisory_unlock'),
    ).toEqual([])
    expect(fixture.end).toHaveBeenCalledTimes(1)
    expect(
      queriesContaining(fixture.observedQueries, 'AUTH_RETENTION_PURGED'),
    ).toEqual([])
  })

  it('counts only committed batches and always rolls back, unlocks and disconnects after a later failure', async () => {
    const fixture = createFakeClient({
      sessionBatchCounts: [AUTH_CLEANUP_BATCH_SIZE],
      failDeleteAt: 2,
    })

    await expect(
      cleanupAuthenticationData({
        connectionString: DATABASE_URL,
        createClient: () => fixture.client,
      }),
    ).rejects.toMatchObject({
      message: 'Authentication cleanup failed',
      committedCounts: {
        authSessionsDeleted: AUTH_CLEANUP_BATCH_SIZE,
        authRateLimitsDeleted: 0,
        auditEventsDeleted: 0,
      },
    } satisfies Partial<AuthCleanupExecutionError>)

    expect(queriesContaining(fixture.observedQueries, 'COMMIT')).toHaveLength(1)
    expect(queriesContaining(fixture.observedQueries, 'ROLLBACK')).toHaveLength(
      1,
    )
    expect(
      queriesContaining(fixture.observedQueries, 'pg_advisory_unlock'),
    ).toHaveLength(1)
    expect(fixture.end).toHaveBeenCalledTimes(1)
    expect(
      queriesContaining(fixture.observedQueries, 'AUTH_RETENTION_PURGED'),
    ).toEqual([])
  })

  it.each([
    ['cutoff query', { cutoffBackendPid: BACKEND_PID + 1 }],
    ['unlock query', { unlockBackendPid: BACKEND_PID + 1 }],
  ] as const)(
    'fails safely when the %s does not use the lock-owning backend PID',
    async (_label, options) => {
      const fixture = createFakeClient(options)

      await expect(
        cleanupAuthenticationData({
          connectionString: DATABASE_URL,
          createClient: () => fixture.client,
        }),
      ).rejects.toThrow('Authentication cleanup failed')

      expect(fixture.end).toHaveBeenCalledTimes(1)
    },
  )

  it('turns unlock or disconnect failures into a safe command failure', async () => {
    const fixture = createFakeClient({
      failUnlock: true,
      failEnd: true,
    })

    await expect(
      cleanupAuthenticationData({
        connectionString: DATABASE_URL,
        createClient: () => fixture.client,
      }),
    ).rejects.toMatchObject({
      message: 'Authentication cleanup failed',
      committedCounts: {
        authSessionsDeleted: 0,
        authRateLimitsDeleted: 0,
        auditEventsDeleted: 0,
      },
    })
    expect(fixture.end).toHaveBeenCalledTimes(1)
  })
})

describe('runAuthCleanupCli', () => {
  const originalExitCode = process.exitCode

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it('prints a stable skipped metric and exits successfully', async () => {
    const log = jest.fn<void, [string]>()
    const error = jest.fn<void, [string]>()

    const clock = jest.fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(42.3456)

    await runAuthCleanupCli(
      () => Promise.resolve({
        status: 'skipped_already_running',
        counts: {
          authSessionsDeleted: 0,
          authRateLimitsDeleted: 0,
          auditEventsDeleted: 0,
        },
      }),
      { log, error },
      clock,
    )

    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        kind: 'metric',
        metric: 'auth_cleanup',
        status: 'skipped_already_running',
        durationMs: 32.346,
        authSessionsDeleted: 0,
        authRateLimitsDeleted: 0,
        auditEventsDeleted: 0,
      }),
    )
    expect(error).not.toHaveBeenCalled()
    expect(process.exitCode).not.toBe(1)
  })

  it('reports only committed counts with fixed text and sets a nonzero exit code on failure', async () => {
    const log = jest.fn<void, [string]>()
    const error = jest.fn<void, [string]>()
    const unsafeCanary = 'postgresql://user:password@db/private'
    const failure = new AuthCleanupExecutionError({
      authSessionsDeleted: AUTH_CLEANUP_BATCH_SIZE,
      authRateLimitsDeleted: 2,
      auditEventsDeleted: 0,
    })
    Object.defineProperty(failure, 'cause', {
      value: new Error(unsafeCanary),
    })

    const clock = jest.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(112.5)

    await runAuthCleanupCli(
      async () => Promise.reject(failure),
      { log, error },
      clock,
    )

    expect(error).toHaveBeenCalledTimes(1)
    const output = String(error.mock.calls[0]?.[0])
    expect(output).toBe(
      JSON.stringify({
        kind: 'metric',
        metric: 'auth_cleanup',
        status: 'failed',
        durationMs: 12.5,
        authSessionsDeleted: AUTH_CLEANUP_BATCH_SIZE,
        authRateLimitsDeleted: 2,
        auditEventsDeleted: 0,
      }),
    )
    expect(output).not.toContain(unsafeCanary)
    expect(process.exitCode).toBe(1)
    expect(log).not.toHaveBeenCalled()
  })
})
