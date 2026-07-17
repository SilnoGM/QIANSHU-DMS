import { HttpStatus } from '@nestjs/common'

import {
  AuthRateLimitScope,
  type AuthRateLimitScope as AuthRateLimitScopeValue,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import {
  AuthRateLimitInputError,
  AuthRateLimitOperationFailedError,
  AuthRateLimitService,
} from './auth-rate-limit.service'

type QueryResult = Array<{
  blockedUntil: Date | null
  dbNow: Date
}>

interface RawSql {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

type QueryRaw = (query: RawSql) => Promise<QueryResult>
type ExecuteRaw = (query: RawSql) => Promise<number>

const SUBJECT_KEY_HASH = Buffer.alloc(32, 0x5a)
const DB_NOW = new Date('2026-07-17T10:00:00.000Z')

function createService() {
  const queryRaw = jest.fn<ReturnType<QueryRaw>, Parameters<QueryRaw>>()
  const executeRaw = jest.fn<ReturnType<ExecuteRaw>, Parameters<ExecuteRaw>>()
  const prisma = {
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  } as unknown as PrismaService

  return {
    executeRaw,
    queryRaw,
    service: new AuthRateLimitService(prisma),
  }
}

function normalizeSql(query: RawSql): string {
  return query.strings.join('?').replace(/\s+/g, ' ').trim()
}

describe('AuthRateLimitService.assertAllowed', () => {
  it('使用 clock_timestamp 查询数据库时间，未命中记录时允许继续', async () => {
    const { queryRaw, service } = createService()
    queryRaw.mockResolvedValue([])

    await expect(
      service.assertAllowed(
        AuthRateLimitScope.LOGIN_USERNAME,
        SUBJECT_KEY_HASH,
      ),
    ).resolves.toBeUndefined()

    expect(queryRaw).toHaveBeenCalledTimes(1)
    const query = queryRaw.mock.calls[0]?.[0]
    expect(query).toBeDefined()
    expect(normalizeSql(query)).toBe(
      'SELECT "blocked_until" AS "blockedUntil", clock_timestamp() AS "dbNow" FROM "auth_rate_limits" WHERE "scope" = ?::"auth_rate_limit_scope" AND "subject_key_hash" = ? LIMIT 1',
    )
    expect(query?.values).toEqual([
      AuthRateLimitScope.LOGIN_USERNAME,
      SUBJECT_KEY_HASH,
    ])
  })

  it('blockedUntil 严格晚于数据库时间时返回固定 429 ApiException', async () => {
    const { queryRaw, service } = createService()
    queryRaw.mockResolvedValue([
      {
        blockedUntil: new Date(DB_NOW.getTime() + 1),
        dbNow: DB_NOW,
      },
    ])

    const operation = service.assertAllowed(
      AuthRateLimitScope.LOGIN_IP,
      SUBJECT_KEY_HASH,
    )

    await expect(operation).rejects.toBeInstanceOf(ApiException)
    await expect(operation).rejects.toMatchObject({
      code: 'AUTH_RATE_LIMITED',
      publicMessage: '操作过于频繁，请稍后重试',
    })
    await expect(operation).rejects.toHaveProperty(
      'status',
      HttpStatus.TOO_MANY_REQUESTS,
    )
  })

  it('blockedUntil 等于数据库时间时按严格大于边界放行', async () => {
    const { queryRaw, service } = createService()
    queryRaw.mockResolvedValue([
      {
        blockedUntil: new Date(DB_NOW),
        dbNow: new Date(DB_NOW),
      },
    ])

    await expect(
      service.assertAllowed(
        AuthRateLimitScope.PASSWORD_CHANGE_USER,
        SUBJECT_KEY_HASH,
      ),
    ).resolves.toBeUndefined()
  })

  it('blockedUntil 为 null 时放行', async () => {
    const { queryRaw, service } = createService()
    queryRaw.mockResolvedValue([{ blockedUntil: null, dbNow: DB_NOW }])

    await expect(
      service.assertAllowed(
        AuthRateLimitScope.PASSWORD_CHANGE_IP,
        SUBJECT_KEY_HASH,
      ),
    ).resolves.toBeUndefined()
  })
})

describe('AuthRateLimitService.recordFailure', () => {
  it.each([
    [AuthRateLimitScope.LOGIN_USERNAME, 5],
    [AuthRateLimitScope.PASSWORD_CHANGE_USER, 5],
    [AuthRateLimitScope.LOGIN_IP, 30],
    [AuthRateLimitScope.PASSWORD_CHANGE_IP, 30],
  ] as const)('为 %s 使用固定 15 分钟窗口和阈值 %i', async (scope, limit) => {
    const { executeRaw, service } = createService()
    executeRaw.mockResolvedValue(1)

    await expect(
      service.recordFailure(scope, SUBJECT_KEY_HASH),
    ).resolves.toBeUndefined()

    expect(executeRaw).toHaveBeenCalledTimes(1)
    const query = executeRaw.mock.calls[0]?.[0]
    expect(query).toBeDefined()
    expect(normalizeSql(query)).toBe(
      `INSERT INTO "auth_rate_limits" AS "current" ( "scope", "subject_key_hash", "bucket_started_at", "attempt_count", "blocked_until", "updated_at" ) SELECT ?::"auth_rate_limit_scope", ?, "database_time"."db_now", 1, NULL, "database_time"."db_now" FROM ( SELECT clock_timestamp() AS "db_now" ) AS "database_time" ON CONFLICT ("scope", "subject_key_hash") DO UPDATE SET "bucket_started_at" = CASE WHEN "current"."blocked_until" > EXCLUDED."updated_at" THEN "current"."bucket_started_at" WHEN "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at" THEN EXCLUDED."updated_at" ELSE "current"."bucket_started_at" END, "attempt_count" = CASE WHEN "current"."blocked_until" > EXCLUDED."updated_at" THEN "current"."attempt_count" WHEN "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at" THEN 1 ELSE "current"."attempt_count" + 1 END, "blocked_until" = CASE WHEN "current"."blocked_until" > EXCLUDED."updated_at" THEN "current"."blocked_until" WHEN "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at" THEN NULL WHEN "current"."attempt_count" + 1 >= ? THEN EXCLUDED."updated_at" + INTERVAL '15 minutes' ELSE NULL END, "updated_at" = EXCLUDED."updated_at"`,
    )
    expect(query?.values).toEqual([scope, SUBJECT_KEY_HASH, limit])
    expect(normalizeSql(query)).not.toMatch(/\b(?:now|current_timestamp)\s*\(/i)
  })
})

describe('AuthRateLimitService.clear', () => {
  it('使用参数化固定 SQL 删除一个主体的限流桶', async () => {
    const { executeRaw, service } = createService()
    executeRaw.mockResolvedValue(1)

    await expect(
      service.clear(AuthRateLimitScope.LOGIN_USERNAME, SUBJECT_KEY_HASH),
    ).resolves.toBeUndefined()

    expect(executeRaw).toHaveBeenCalledTimes(1)
    const query = executeRaw.mock.calls[0]?.[0]
    expect(query).toBeDefined()
    expect(normalizeSql(query)).toBe(
      'DELETE FROM "auth_rate_limits" WHERE "scope" = ?::"auth_rate_limit_scope" AND "subject_key_hash" = ?',
    )
    expect(query?.values).toEqual([
      AuthRateLimitScope.LOGIN_USERNAME,
      SUBJECT_KEY_HASH,
    ])
  })
})

describe('AuthRateLimitService input and failure boundaries', () => {
  it.each([
    Buffer.alloc(0),
    Buffer.alloc(31),
    Buffer.alloc(33),
    'not-bytes',
  ])('在查询数据库前拒绝非 32-byte subjectKeyHash', async (invalidHash) => {
    const { executeRaw, queryRaw, service } = createService()

    await expect(
      service.assertAllowed(
        AuthRateLimitScope.LOGIN_USERNAME,
        invalidHash as unknown as Buffer,
      ),
    ).rejects.toBeInstanceOf(AuthRateLimitInputError)
    await expect(
      service.recordFailure(
        AuthRateLimitScope.LOGIN_USERNAME,
        invalidHash as unknown as Buffer,
      ),
    ).rejects.toBeInstanceOf(AuthRateLimitInputError)
    await expect(
      service.clear(
        AuthRateLimitScope.LOGIN_USERNAME,
        invalidHash as unknown as Buffer,
      ),
    ).rejects.toBeInstanceOf(AuthRateLimitInputError)
    expect(queryRaw).not.toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('在查询数据库前拒绝运行期未知 scope', async () => {
    const { executeRaw, queryRaw, service } = createService()
    const invalidScope = 'LOGIN_OTHER' as AuthRateLimitScopeValue

    await expect(
      service.assertAllowed(invalidScope, SUBJECT_KEY_HASH),
    ).rejects.toMatchObject({
      code: 'AUTH_RATE_LIMIT_INPUT_INVALID',
      message: 'Authentication rate-limit input is invalid',
    })
    expect(queryRaw).not.toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it.each(['assertAllowed', 'recordFailure', 'clear'] as const)(
    '%s 将数据库驱动异常替换为不带 cause 的固定内部错误',
    async (method) => {
      const secretCanary = 'postgresql://secret@localhost/qianshu'
      const { executeRaw, queryRaw, service } = createService()
      queryRaw.mockRejectedValue(new Error(secretCanary))
      executeRaw.mockRejectedValue(new Error(secretCanary))

      const operation = service[method](
        AuthRateLimitScope.LOGIN_IP,
        SUBJECT_KEY_HASH,
      )

      await expect(operation).rejects.toBeInstanceOf(
        AuthRateLimitOperationFailedError,
      )
      await expect(operation).rejects.toMatchObject({
        code: 'AUTH_RATE_LIMIT_OPERATION_FAILED',
        message: 'Authentication rate-limit operation failed',
      })
      const error = await operation.catch((caught: unknown) => caught)
      expect(JSON.stringify(error)).not.toContain(secretCanary)
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
    },
  )

  it('将异常查询结果映射为固定内部错误', async () => {
    const { queryRaw, service } = createService()
    queryRaw.mockResolvedValue([
      {
        blockedUntil: new Date(DB_NOW.getTime() + 1),
        dbNow: 'not-a-date' as unknown as Date,
      },
    ])

    await expect(
      service.assertAllowed(AuthRateLimitScope.LOGIN_IP, SUBJECT_KEY_HASH),
    ).rejects.toBeInstanceOf(AuthRateLimitOperationFailedError)
  })
})
