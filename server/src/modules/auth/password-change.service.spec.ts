import { HttpStatus } from '@nestjs/common'

import { AccessControlService } from '../access-control/access-control.service'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  AuthRateLimitScope,
  SessionRevokedReason,
  UserStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { AuthMetricLogger } from '../../infrastructure/observability/auth-metric.logger'
import type { RequestAuthContext } from './auth-context'
import { AuthSessionService, type IssuedSession } from './auth-session.service'
import { PasswordChangeService } from './password-change.service'
import { AuthRateLimitService } from './providers/auth-rate-limit.service'
import { AuthSubjectHasher } from './providers/auth-subject-hasher'
import { PasswordPolicyProvider } from './providers/password-policy.provider'
import {
  AuthCapacityUnavailableError,
  PasswordProvider,
} from './providers/password.provider'

const USER_ID = '8ac94425-c78c-4b32-ae2d-e3ce808b0275'
const SESSION_ID = 'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1'
const DATABASE_NOW = new Date('2026-07-17T08:00:00.000Z')
const USER_HASH = Buffer.alloc(32, 0x31)
const IP_HASH = Buffer.alloc(32, 0x32)
const RATE_LIMIT_RESERVATION = Object.freeze({
  entries: Object.freeze([
    Object.freeze({
      scope: AuthRateLimitScope.PASSWORD_CHANGE_IP,
      subjectKeyHash: IP_HASH,
      bucketStartedAtKey: '2026-07-17 08:00:00+00',
    }),
    Object.freeze({
      scope: AuthRateLimitScope.PASSWORD_CHANGE_USER,
      subjectKeyHash: USER_HASH,
      bucketStartedAtKey: '2026-07-17 08:00:00+00',
    }),
  ]),
})

const AUTH_CONTEXT: RequestAuthContext = Object.freeze({
  sessionId: SESSION_ID,
  userId: USER_ID,
  username: 'operator',
  displayName: '操作员',
  mustChangePassword: false,
  createdAt: '2026-07-17T07:00:00.000Z',
  lastActivityAt: '2026-07-17T07:55:00.000Z',
  idleExpiresAt: '2026-07-19T07:55:00.000Z',
  absoluteExpiresAt: '2026-08-16T07:00:00.000Z',
})

const USER_SNAPSHOT = {
  id: USER_ID,
  username: 'operator',
  usernameNormalized: 'operator',
  displayName: '操作员',
  passwordHash: '$argon2id$current',
  status: UserStatus.ACTIVE,
  mustChangePassword: false,
  authVersion: 4,
} as const

const ISSUED_SESSION: IssuedSession = {
  tokenValue: `${SESSION_ID}.${Buffer.alloc(32, 1).toString('base64url')}`,
  session: {
    id: '50bb305c-94f7-4cb3-b27d-a32ec6e18448',
    userId: USER_ID,
    username: USER_SNAPSHOT.username,
    displayName: USER_SNAPSHOT.displayName,
    mustChangePassword: false,
    createdAt: DATABASE_NOW,
    lastActivityAt: DATABASE_NOW,
    idleExpiresAt: new Date('2026-07-19T08:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-08-16T08:00:00.000Z'),
  },
}

type TransactionMock = {
  $queryRaw: jest.Mock
  $executeRaw: jest.Mock
  user: { update: jest.Mock }
}

function createFixture(overrides: { forced?: boolean } = {}) {
  const mustChangePassword = overrides.forced ?? false
  const snapshot = { ...USER_SNAPSHOT, mustChangePassword }
  const transaction: TransactionMock = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([snapshot])
      .mockResolvedValueOnce([
        {
          userId: USER_ID,
          authVersion: snapshot.authVersion,
          revokedAt: null,
          idleExpiresAt: new Date('2026-07-19T08:00:00.000Z'),
          absoluteExpiresAt: new Date('2026-08-16T08:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }]),
    $executeRaw: jest.fn().mockResolvedValue(2),
    user: {
      update: jest.fn().mockResolvedValue({
        ...snapshot,
        passwordHash: '$argon2id$new',
        mustChangePassword: false,
        authVersion: snapshot.authVersion + 1,
      }),
    },
  }
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(snapshot) },
    $transaction: jest.fn(
      (callback: (tx: TransactionMock) => Promise<unknown>) =>
        Promise.resolve(callback(transaction)),
    ),
  }
  const sessions = {
    revokeAllForUserInTransaction: jest.fn().mockResolvedValue(1),
    createInTransaction: jest.fn().mockResolvedValue(ISSUED_SESSION),
  }
  const rateLimits = {
    reserveAttempts: jest.fn().mockResolvedValue(RATE_LIMIT_RESERVATION),
    releaseReservation: jest.fn().mockResolvedValue(undefined),
  }
  const subjectHasher = {
    hashUserId: jest.fn().mockReturnValue(USER_HASH),
    hashIp: jest.fn().mockReturnValue(IP_HASH),
  }
  const passwords = {
    verify: mustChangePassword
      ? jest.fn().mockResolvedValue(false)
      : jest
          .fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false),
    hash: jest.fn().mockResolvedValue('$argon2id$new'),
  }
  const policy = {
    assertAcceptable: jest.fn().mockReturnValue('new secure password 2026'),
  }
  const audit = { record: jest.fn().mockResolvedValue({}) }
  const accessControl = {
    getPermissionCodesInTransaction: jest
      .fn()
      .mockResolvedValue(['users:read']),
  }
  const metrics: jest.Mocked<Pick<
    AuthMetricLogger,
    'recordPassword' | 'recordSession' | 'recordSessionRevoked'
  >> = {
    recordPassword: jest.fn(),
    recordSession: jest.fn(),
    recordSessionRevoked: jest.fn(),
  }

  const service = new PasswordChangeService(
    prisma as unknown as PrismaService,
    sessions as unknown as AuthSessionService,
    rateLimits as unknown as AuthRateLimitService,
    subjectHasher as unknown as AuthSubjectHasher,
    passwords as unknown as PasswordProvider,
    policy as unknown as PasswordPolicyProvider,
    audit,
    accessControl as unknown as AccessControlService,
    metrics as unknown as AuthMetricLogger,
  )

  return {
    accessControl,
    audit,
    passwords,
    metrics,
    policy,
    prisma,
    rateLimits,
    service,
    sessions,
    snapshot,
    subjectHasher,
    transaction,
  }
}

const CHANGE_INPUT = {
  auth: AUTH_CONTEXT,
  currentPassword: 'current secure password',
  newPassword: 'new secure password 2026',
  sourceIp: '192.0.2.10',
  requestId: 'req_b19b2237-b935-462d-a818-02cc67b051c2',
} as const

async function captureApiError(operation: Promise<unknown>): Promise<ApiException> {
  const error = await operation.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ApiException)
  return error as ApiException
}

describe('PasswordChangeService', () => {
  it('atomically reserves user and IP buckets before verifying a normal current password', async () => {
    const fixture = createFixture()

    await fixture.service.change(CHANGE_INPUT)

    expect(fixture.subjectHasher.hashUserId).toHaveBeenCalledWith(USER_ID)
    expect(fixture.rateLimits.reserveAttempts).toHaveBeenCalledWith([
      {
        scope: AuthRateLimitScope.PASSWORD_CHANGE_USER,
        subjectKeyHash: USER_HASH,
      },
      {
        scope: AuthRateLimitScope.PASSWORD_CHANGE_IP,
        subjectKeyHash: IP_HASH,
      },
    ])
    expect(
      fixture.rateLimits.reserveAttempts.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.passwords.verify.mock.invocationCallOrder[0],
    )
  })

  it('keeps both reserved buckets and returns fixed CURRENT_PASSWORD_INVALID', async () => {
    const fixture = createFixture()
    fixture.passwords.verify.mockReset().mockResolvedValue(false)

    const error = await captureApiError(
      fixture.service.change(CHANGE_INPUT),
    )

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(error).toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' })
    expect(fixture.rateLimits.releaseReservation).not.toHaveBeenCalled()
    expect(fixture.policy.assertAcceptable).not.toHaveBeenCalled()
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled()
    expect(fixture.metrics.recordPassword).toHaveBeenCalledWith(
      'change',
      'failure',
    )
  })

  it('treats a missing normal current password as the same fixed failure', async () => {
    const fixture = createFixture()
    const withoutCurrent = {
      auth: CHANGE_INPUT.auth,
      newPassword: CHANGE_INPUT.newPassword,
      sourceIp: CHANGE_INPUT.sourceIp,
      requestId: CHANGE_INPUT.requestId,
    }

    const error = await captureApiError(
      fixture.service.change(withoutCurrent),
    )

    expect(error).toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' })
    expect(fixture.passwords.verify).not.toHaveBeenCalled()
    expect(fixture.rateLimits.releaseReservation).not.toHaveBeenCalled()
  })

  it('uses a forced Session as admission and does not depend on currentPassword', async () => {
    const fixture = createFixture({ forced: true })

    await fixture.service.change({
      ...CHANGE_INPUT,
      auth: { ...AUTH_CONTEXT, mustChangePassword: true },
      currentPassword: 'intentionally ignored',
    })

    expect(fixture.rateLimits.reserveAttempts).not.toHaveBeenCalled()
    // forced mode only verifies that the new password differs from the old hash.
    expect(fixture.passwords.verify).toHaveBeenCalledTimes(1)
    expect(fixture.passwords.verify).toHaveBeenCalledWith(
      CHANGE_INPUT.newPassword,
      USER_SNAPSHOT.passwordHash,
    )
  })

  it('rejects a new password that matches the current hash', async () => {
    const fixture = createFixture()
    fixture.passwords.verify
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    const error = await captureApiError(
      fixture.service.change(CHANGE_INPUT),
    )

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(error).toMatchObject({ code: 'PASSWORD_MUST_DIFFER' })
    expect(fixture.passwords.hash).not.toHaveBeenCalled()
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
  })

  it('releases the verified reservation once before rotating password and Sessions', async () => {
    const fixture = createFixture()

    await expect(fixture.service.change(CHANGE_INPUT)).resolves.toEqual({
      issuedSession: ISSUED_SESSION,
      permissions: ['users:read'],
    })

    expect(fixture.transaction.$queryRaw).toHaveBeenCalledTimes(4)
    const rawQueryCalls = fixture.transaction.$queryRaw.mock.calls as unknown[][]
    const timeoutQuery = rawQueryCalls[0]?.[0] as {
      strings: readonly string[]
    }
    expect(timeoutQuery.strings.join('')).toContain("set_config('lock_timeout'")
    expect(timeoutQuery.strings.join('')).toContain("set_config('statement_timeout'")
    expect(
      fixture.transaction.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.transaction.$queryRaw.mock.invocationCallOrder[1])
    expect(fixture.transaction.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        passwordHash: '$argon2id$new',
        passwordChangedAt: DATABASE_NOW,
        mustChangePassword: false,
        authVersion: { increment: 1 },
      },
    })
    expect(fixture.sessions.revokeAllForUserInTransaction).toHaveBeenCalledWith(
      fixture.transaction,
      USER_ID,
      SessionRevokedReason.PASSWORD_CHANGED,
    )
    expect(fixture.sessions.createInTransaction).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        id: USER_ID,
        authVersion: 5,
        mustChangePassword: false,
      }),
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
    ).toBeLessThan(fixture.policy.assertAcceptable.mock.invocationCallOrder[0])
    expect(
      fixture.rateLimits.releaseReservation.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.prisma.$transaction.mock.invocationCallOrder[0])
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction, {
      eventType: AuditEventType.USER_PASSWORD_CHANGED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: USER_ID,
      targetType: 'User',
      targetId: USER_ID,
      requestId: CHANGE_INPUT.requestId,
      sourceIpHash: IP_HASH,
    })
    expect(fixture.metrics.recordPassword).toHaveBeenCalledWith(
      'change',
      'success',
    )
    expect(fixture.metrics.recordSessionRevoked).toHaveBeenCalledWith(1)
    expect(fixture.metrics.recordSession).toHaveBeenCalledWith('created')
  })

  it('does not release twice when the rotation callback completes but the transaction promise rejects', async () => {
    const fixture = createFixture()
    fixture.prisma.$transaction.mockImplementationOnce(
      async (callback: (transaction: TransactionMock) => Promise<unknown>) => {
        await callback(fixture.transaction)
        throw new Error('commit result unknown')
      },
    )

    const error = await captureApiError(fixture.service.change(CHANGE_INPUT))

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

    const error = await captureApiError(fixture.service.change(CHANGE_INPUT))

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(error).toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' })
    expect(error.message).not.toContain('postgresql://')
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledTimes(1)
    expect(fixture.policy.assertAcceptable).not.toHaveBeenCalled()
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled()
    expect(fixture.sessions.createInTransaction).not.toHaveBeenCalled()
  })

  it('does not report committed password or Session success when the transaction rolls back', async () => {
    const fixture = createFixture()
    fixture.audit.record.mockRejectedValue(new Error('audit failure canary'))

    const error = await captureApiError(fixture.service.change(CHANGE_INPUT))

    expect(error).toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' })
    expect(fixture.metrics.recordPassword).toHaveBeenCalledWith(
      'change',
      'failure',
    )
    expect(fixture.metrics.recordSessionRevoked).not.toHaveBeenCalled()
    expect(fixture.metrics.recordSession).not.toHaveBeenCalled()
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['changed password hash', { passwordHash: '$argon2id$other' }],
    ['changed auth version', { authVersion: 7 }],
    ['changed force flag', { mustChangePassword: true }],
    ['disabled user', { status: UserStatus.DISABLED }],
  ])('returns AUTH_STATE_CHANGED for a %s after hashing', async (_label, change) => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...fixture.snapshot, ...change }])

    const error = await captureApiError(
      fixture.service.change(CHANGE_INPUT),
    )

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT)
    expect(error).toMatchObject({ code: 'AUTH_STATE_CHANGED' })
    expect(fixture.transaction.user.update).not.toHaveBeenCalled()
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
  })

  it('returns AUTH_STATE_CHANGED when the current Session is no longer usable', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fixture.snapshot])
      .mockResolvedValueOnce([
        {
          userId: USER_ID,
          authVersion: 4,
          revokedAt: DATABASE_NOW,
          idleExpiresAt: new Date('2026-07-19T08:00:00.000Z'),
          absoluteExpiresAt: new Date('2026-08-16T08:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])

    const error = await captureApiError(
      fixture.service.change(CHANGE_INPUT),
    )

    expect(error).toMatchObject({ code: 'AUTH_STATE_CHANGED' })
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
  })

  it('maps Argon2 queue exhaustion to AUTH_CAPACITY_UNAVAILABLE', async () => {
    const fixture = createFixture()
    fixture.passwords.verify.mockReset().mockRejectedValue(
      new AuthCapacityUnavailableError(),
    )

    const error = await captureApiError(
      fixture.service.change(CHANGE_INPUT),
    )

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(error).toMatchObject({ code: 'AUTH_CAPACITY_UNAVAILABLE' })
    expect(fixture.rateLimits.releaseReservation).toHaveBeenCalledWith(
      RATE_LIMIT_RESERVATION,
    )
  })
})
