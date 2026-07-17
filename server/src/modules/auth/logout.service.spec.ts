import { HttpStatus } from '@nestjs/common'

import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  SessionRevokedReason,
  UserStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { RequestAuthContext } from './auth-context'
import { AuthSessionService } from './auth-session.service'
import { LogoutService } from './logout.service'
import { AuthSubjectHasher } from './providers/auth-subject-hasher'

const USER_ID = '8ac94425-c78c-4b32-ae2d-e3ce808b0275'
const SESSION_ID = 'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1'
const DATABASE_NOW = new Date('2026-07-17T09:00:00.000Z')
const IP_HASH = Buffer.alloc(32, 0x41)

const AUTH_CONTEXT: RequestAuthContext = Object.freeze({
  sessionId: SESSION_ID,
  userId: USER_ID,
  username: 'operator',
  displayName: '操作员',
  mustChangePassword: false,
  createdAt: '2026-07-17T08:00:00.000Z',
  lastActivityAt: '2026-07-17T08:55:00.000Z',
  idleExpiresAt: '2026-07-19T08:55:00.000Z',
  absoluteExpiresAt: '2026-08-16T08:00:00.000Z',
})

function createFixture() {
  const transaction = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: USER_ID, status: UserStatus.ACTIVE, authVersion: 4 },
      ])
      .mockResolvedValueOnce([
        {
          userId: USER_ID,
          authVersion: 4,
          revokedAt: null,
          idleExpiresAt: new Date('2026-07-19T09:00:00.000Z'),
          absoluteExpiresAt: new Date('2026-08-16T09:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }]),
    user: {
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const prisma = {
    $transaction: jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        Promise.resolve(callback(transaction)),
    ),
  }
  const sessions = {
    revokeSessionInTransaction: jest.fn().mockResolvedValue(true),
    revokeAllForUserInTransaction: jest.fn().mockResolvedValue(2),
  }
  const subjectHasher = { hashIp: jest.fn().mockReturnValue(IP_HASH) }
  const audit = { record: jest.fn().mockResolvedValue({}) }
  const service = new LogoutService(
    prisma as unknown as PrismaService,
    sessions as unknown as AuthSessionService,
    subjectHasher as unknown as AuthSubjectHasher,
    audit,
  )

  return { audit, prisma, service, sessions, subjectHasher, transaction }
}

const INPUT = {
  auth: AUTH_CONTEXT,
  sourceIp: '192.0.2.20',
  requestId: 'req_7d2253ce-3e47-4d5e-8780-01de57e8d093',
} as const

async function captureApiError(operation: Promise<unknown>): Promise<ApiException> {
  const error = await operation.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ApiException)
  return error as ApiException
}

describe('LogoutService', () => {
  it('keeps optional logout idempotent when no valid Session context exists', async () => {
    const fixture = createFixture()

    await expect(
      fixture.service.logout({ ...INPUT, auth: null }),
    ).resolves.toBeUndefined()

    expect(fixture.prisma.$transaction).not.toHaveBeenCalled()
    expect(fixture.sessions.revokeSessionInTransaction).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('revokes only the current active Session and audits in one transaction', async () => {
    const fixture = createFixture()

    await fixture.service.logout(INPUT)

    expect(fixture.subjectHasher.hashIp).toHaveBeenCalledWith(INPUT.sourceIp)
    expect(fixture.sessions.revokeSessionInTransaction).toHaveBeenCalledWith(
      fixture.transaction,
      SESSION_ID,
      SessionRevokedReason.LOGOUT,
    )
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction, {
      eventType: AuditEventType.AUTH_LOGOUT,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: USER_ID,
      targetType: 'AuthSession',
      targetId: SESSION_ID,
      requestId: INPUT.requestId,
      sourceIpHash: IP_HASH,
    })
    const rawQueryCalls = fixture.transaction.$queryRaw.mock.calls as unknown[][]
    const timeoutQuery = rawQueryCalls[0]?.[0] as {
      strings: readonly string[]
    }
    expect(timeoutQuery.strings.join('')).toContain("set_config('lock_timeout'")
    expect(timeoutQuery.strings.join('')).toContain("set_config('statement_timeout'")
    expect(
      fixture.transaction.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.sessions.revokeSessionInTransaction.mock.invocationCallOrder[0],
    )
  })

  it('does not write a duplicate audit when a racing request already revoked the Session', async () => {
    const fixture = createFixture()
    fixture.sessions.revokeSessionInTransaction.mockResolvedValue(false)

    await fixture.service.logout(INPUT)

    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('locks User and current Session before logout-all version invalidation', async () => {
    const fixture = createFixture()

    await fixture.service.logoutAll(INPUT)

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
      data: { authVersion: { increment: 1 } },
    })
    expect(fixture.sessions.revokeAllForUserInTransaction).toHaveBeenCalledWith(
      fixture.transaction,
      USER_ID,
      SessionRevokedReason.LOGOUT_ALL,
    )
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction, {
      eventType: AuditEventType.AUTH_LOGOUT_ALL,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: USER_ID,
      targetType: 'User',
      targetId: USER_ID,
      requestId: INPUT.requestId,
      sourceIpHash: IP_HASH,
    })
  })

  it.each([
    ['disabled User', { user: { status: UserStatus.DISABLED } }],
    ['stale auth version', { user: { authVersion: 5 } }],
    ['revoked Session', { session: { revokedAt: DATABASE_NOW } }],
  ])('returns AUTH_STATE_CHANGED for logout-all with a %s', async (_label, change) => {
    const fixture = createFixture()
    const user = {
      id: USER_ID,
      status: UserStatus.ACTIVE,
      authVersion: 4,
      ...('user' in change ? change.user : {}),
    }
    const session = {
      userId: USER_ID,
      authVersion: 4,
      revokedAt: null,
      idleExpiresAt: new Date('2026-07-19T09:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-08-16T09:00:00.000Z'),
      ...('session' in change ? change.session : {}),
    }
    fixture.transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([user])
      .mockResolvedValueOnce([session])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])

    const error = await captureApiError(fixture.service.logoutAll(INPUT))

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT)
    expect(error).toMatchObject({ code: 'AUTH_STATE_CHANGED' })
    expect(fixture.transaction.user.update).not.toHaveBeenCalled()
  })

  it('maps storage failures to a fixed service-unavailable response', async () => {
    const fixture = createFixture()
    fixture.prisma.$transaction.mockRejectedValue(
      new Error('postgres://secret@example.invalid/private'),
    )

    const error = await captureApiError(fixture.service.logout(INPUT))

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(error).toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' })
    expect(error.message).not.toContain('postgres://')
  })
})
