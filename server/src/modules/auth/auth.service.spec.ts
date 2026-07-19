import { HttpStatus } from '@nestjs/common'

import { AccessControlService } from '../access-control/access-control.service'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  AuthRateLimitScope,
  UserStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { AuthMetricLogger } from '../../infrastructure/observability/auth-metric.logger'
import { AuthService } from './auth.service'
import { AuthSessionService, type IssuedSession } from './auth-session.service'
import { AuthRateLimitService } from './providers/auth-rate-limit.service'
import { AuthSubjectHasher } from './providers/auth-subject-hasher'
import {
  AuthCapacityUnavailableError,
  PasswordProvider,
} from './providers/password.provider'

const USER_ID = '8ac94425-c78c-4b32-ae2d-e3ce808b0275'
const REQUEST_ID = 'b19b2237-b935-462d-a818-02cc67b051c2'
const SOURCE_IP = '192.0.2.18'
const DATABASE_NOW = new Date('2026-07-17T03:04:05.678Z')
const USERNAME_HASH = Buffer.alloc(32, 0x11)
const IP_HASH = Buffer.alloc(32, 0x22)
const RATE_LIMIT_RESERVATION = Object.freeze({
  entries: Object.freeze([
    Object.freeze({
      scope: AuthRateLimitScope.LOGIN_IP,
      subjectKeyHash: IP_HASH,
      bucketStartedAtKey: '2026-07-17 03:04:05.678+00',
    }),
    Object.freeze({
      scope: AuthRateLimitScope.LOGIN_USERNAME,
      subjectKeyHash: USERNAME_HASH,
      bucketStartedAtKey: '2026-07-17 03:04:05.678+00',
    }),
  ]),
})

const USER_SNAPSHOT = {
  id: USER_ID,
  username: 'Opérator',
  usernameNormalized: 'opérator',
  displayName: '操作员',
  passwordHash: '$argon2id$verified-user-hash',
  status: UserStatus.ACTIVE,
  mustChangePassword: false,
  authVersion: 4,
} as const

const ISSUED_SESSION: IssuedSession = {
  tokenValue: 'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1.secret-value',
  session: {
    id: 'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1',
    userId: USER_ID,
    username: USER_SNAPSHOT.username,
    displayName: USER_SNAPSHOT.displayName,
    mustChangePassword: false,
    createdAt: DATABASE_NOW,
    lastActivityAt: DATABASE_NOW,
    idleExpiresAt: new Date('2026-07-19T03:04:05.678Z'),
    absoluteExpiresAt: new Date('2026-08-16T03:04:05.678Z'),
  },
}

type TransactionMock = {
  $queryRaw: jest.Mock
  $executeRaw: jest.Mock
  user: {
    update: jest.Mock
  }
}

function createTransactionMock(): TransactionMock {
  return {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(2),
    user: {
      update: jest.fn().mockResolvedValue({}),
    },
  }
}

function createLockedUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_SNAPSHOT.id,
    username: USER_SNAPSHOT.username,
    displayName: USER_SNAPSHOT.displayName,
    passwordHash: USER_SNAPSHOT.passwordHash,
    status: USER_SNAPSHOT.status,
    mustChangePassword: USER_SNAPSHOT.mustChangePassword,
    authVersion: USER_SNAPSHOT.authVersion,
    databaseNow: DATABASE_NOW,
    ...overrides,
  }
}

function createFixture() {
  const transaction = createTransactionMock()
  transaction.$queryRaw.mockResolvedValue([createLockedUserRow()])

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(USER_SNAPSHOT),
    },
    $transaction: jest.fn(
      async (callback: (transaction: TransactionMock) => Promise<unknown>) =>
        callback(transaction),
    ),
  }
  const sessions = {
    validateWithoutTouch: jest.fn().mockResolvedValue(null),
    createInTransaction: jest.fn().mockResolvedValue(ISSUED_SESSION),
  }
  const rateLimits = {
    reserveAttempts: jest.fn().mockResolvedValue(RATE_LIMIT_RESERVATION),
    releaseReservation: jest.fn().mockResolvedValue(undefined),
  }
  const subjectHasher = {
    hashUsername: jest.fn().mockReturnValue(USERNAME_HASH),
    hashIp: jest.fn().mockReturnValue(IP_HASH),
  }
  const passwords = {
    verify: jest.fn().mockResolvedValue(true),
    verifyWithDummyHash: jest.fn().mockResolvedValue(false),
  }
  const audit = {
    record: jest.fn().mockResolvedValue({ id: 'audit-event-id' }),
  }
  const accessControl = {
    getPermissionCodes: jest.fn().mockResolvedValue([]),
    getPermissionCodesInTransaction: jest
      .fn()
      .mockResolvedValue(['roles:read', 'users:read']),
  }
  const metrics: jest.Mocked<Pick<
    AuthMetricLogger,
    'recordLogin' | 'recordSession'
  >> = {
    recordLogin: jest.fn(),
    recordSession: jest.fn(),
  }

  const service = new AuthService(
    prisma as unknown as PrismaService,
    sessions as unknown as AuthSessionService,
    rateLimits as unknown as AuthRateLimitService,
    subjectHasher as unknown as AuthSubjectHasher,
    passwords as unknown as PasswordProvider,
    audit,
    accessControl as unknown as AccessControlService,
    metrics as unknown as AuthMetricLogger,
  )

  return {
    accessControl,
    audit,
    passwords,
    metrics,
    prisma,
    rateLimits,
    service,
    sessions,
    subjectHasher,
    transaction,
  }
}

const LOGIN_INPUT = {
  username: '  Ope\u0301rator  ',
  password: 'correct horse power',
  sourceIp: SOURCE_IP,
  requestId: REQUEST_ID,
} as const

async function captureError(operation: Promise<unknown>): Promise<ApiException> {
  const error = await operation.catch((caught: unknown) => caught)

  expect(error).toBeInstanceOf(ApiException)
  return error as ApiException
}

describe('AuthService login', () => {
  it('rejects an already authenticated browser without touching or starting login work', async () => {
    const fixture = createFixture()
    fixture.sessions.validateWithoutTouch.mockResolvedValue({
      ...ISSUED_SESSION.session,
    })

    const error = await captureError(
      fixture.service.login({
        ...LOGIN_INPUT,
        existingSessionToken: ISSUED_SESSION.tokenValue,
      }),
    )

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT)
    expect(error).toMatchObject({ code: 'ALREADY_AUTHENTICATED' })
    expect(fixture.sessions.validateWithoutTouch).toHaveBeenCalledWith(
      ISSUED_SESSION.tokenValue,
    )
    expect(fixture.subjectHasher.hashUsername).not.toHaveBeenCalled()
    expect(fixture.rateLimits.reserveAttempts).not.toHaveBeenCalled()
    expect(fixture.prisma.user.findUnique).not.toHaveBeenCalled()
    expect(fixture.passwords.verify).not.toHaveBeenCalled()
  })

  it('normalizes username and atomically reserves both HMAC rate-limit buckets before Argon2', async () => {
    const fixture = createFixture()

    await fixture.service.login(LOGIN_INPUT)

    expect(fixture.subjectHasher.hashUsername).toHaveBeenCalledWith('opérator')
    expect(fixture.subjectHasher.hashIp).toHaveBeenCalledWith(SOURCE_IP)
    expect(fixture.rateLimits.reserveAttempts).toHaveBeenCalledWith([
      {
        scope: AuthRateLimitScope.LOGIN_USERNAME,
        subjectKeyHash: USERNAME_HASH,
      },
      {
        scope: AuthRateLimitScope.LOGIN_IP,
        subjectKeyHash: IP_HASH,
      },
    ])
    expect(fixture.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { usernameNormalized: 'opérator' },
      select: {
        id: true,
        username: true,
        usernameNormalized: true,
        displayName: true,
        passwordHash: true,
        status: true,
        mustChangePassword: true,
        authVersion: true,
      },
    })

    expect(
      fixture.rateLimits.reserveAttempts.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.passwords.verify.mock.invocationCallOrder[0],
    )
  })

  it('does not invoke Argon2 when the atomic reservation reports a blocked bucket', async () => {
    const fixture = createFixture()
    fixture.rateLimits.reserveAttempts.mockRejectedValueOnce(
      new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'AUTH_RATE_LIMITED',
        '操作过于频繁，请稍后重试',
      ),
    )

    const error = await captureError(fixture.service.login(LOGIN_INPUT))

    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(error).toMatchObject({ code: 'AUTH_RATE_LIMITED' })
    expect(fixture.passwords.verify).not.toHaveBeenCalled()
    expect(fixture.passwords.verifyWithDummyHash).not.toHaveBeenCalled()
    expect(fixture.prisma.user.findUnique).not.toHaveBeenCalled()
    expect(fixture.metrics.recordLogin).toHaveBeenCalledWith('rate_limited')
    expect(fixture.metrics.recordLogin).toHaveBeenCalledTimes(1)
    expect(fixture.metrics.recordSession).not.toHaveBeenCalled()
  })

  it('uses the fixed dummy verification path for an unknown username', async () => {
    const fixture = createFixture()
    fixture.prisma.user.findUnique.mockResolvedValue(null)

    const error = await captureError(fixture.service.login(LOGIN_INPUT))

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED)
    expect(error).toMatchObject({ code: 'INVALID_CREDENTIALS' })
    expect(fixture.passwords.verifyWithDummyHash).toHaveBeenCalledWith(
      LOGIN_INPUT.password,
    )
    expect(fixture.passwords.verify).not.toHaveBeenCalled()
    expect(fixture.rateLimits.releaseReservation).not.toHaveBeenCalled()
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      {
        eventType: AuditEventType.AUTH_LOGIN_FAILED,
        outcome: AuditOutcome.FAILURE,
        actorType: AuditActorType.ANONYMOUS,
        requestId: REQUEST_ID,
        reasonCode: 'INVALID_CREDENTIALS',
        sourceIpHash: IP_HASH,
      },
    )
    expect(fixture.metrics.recordLogin).toHaveBeenCalledWith('failure')
    expect(fixture.metrics.recordSession).not.toHaveBeenCalled()

    const rawQueryCalls = fixture.transaction.$queryRaw.mock.calls as unknown[][]
    const timeoutQuery = rawQueryCalls[0]?.[0] as {
      strings: readonly string[]
    }
    expect(timeoutQuery.strings.join('')).toContain("set_config('lock_timeout'")
    expect(timeoutQuery.strings.join('')).toContain("set_config('statement_timeout'")
    expect(
      fixture.transaction.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.audit.record.mock.invocationCallOrder[0])

    const auditCalls = fixture.audit.record.mock.calls as unknown[][]
    const auditPayload = JSON.stringify(auditCalls[0]?.[1])
    expect(auditPayload).not.toContain(LOGIN_INPUT.username)
    expect(auditPayload).not.toContain('opérator')
    expect(auditPayload).not.toContain(SOURCE_IP)
    expect(auditPayload).not.toContain(LOGIN_INPUT.password)
  })

  it.each([
    ['a wrong password', UserStatus.ACTIVE, false],
    ['a disabled user', UserStatus.DISABLED, true],
  ])(
    'returns the same public failure and records both buckets for %s',
    async (_label, status, passwordMatches) => {
      const fixture = createFixture()
      fixture.prisma.user.findUnique.mockResolvedValue({
        ...USER_SNAPSHOT,
        status,
      })
      fixture.passwords.verify.mockResolvedValue(passwordMatches)

      const error = await captureError(fixture.service.login(LOGIN_INPUT))

      expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED)
      expect(error).toMatchObject({ code: 'INVALID_CREDENTIALS' })
      expect(fixture.passwords.verify).toHaveBeenCalledWith(
        LOGIN_INPUT.password,
        USER_SNAPSHOT.passwordHash,
      )
      expect(fixture.rateLimits.releaseReservation).not.toHaveBeenCalled()
      expect(fixture.audit.record).toHaveBeenCalledWith(
        fixture.transaction,
        expect.objectContaining({
          eventType: AuditEventType.AUTH_LOGIN_FAILED,
          actorType: AuditActorType.ANONYMOUS,
          reasonCode: 'INVALID_CREDENTIALS',
          sourceIpHash: IP_HASH,
        }),
      )
      expect(fixture.sessions.createInTransaction).not.toHaveBeenCalled()
    },
  )

  it('maps Argon2 queue exhaustion to the fixed capacity contract', async () => {
    const fixture = createFixture()
    fixture.passwords.verify.mockRejectedValue(
      new AuthCapacityUnavailableError(),
    )

    const error = await captureError(fixture.service.login(LOGIN_INPUT))

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(error).toMatchObject({ code: 'AUTH_CAPACITY_UNAVAILABLE' })
    expect(error.publicMessage).not.toContain('Argon2')
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('releases the verified reservation once before starting the successful business transaction', async () => {
    const fixture = createFixture()

    await expect(fixture.service.login(LOGIN_INPUT)).resolves.toEqual({
      issuedSession: ISSUED_SESSION,
      permissions: ['roles:read', 'users:read'],
    })
    expect(fixture.metrics.recordLogin).toHaveBeenCalledWith('success')
    expect(fixture.metrics.recordSession).toHaveBeenCalledWith('created')

    const rawQueryCalls = fixture.transaction.$queryRaw.mock.calls as unknown[][]
    const timeoutQuery = rawQueryCalls[0]?.[0] as {
      strings: readonly string[]
    }
    expect(timeoutQuery.strings.join('')).toContain("set_config('lock_timeout'")
    expect(timeoutQuery.strings.join('')).toContain("set_config('statement_timeout'")

    const lockQuery = rawQueryCalls[1]?.[0] as {
      strings: readonly string[]
      values: readonly unknown[]
    }
    expect(lockQuery.strings.join('')).toContain('FOR UPDATE')
    expect(lockQuery.strings.join('')).toContain('clock_timestamp()')
    expect(lockQuery.strings.join('')).not.toContain(USER_ID)
    expect(lockQuery.values).toContain(USER_ID)
    expect(
      fixture.transaction.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.transaction.$queryRaw.mock.invocationCallOrder[1])
    expect(fixture.transaction.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { lastLoginAt: DATABASE_NOW },
    })
    expect(fixture.sessions.createInTransaction).toHaveBeenCalledWith(
      fixture.transaction,
      {
        id: USER_ID,
        authVersion: USER_SNAPSHOT.authVersion,
        username: USER_SNAPSHOT.username,
        displayName: USER_SNAPSHOT.displayName,
        mustChangePassword: false,
      },
    )
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledTimes(1)
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
    expect(
      fixture.passwords.verify.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.rateLimits.releaseReservation.mock.invocationCallOrder[0],
    )
    expect(
      fixture.rateLimits.releaseReservation.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.prisma.$transaction.mock.invocationCallOrder[0])
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      {
        eventType: AuditEventType.AUTH_LOGIN_SUCCEEDED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: USER_ID,
        targetType: 'User',
        targetId: USER_ID,
        requestId: REQUEST_ID,
        sourceIpHash: IP_HASH,
      },
    )

    const createOrder = fixture.sessions.createInTransaction.mock.invocationCallOrder[0]
    const auditOrder = fixture.audit.record.mock.invocationCallOrder[0]
    expect(createOrder).toBeLessThan(auditOrder)
  })

  it('does not release twice when the business callback completes but the transaction promise rejects', async () => {
    const fixture = createFixture()
    fixture.prisma.$transaction.mockImplementationOnce(
      async (callback: (transaction: TransactionMock) => Promise<unknown>) => {
        await callback(fixture.transaction)
        throw new Error('commit result unknown')
      },
    )

    const error = await captureError(fixture.service.login(LOGIN_INPUT))

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(error).toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' })
    // callback 已完整执行，模拟的是 COMMIT 结果未知，而不是 callback 内回滚。
    expect(fixture.sessions.createInTransaction).toHaveBeenCalledTimes(1)
    expect(fixture.audit.record).toHaveBeenCalledTimes(1)
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledTimes(1)
    expect(
      fixture.rateLimits.releaseReservation.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.prisma.$transaction.mock.invocationCallOrder[0])
  })

  it('fails closed without retrying when the independent reservation release rejects', async () => {
    const fixture = createFixture()
    fixture.rateLimits.releaseReservation.mockRejectedValueOnce(
      new Error('release result unknown: postgresql://secret.invalid/private'),
    )

    const error = await captureError(fixture.service.login(LOGIN_INPUT))

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(error).toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' })
    expect(error.message).not.toContain('postgresql://')
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledTimes(1)
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled()
    expect(fixture.sessions.createInTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['missing user', null],
    ['changed password hash', createLockedUserRow({ passwordHash: 'changed' })],
    ['changed auth version', createLockedUserRow({ authVersion: 5 })],
    ['changed status', createLockedUserRow({ status: UserStatus.DISABLED })],
  ])('fails closed with AUTH_STATE_CHANGED for a %s after verification', async (
    _label,
    lockedRow,
  ) => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw.mockResolvedValue(
      lockedRow === null ? [] : [lockedRow],
    )

    const error = await captureError(fixture.service.login(LOGIN_INPUT))

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT)
    expect(error).toMatchObject({ code: 'AUTH_STATE_CHANGED' })
    expect(fixture.transaction.user.update).not.toHaveBeenCalled()
    expect(fixture.sessions.createInTransaction).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
    expect(fixture.transaction.$executeRaw).not.toHaveBeenCalled()
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
  })

  it('reads permissions in the mutation transaction so a read failure rolls back before session creation', async () => {
    const fixture = createFixture()
    fixture.accessControl.getPermissionCodesInTransaction.mockRejectedValue(
      new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
        '服务器内部错误',
      ),
    )

    const error = await captureError(fixture.service.login(LOGIN_INPUT))

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(error).toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' })
    expect(
      fixture.accessControl.getPermissionCodesInTransaction,
    ).toHaveBeenCalledWith(fixture.transaction, USER_ID)
    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(fixture.accessControl.getPermissionCodes).not.toHaveBeenCalled()
    expect(fixture.sessions.createInTransaction).not.toHaveBeenCalled()
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
  })

  it('does not expose a database or audit error through the login boundary', async () => {
    const fixture = createFixture()
    fixture.audit.record.mockRejectedValue(
      new Error('postgres://secret@example.invalid/private?password=leak'),
    )

    const error = await captureError(fixture.service.login(LOGIN_INPUT))

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(error).toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' })
    expect(error.message).not.toContain('postgres://')
    expect(error.message).not.toContain('password=')
    expect(fixture.metrics.recordLogin).toHaveBeenCalledWith('failure')
    // Session insert发生在随后回滚的事务内，不能伪记为已创建。
    expect(fixture.metrics.recordSession).not.toHaveBeenCalled()
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
  })
})
