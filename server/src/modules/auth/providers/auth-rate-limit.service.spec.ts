import { HttpStatus } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuthRateLimitScope,
  type AuthRateLimitScope as AuthRateLimitScopeValue,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import {
  AuthRateLimitInputError,
  AuthRateLimitOperationFailedError,
  type AuthRateLimitReservation,
  AuthRateLimitService,
} from './auth-rate-limit.service'

interface RawSql {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

type QueryRaw = (query: RawSql) => Promise<unknown>
type ExecuteRaw = (query: RawSql) => Promise<number>

const USER_HASH = Buffer.alloc(32, 0x5a)
const IP_HASH = Buffer.alloc(32, 0x6b)
const BUCKET_KEY = '2026-07-17 10:00:00.123456+00'

function createService() {
  const queryRaw = jest.fn<ReturnType<QueryRaw>, Parameters<QueryRaw>>()
  const executeRaw = jest
    .fn<ReturnType<ExecuteRaw>, Parameters<ExecuteRaw>>()
    .mockResolvedValue(1)
  const transaction = {
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  }
  const runTransaction = jest.fn(
    async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  )
  const prisma = {
    $transaction: runTransaction,
  } as unknown as PrismaService

  return {
    executeRaw,
    queryRaw,
    runTransaction,
    service: new AuthRateLimitService(prisma),
    transaction,
  }
}

function createAttempts() {
  return [
    {
      scope: AuthRateLimitScope.LOGIN_USERNAME,
      subjectKeyHash: USER_HASH,
    },
    {
      scope: AuthRateLimitScope.LOGIN_IP,
      subjectKeyHash: IP_HASH,
    },
  ] as const
}

function createReservation(): AuthRateLimitReservation {
  return {
    entries: [
      {
        scope: AuthRateLimitScope.LOGIN_USERNAME,
        subjectKeyHash: USER_HASH,
        bucketStartedAtKey: BUCKET_KEY,
      },
      {
        scope: AuthRateLimitScope.LOGIN_IP,
        subjectKeyHash: IP_HASH,
        bucketStartedAtKey: BUCKET_KEY,
      },
    ],
  }
}

function normalizeSql(query: RawSql): string {
  return query.strings.join('?').replace(/\s+/g, ' ').trim()
}

describe('AuthRateLimitService.reserveAttempts', () => {
  it('在同一短事务中按稳定顺序预占全部桶并返回精确窗口 key', async () => {
    const { queryRaw, runTransaction, service } = createService()
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ bucketStartedAtKey: BUCKET_KEY }])
      .mockResolvedValueOnce([{ bucketStartedAtKey: BUCKET_KEY }])

    const reservation = await service.reserveAttempts(createAttempts())

    expect(runTransaction).toHaveBeenCalledTimes(1)
    expect(queryRaw).toHaveBeenCalledTimes(3)
    const timeoutQuery = queryRaw.mock.calls[0]?.[0]
    expect(normalizeSql(timeoutQuery)).toContain("set_config('lock_timeout'")

    const ipQuery = queryRaw.mock.calls[1]?.[0]
    const usernameQuery = queryRaw.mock.calls[2]?.[0]
    expect(normalizeSql(ipQuery)).toContain(
      'ON CONFLICT ("scope", "subject_key_hash") DO UPDATE SET',
    )
    expect(normalizeSql(ipQuery)).toContain(
      '"current"."attempt_count" < ?',
    )
    expect(normalizeSql(ipQuery)).toContain(
      'RETURNING "current"."bucket_started_at"::text AS "bucketStartedAtKey"',
    )
    expect(ipQuery.values).toEqual([
      AuthRateLimitScope.LOGIN_IP,
      IP_HASH,
      30,
      30,
    ])
    expect(usernameQuery.values).toEqual([
      AuthRateLimitScope.LOGIN_USERNAME,
      USER_HASH,
      5,
      5,
    ])
    expect(reservation.entries).toEqual([
      {
        scope: AuthRateLimitScope.LOGIN_IP,
        subjectKeyHash: IP_HASH,
        bucketStartedAtKey: BUCKET_KEY,
      },
      {
        scope: AuthRateLimitScope.LOGIN_USERNAME,
        subjectKeyHash: USER_HASH,
        bucketStartedAtKey: BUCKET_KEY,
      },
    ])
  })

  it('任一桶拒绝时抛出固定 429，并依赖事务回滚此前预占', async () => {
    const { queryRaw, service } = createService()
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ bucketStartedAtKey: BUCKET_KEY }])
      .mockResolvedValueOnce([])

    const operation = service.reserveAttempts(createAttempts())

    await expect(operation).rejects.toBeInstanceOf(ApiException)
    await expect(operation).rejects.toMatchObject({
      code: 'AUTH_RATE_LIMITED',
      publicMessage: '操作过于频繁，请稍后重试',
      status: HttpStatus.TOO_MANY_REQUESTS,
    })
  })
})

describe('AuthRateLimitService release', () => {
  it('在独立短事务中按稳定顺序只递减匹配窗口的本次预占', async () => {
    const { executeRaw, queryRaw, runTransaction, service } = createService()
    queryRaw.mockResolvedValueOnce([])

    await service.releaseReservation(createReservation())

    expect(runTransaction).toHaveBeenCalledTimes(1)
    expect(executeRaw).toHaveBeenCalledTimes(2)
    const ipQuery = executeRaw.mock.calls[0]?.[0]
    const usernameQuery = executeRaw.mock.calls[1]?.[0]
    expect(normalizeSql(ipQuery)).toContain(
      '"attempt_count" = "current"."attempt_count" - 1',
    )
    expect(normalizeSql(ipQuery)).toContain(
      '"current"."bucket_started_at" = ?::timestamptz',
    )
    expect(ipQuery.values).toEqual([
      30,
      AuthRateLimitScope.LOGIN_IP,
      IP_HASH,
      BUCKET_KEY,
    ])
    expect(usernameQuery.values).toEqual([
      5,
      AuthRateLimitScope.LOGIN_USERNAME,
      USER_HASH,
      BUCKET_KEY,
    ])
  })

  it('可并入已有成功事务且不创建嵌套事务', async () => {
    const { executeRaw, runTransaction, service, transaction } = createService()

    await service.releaseReservationInTransaction(
      transaction as unknown as Prisma.TransactionClient,
      createReservation(),
    )

    expect(runTransaction).not.toHaveBeenCalled()
    expect(executeRaw).toHaveBeenCalledTimes(2)
  })
})

describe('AuthRateLimitService input and failure boundaries', () => {
  it.each([
    Buffer.alloc(0),
    Buffer.alloc(31),
    Buffer.alloc(33),
    'not-bytes',
  ])('在事务前拒绝非 32-byte subjectKeyHash', async (invalidHash) => {
    const { runTransaction, service } = createService()

    await expect(
      service.reserveAttempts([
        {
          scope: AuthRateLimitScope.LOGIN_USERNAME,
          subjectKeyHash: invalidHash as unknown as Buffer,
        },
      ]),
    ).rejects.toBeInstanceOf(AuthRateLimitInputError)
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('在事务前拒绝空集合、重复主体和运行期未知 scope', async () => {
    const { runTransaction, service } = createService()
    const duplicate = createAttempts()[0]
    const invalidScope = 'LOGIN_OTHER' as AuthRateLimitScopeValue

    await expect(service.reserveAttempts([])).rejects.toBeInstanceOf(
      AuthRateLimitInputError,
    )
    await expect(
      service.reserveAttempts([duplicate, duplicate]),
    ).rejects.toBeInstanceOf(AuthRateLimitInputError)
    await expect(
      service.reserveAttempts([
        { scope: invalidScope, subjectKeyHash: USER_HASH },
      ]),
    ).rejects.toBeInstanceOf(AuthRateLimitInputError)
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('将数据库驱动异常替换为不带 cause 的固定内部错误', async () => {
    const secretCanary = 'postgresql://secret@localhost/qianshu'
    const { runTransaction, service } = createService()
    runTransaction.mockRejectedValue(new Error(secretCanary))

    const operation = service.reserveAttempts(createAttempts())

    await expect(operation).rejects.toBeInstanceOf(
      AuthRateLimitOperationFailedError,
    )
    const error = await operation.catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'AUTH_RATE_LIMIT_OPERATION_FAILED',
      message: 'Authentication rate-limit operation failed',
    })
    expect(JSON.stringify(error)).not.toContain(secretCanary)
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
  })

  it('将异常窗口 key 映射为固定内部错误', async () => {
    const { queryRaw, service } = createService()
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ bucketStartedAtKey: null }])

    await expect(
      service.reserveAttempts([createAttempts()[0]]),
    ).rejects.toBeInstanceOf(AuthRateLimitOperationFailedError)
  })
})
