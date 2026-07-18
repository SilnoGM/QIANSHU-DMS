import { HttpStatus } from '@nestjs/common'

import { SessionRevokedReason, UserStatus } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { AuthMetricLogger } from '../../infrastructure/observability/auth-metric.logger'
import { AuthSessionService } from './auth-session.service'
import { SessionTokenProvider } from './providers/session-token.provider'

const USER_ID = '8ac94425-c78c-4b32-ae2d-e3ce808b0275'
const DATABASE_NOW = new Date('2026-07-17T01:02:03.456Z')

type TransactionMock = {
  $queryRaw: jest.Mock
  authSession: {
    create: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
  }
}

function createTransactionMock(): TransactionMock {
  return {
    $queryRaw: jest.fn(),
    authSession: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  }
}

function createService(transaction: TransactionMock) {
  const prisma = {
    $transaction: jest.fn((callback: (tx: TransactionMock) => unknown) =>
      Promise.resolve(callback(transaction)),
    ),
  }
  const tokenProvider = new SessionTokenProvider()
  const metrics: jest.Mocked<Pick<
    AuthMetricLogger,
    'recordSession' | 'recordSessionRevoked'
  >> = {
    recordSession: jest.fn(),
    recordSessionRevoked: jest.fn(),
  }

  return {
    metrics,
    prisma,
    service: new AuthSessionService(
      prisma as unknown as PrismaService,
      tokenProvider,
      metrics as unknown as AuthMetricLogger,
    ),
    tokenProvider,
  }
}

function createLockedSessionRow(
  tokenHash: Buffer,
  overrides: Record<string, unknown> = {},
) {
  return {
    sessionId: 'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1',
    userId: USER_ID,
    tokenHash,
    sessionAuthVersion: 3,
    createdAt: new Date(DATABASE_NOW.getTime() - 60 * 60 * 1_000),
    lastActivityAt: new Date(DATABASE_NOW.getTime() - 6 * 60 * 1_000),
    idleExpiresAt: new Date(DATABASE_NOW.getTime() + 60 * 60 * 1_000),
    absoluteExpiresAt: new Date(DATABASE_NOW.getTime() + 2 * 60 * 60 * 1_000),
    revokedAt: null,
    userAuthVersion: 3,
    username: 'operator',
    displayName: '操作员',
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    ...overrides,
  }
}

describe('AuthSessionService', () => {
  it('creates a session from PostgreSQL time with the configured idle and absolute lifetimes', async () => {
    const transaction = createTransactionMock()
    transaction.$queryRaw.mockResolvedValueOnce([{ now: DATABASE_NOW }])
    transaction.authSession.create.mockResolvedValue({})
    const { service, tokenProvider } = createService(transaction)

    const issued = await service.createInTransaction(transaction as never, {
      id: USER_ID,
      authVersion: 7,
      username: 'operator',
      displayName: '操作员',
      mustChangePassword: true,
    })

    const parsedToken = tokenProvider.parse(issued.tokenValue)
    expect(parsedToken?.sessionId).toBe(issued.session.id)
    expect(typeof parsedToken?.secret).toBe('string')
    expect(typeof issued.session.id).toBe('string')
    expect(issued.session).toEqual({
      id: issued.session.id,
      userId: USER_ID,
      username: 'operator',
      displayName: '操作员',
      mustChangePassword: true,
      createdAt: DATABASE_NOW,
      lastActivityAt: DATABASE_NOW,
      idleExpiresAt: new Date('2026-07-19T01:02:03.456Z'),
      absoluteExpiresAt: new Date('2026-08-16T01:02:03.456Z'),
    })
    const expectedTokenHash = Uint8Array.from(
      tokenProvider.hashSecret(parsedToken?.secret ?? ''),
    )
    expect(transaction.authSession.create).toHaveBeenCalledWith({
      data: {
        id: issued.session.id,
        userId: USER_ID,
        tokenHash: expectedTokenHash,
        authVersion: 7,
        createdAt: DATABASE_NOW,
        lastActivityAt: DATABASE_NOW,
        idleExpiresAt: new Date('2026-07-19T01:02:03.456Z'),
        absoluteExpiresAt: new Date('2026-08-16T01:02:03.456Z'),
      },
    })
  })

  it('rejects a malformed token before opening a database transaction', async () => {
    const transaction = createTransactionMock()
    const { prisma, service } = createService(transaction)

    await expect(service.authenticate('not-a-session-token')).resolves.toBeNull()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('authenticates under a row lock and touches an idle session after five minutes', async () => {
    const transaction = createTransactionMock()
    const { metrics, service, tokenProvider } = createService(transaction)
    const token = tokenProvider.generate()
    const absoluteExpiresAt = new Date(DATABASE_NOW.getTime() + 2 * 60 * 60 * 1_000)
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createLockedSessionRow(token.tokenHash, { absoluteExpiresAt }),
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])
    transaction.authSession.update.mockResolvedValue({})

    await expect(service.authenticate(token.value)).resolves.toEqual({
      id: token.sessionId,
      userId: USER_ID,
      username: 'operator',
      displayName: '操作员',
      mustChangePassword: false,
      createdAt: new Date(DATABASE_NOW.getTime() - 60 * 60 * 1_000),
      lastActivityAt: DATABASE_NOW,
      idleExpiresAt: absoluteExpiresAt,
      absoluteExpiresAt,
    })
    expect(transaction.authSession.update).toHaveBeenCalledWith({
      where: { id: token.sessionId },
      data: {
        lastActivityAt: DATABASE_NOW,
        idleExpiresAt: absoluteExpiresAt,
      },
    })
    expect(metrics.recordSession).toHaveBeenCalledWith('valid')
    const rawQueryCalls = transaction.$queryRaw.mock.calls as unknown[][]
    const timeoutQuery = rawQueryCalls[0]?.[0] as {
      strings: readonly string[]
    }
    expect(timeoutQuery.strings.join('')).toContain("set_config('lock_timeout'")
    expect(timeoutQuery.strings.join('')).toContain("set_config('statement_timeout'")
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.$queryRaw.mock.invocationCallOrder[1],
    )
  })

  it('does not touch a session inside the five-minute activity window', async () => {
    const transaction = createTransactionMock()
    const { service, tokenProvider } = createService(transaction)
    const token = tokenProvider.generate()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createLockedSessionRow(token.tokenHash, {
          lastActivityAt: new Date(DATABASE_NOW.getTime() - 4 * 60 * 1_000),
        }),
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])

    await expect(service.authenticate(token.value)).resolves.not.toBeNull()
    expect(transaction.authSession.update).not.toHaveBeenCalled()
  })

  it('checks a session without extending activity when requested by the login flow', async () => {
    const transaction = createTransactionMock()
    const { service, tokenProvider } = createService(transaction)
    const token = tokenProvider.generate()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createLockedSessionRow(token.tokenHash)])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])

    await expect(service.validateWithoutTouch(token.value)).resolves.not.toBeNull()
    expect(transaction.authSession.update).not.toHaveBeenCalled()
  })

  it.each([
    ['a different secret hash', { tokenHash: Buffer.alloc(32, 1) }],
    ['a revoked session', { revokedAt: new Date(DATABASE_NOW) }],
    ['a disabled user', { status: UserStatus.DISABLED }],
    ['a stale auth version', { userAuthVersion: 4 }],
    ['an idle-expired session', { idleExpiresAt: new Date(DATABASE_NOW) }],
    ['an absolutely expired session', { absoluteExpiresAt: new Date(DATABASE_NOW) }],
  ])('returns null for %s', async (_label, overrides) => {
    const transaction = createTransactionMock()
    const { metrics, service, tokenProvider } = createService(transaction)
    const token = tokenProvider.generate()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createLockedSessionRow(token.tokenHash, overrides),
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])

    await expect(service.authenticate(token.value)).resolves.toBeNull()
    expect(transaction.authSession.update).not.toHaveBeenCalled()
    if (_label.includes('expired')) {
      expect(metrics.recordSession).toHaveBeenCalledWith('expired')
    } else {
      expect(metrics.recordSession).not.toHaveBeenCalled()
    }
  })

  it('returns null without reading the clock when the selector does not exist', async () => {
    const transaction = createTransactionMock()
    const { service, tokenProvider } = createService(transaction)
    const token = tokenProvider.generate()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await expect(service.authenticate(token.value)).resolves.toBeNull()
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('applies transaction-local timeouts before the standalone single-session revoke', async () => {
    const transaction = createTransactionMock()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])
    transaction.authSession.updateMany.mockResolvedValue({ count: 1 })
    const { metrics, service } = createService(transaction)

    await expect(
      service.revokeSession(
        'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1',
        SessionRevokedReason.LOGOUT,
      ),
    ).resolves.toBe(true)
    expect(metrics.recordSessionRevoked).toHaveBeenCalledWith(1)

    const rawQueryCalls = transaction.$queryRaw.mock.calls as unknown[][]
    const timeoutQuery = rawQueryCalls[0]?.[0] as {
      strings: readonly string[]
    }
    expect(timeoutQuery.strings.join('')).toContain("set_config('lock_timeout'")
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.$queryRaw.mock.invocationCallOrder[1],
    )
  })

  it('applies transaction-local timeouts before the standalone user-session revoke', async () => {
    const transaction = createTransactionMock()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])
    transaction.authSession.updateMany.mockResolvedValue({ count: 2 })
    const { metrics, service } = createService(transaction)

    await expect(
      service.revokeAllForUser(
        USER_ID,
        SessionRevokedReason.PASSWORD_CHANGED,
      ),
    ).resolves.toBe(2)
    expect(metrics.recordSessionRevoked).toHaveBeenCalledWith(2)

    const rawQueryCalls = transaction.$queryRaw.mock.calls as unknown[][]
    const timeoutQuery = rawQueryCalls[0]?.[0] as {
      strings: readonly string[]
    }
    expect(timeoutQuery.strings.join('')).toContain("set_config('lock_timeout'")
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.$queryRaw.mock.invocationCallOrder[1],
    )
  })

  it('revokes only active sessions using PostgreSQL time', async () => {
    const transaction = createTransactionMock()
    transaction.$queryRaw.mockResolvedValueOnce([{ now: DATABASE_NOW }])
    transaction.authSession.updateMany.mockResolvedValue({ count: 2 })
    const { metrics, service } = createService(transaction)

    await expect(
      service.revokeAllForUserInTransaction(
        transaction as never,
        USER_ID,
        SessionRevokedReason.PASSWORD_CHANGED,
      ),
    ).resolves.toBe(2)
    expect(transaction.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, revokedAt: null },
      data: {
        revokedAt: DATABASE_NOW,
        revokedReason: SessionRevokedReason.PASSWORD_CHANGED,
      },
    })
    // 调用方事务尚未提交，底层 helper 不能提前制造撤销成功指标。
    expect(metrics.recordSessionRevoked).not.toHaveBeenCalled()
  })

  it('maps database failures to one fixed service-unavailable error', async () => {
    const transaction = createTransactionMock()
    const { prisma, service, tokenProvider } = createService(transaction)
    const token = tokenProvider.generate()
    prisma.$transaction.mockRejectedValueOnce(
      new Error('postgres://secret@example.invalid/private'),
    )

    const error = await service.authenticate(token.value).catch((caught: unknown) =>
      caught,
    )

    expect(error).toBeInstanceOf(ApiException)
    expect(error).toMatchObject({
      code: 'AUTH_SERVICE_UNAVAILABLE',
      publicMessage: '认证服务暂时不可用',
    })
    expect((error as ApiException).getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    )
  })
})
