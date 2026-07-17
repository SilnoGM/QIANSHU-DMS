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
    assertAllowed: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
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

  const service = new PasswordChangeService(
    prisma as unknown as PrismaService,
    sessions as unknown as AuthSessionService,
    rateLimits as unknown as AuthRateLimitService,
    subjectHasher as unknown as AuthSubjectHasher,
    passwords as unknown as PasswordProvider,
    policy as unknown as PasswordPolicyProvider,
    audit,
    accessControl as unknown as AccessControlService,
  )

  return {
    accessControl,
    audit,
    passwords,
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
  it('checks user and IP failure buckets before verifying a normal current password', async () => {
    const fixture = createFixture()

    await fixture.service.change(CHANGE_INPUT)

    expect(fixture.subjectHasher.hashUserId).toHaveBeenCalledWith(USER_ID)
    expect(fixture.rateLimits.assertAllowed).toHaveBeenNthCalledWith(
      1,
      AuthRateLimitScope.PASSWORD_CHANGE_USER,
      USER_HASH,
    )
    expect(fixture.rateLimits.assertAllowed).toHaveBeenNthCalledWith(
      2,
      AuthRateLimitScope.PASSWORD_CHANGE_IP,
      IP_HASH,
    )
    const lastRateCheck = Math.max(
      ...fixture.rateLimits.assertAllowed.mock.invocationCallOrder,
    )
    expect(lastRateCheck).toBeLessThan(
      fixture.passwords.verify.mock.invocationCallOrder[0],
    )
  })

  it('records both buckets and returns fixed CURRENT_PASSWORD_INVALID', async () => {
    const fixture = createFixture()
    fixture.passwords.verify.mockReset().mockResolvedValue(false)

    const error = await captureApiError(
      fixture.service.change(CHANGE_INPUT),
    )

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(error).toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' })
    expect(fixture.rateLimits.recordFailure).toHaveBeenCalledTimes(2)
    expect(fixture.policy.assertAcceptable).not.toHaveBeenCalled()
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled()
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
    expect(fixture.rateLimits.recordFailure).toHaveBeenCalledTimes(2)
  })

  it('uses a forced Session as admission and does not depend on currentPassword', async () => {
    const fixture = createFixture({ forced: true })

    await fixture.service.change({
      ...CHANGE_INPUT,
      auth: { ...AUTH_CONTEXT, mustChangePassword: true },
      currentPassword: 'intentionally ignored',
    })

    expect(fixture.rateLimits.assertAllowed).not.toHaveBeenCalled()
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
  })

  it('locks User then current Session and atomically rotates all Sessions', async () => {
    const fixture = createFixture()

    await expect(fixture.service.change(CHANGE_INPUT)).resolves.toEqual({
      issuedSession: ISSUED_SESSION,
      permissions: ['users:read'],
    })

    expect(fixture.transaction.$queryRaw).toHaveBeenCalledTimes(3)
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
  })

  it.each([
    ['changed password hash', { passwordHash: '$argon2id$other' }],
    ['changed auth version', { authVersion: 7 }],
    ['changed force flag', { mustChangePassword: true }],
    ['disabled user', { status: UserStatus.DISABLED }],
  ])('returns AUTH_STATE_CHANGED for a %s after hashing', async (_label, change) => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw.mockReset().mockResolvedValueOnce([
      { ...fixture.snapshot, ...change },
    ])

    const error = await captureApiError(
      fixture.service.change(CHANGE_INPUT),
    )

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT)
    expect(error).toMatchObject({ code: 'AUTH_STATE_CHANGED' })
    expect(fixture.transaction.user.update).not.toHaveBeenCalled()
  })

  it('returns AUTH_STATE_CHANGED when the current Session is no longer usable', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockReset()
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
  })
})
