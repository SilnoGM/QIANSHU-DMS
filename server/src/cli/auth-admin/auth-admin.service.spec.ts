import type {
  AuditService,
  RecordAuditEventInput,
} from '../../modules/audit/audit.service'
import type { PasswordPolicyProvider } from '../../modules/auth/providers/password-policy.provider'
import type { PasswordProvider } from '../../modules/auth/providers/password.provider'
import { SYSTEM_ADMIN_ROLE_CODE } from '../../modules/access-control/permission.constants'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  SessionRevokedReason,
  UserStatus,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  AuthAdminOperationError,
  AuthAdminService,
} from './auth-admin.service'

const ADMIN_ID = '75e8c923-434f-4d9b-8d15-02cfd9884085'
const ROLE_ID = '27ba88df-0f4a-4aa0-840b-f1916d5fd0bc'
const DATABASE_NOW = new Date('2026-07-17T08:09:10.123Z')
const PASSWORD_HASH = '$argon2id$fixed-test-hash'

interface TransactionFixture {
  $queryRaw: jest.Mock<Promise<unknown>, [unknown]>
  authSession: { updateMany: jest.Mock }
  role: { findUnique: jest.Mock }
  user: { create: jest.Mock; update: jest.Mock }
  userRole: {
    create: jest.Mock
    findFirst: jest.Mock
    findUnique: jest.Mock
  }
}

function createTransaction(): TransactionFixture {
  return {
    $queryRaw: jest.fn<Promise<unknown>, [unknown]>(),
    authSession: { updateMany: jest.fn() },
    role: { findUnique: jest.fn() },
    user: { create: jest.fn(), update: jest.fn() },
    userRole: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  }
}

function createFixture() {
  const transaction = createTransaction()
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(
      (operation: (tx: TransactionFixture) => Promise<unknown>) =>
        operation(transaction),
    ),
  }
  const passwords = { hash: jest.fn().mockResolvedValue(PASSWORD_HASH) }
  const passwordPolicy = {
    assertAcceptable: jest.fn(({ password }: { password: string }) => password),
  }
  const audit = {
    record: jest.fn<
      Promise<{ id: string }>,
      [unknown, RecordAuditEventInput]
    >().mockResolvedValue({ id: 'audit-id' }),
  }
  const service = new AuthAdminService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordProvider,
    passwordPolicy as unknown as PasswordPolicyProvider,
    audit as unknown as AuditService,
  )

  return { audit, passwordPolicy, passwords, prisma, service, transaction }
}

function queryText(query: unknown): string {
  if (
    typeof query === 'object'
    && query !== null
    && 'strings' in query
    && Array.isArray(query.strings)
  ) {
    return query.strings.join('')
  }

  return ''
}

function prepareBootstrapQueries(transaction: TransactionFixture): void {
  transaction.$queryRaw
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: ROLE_ID, code: SYSTEM_ADMIN_ROLE_CODE }])
    .mockResolvedValueOnce([{ now: DATABASE_NOW }])
}

function prepareRecoveryTarget(
  prisma: { user: { findUnique: jest.Mock } },
  status: typeof UserStatus.ACTIVE | typeof UserStatus.DISABLED,
): void {
  prisma.user.findUnique.mockResolvedValue({
    id: ADMIN_ID,
    username: 'RootAdmin',
    usernameNormalized: 'rootadmin',
    status,
    roles: [{ roleId: ROLE_ID }],
  })
}

function prepareRecoveryQueries(
  transaction: TransactionFixture,
  status: typeof UserStatus.ACTIVE | typeof UserStatus.DISABLED,
): void {
  transaction.$queryRaw
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: ROLE_ID, code: SYSTEM_ADMIN_ROLE_CODE }])
    .mockResolvedValueOnce([
      {
        id: ADMIN_ID,
        status,
        authVersion: 4,
        passwordHash: 'old-hash',
      },
    ])
    .mockResolvedValueOnce([{ now: DATABASE_NOW }])
  transaction.userRole.findUnique.mockResolvedValue({
    userId: ADMIN_ID,
    roleId: ROLE_ID,
  })
}

describe('AuthAdminService bootstrap', () => {
  it('serializes bootstrap with an advisory lock, then creates the permanent admin and system Audit atomically', async () => {
    const fixture = createFixture()
    prepareBootstrapQueries(fixture.transaction)
    fixture.transaction.userRole.findFirst.mockResolvedValue(null)
    fixture.transaction.user.create.mockResolvedValue({ id: ADMIN_ID })
    fixture.transaction.userRole.create.mockResolvedValue({
      userId: ADMIN_ID,
      roleId: ROLE_ID,
    })

    await expect(
      fixture.service.bootstrap({
        username: '  RootAdmin  ',
        displayName: '  系统管理员  ',
        password: 'A-strong-permanent-password',
      }),
    ).resolves.toEqual({ userId: ADMIN_ID })

    const queries = fixture.transaction.$queryRaw.mock.calls.map((call) =>
      queryText(call[0]),
    )
    expect(queries[0]).toContain("set_config('lock_timeout'")
    expect(queries[1]).toContain('pg_advisory_xact_lock')
    expect(queries[2]).toContain('FOR UPDATE')
    expect(fixture.passwordPolicy.assertAcceptable).toHaveBeenCalledWith({
      password: 'A-strong-permanent-password',
      username: 'RootAdmin',
      usernameNormalized: 'rootadmin',
    })
    expect(fixture.passwords.hash).toHaveBeenCalledWith(
      'A-strong-permanent-password',
    )
    expect(fixture.transaction.userRole.findFirst).toHaveBeenCalledWith({
      where: { roleId: ROLE_ID },
      select: { userId: true },
    })
    expect(fixture.transaction.user.create).toHaveBeenCalledWith({
      data: {
        username: 'RootAdmin',
        usernameNormalized: 'rootadmin',
        displayName: '系统管理员',
        passwordHash: PASSWORD_HASH,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
        passwordChangedAt: DATABASE_NOW,
        authVersion: 0,
        lastLoginAt: null,
        createdByUserId: null,
      },
      select: { id: true },
    })
    expect(fixture.transaction.userRole.create).toHaveBeenCalledWith({
      data: { userId: ADMIN_ID, roleId: ROLE_ID },
    })
    const bootstrapAudit = fixture.audit.record.mock.calls[0]?.[1]
    expect(bootstrapAudit?.requestId).toMatch(/^cli:[0-9a-f-]{36}$/u)
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction, {
      eventType: AuditEventType.SYSTEM_BOOTSTRAP,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.SYSTEM,
      targetType: 'User',
      targetId: ADMIN_ID,
      requestId: bootstrapAudit?.requestId,
    })
    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('refuses bootstrap when any UserRole already points to system_admin', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: ROLE_ID, code: SYSTEM_ADMIN_ROLE_CODE }])
    fixture.transaction.userRole.findFirst.mockResolvedValue({
      userId: ADMIN_ID,
    })

    await expect(
      fixture.service.bootstrap({
        username: 'another-admin',
        displayName: '另一个管理员',
        password: 'Another-strong-password',
      }),
    ).rejects.toMatchObject<Pick<AuthAdminOperationError, 'code'>>({
      code: 'SYSTEM_ADMIN_ALREADY_BOOTSTRAPPED',
    })

    expect(fixture.transaction.user.create).not.toHaveBeenCalled()
    expect(fixture.transaction.userRole.create).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('propagates a fixed failure when Audit rejects so the surrounding transaction can roll back', async () => {
    const fixture = createFixture()
    prepareBootstrapQueries(fixture.transaction)
    fixture.transaction.userRole.findFirst.mockResolvedValue(null)
    fixture.transaction.user.create.mockResolvedValue({ id: ADMIN_ID })
    fixture.transaction.userRole.create.mockResolvedValue({})
    fixture.audit.record.mockRejectedValue(
      new Error('password=A-strong-permanent-password'),
    )

    await expect(
      fixture.service.bootstrap({
        username: 'rootadmin',
        displayName: '系统管理员',
        password: 'A-strong-permanent-password',
      }),
    ).rejects.toMatchObject<Pick<AuthAdminOperationError, 'code' | 'message'>>({
      code: 'SYSTEM_ADMIN_OPERATION_FAILED',
      message: '系统管理员操作失败',
    })
  })
})

describe('AuthAdminService recovery', () => {
  it('only inspects an existing system_admin membership', async () => {
    const fixture = createFixture()
    prepareRecoveryTarget(fixture.prisma, UserStatus.DISABLED)

    await expect(
      fixture.service.inspectRecoveryTarget(' ROOTADMIN '),
    ).resolves.toEqual({ userId: ADMIN_ID, status: UserStatus.DISABLED })
    expect(fixture.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { usernameNormalized: 'rootadmin' },
      select: {
        id: true,
        username: true,
        usernameNormalized: true,
        status: true,
        roles: {
          where: { role: { code: SYSTEM_ADMIN_ROLE_CODE } },
          select: { roleId: true },
          take: 1,
        },
      },
    })
  })

  it.each([
    [false, undefined],
    [true, UserStatus.ACTIVE],
  ] as const)(
    'recovers a disabled administrator with enableDisabled=%s and revokes every Session',
    async (enableDisabled, expectedStatus) => {
      const fixture = createFixture()
      prepareRecoveryTarget(fixture.prisma, UserStatus.DISABLED)
      prepareRecoveryQueries(fixture.transaction, UserStatus.DISABLED)
      fixture.transaction.user.update.mockResolvedValue({ id: ADMIN_ID })
      fixture.transaction.authSession.updateMany.mockResolvedValue({ count: 2 })

      await expect(
        fixture.service.recover({
          username: 'rootadmin',
          password: 'A-new-strong-permanent-password',
          enableDisabled,
        }),
      ).resolves.toEqual({ userId: ADMIN_ID, enabled: enableDisabled })

      expect(fixture.transaction.user.update).toHaveBeenCalledWith({
        where: { id: ADMIN_ID },
        data: {
          passwordHash: PASSWORD_HASH,
          passwordChangedAt: DATABASE_NOW,
          mustChangePassword: false,
          authVersion: { increment: 1 },
          ...(expectedStatus === undefined
            ? {}
            : {
                status: expectedStatus,
                disabledAt: null,
                disabledByUserId: null,
              }),
        },
        select: { id: true },
      })
      expect(fixture.transaction.authSession.updateMany).toHaveBeenCalledWith({
        where: { userId: ADMIN_ID, revokedAt: null },
        data: {
          revokedAt: DATABASE_NOW,
          revokedReason: SessionRevokedReason.ADMIN_RECOVERY,
        },
      })
      const recoveryAudit = fixture.audit.record.mock.calls[0]?.[1]
      expect(recoveryAudit?.requestId).toMatch(/^cli:[0-9a-f-]{36}$/u)
      expect(fixture.passwordPolicy.assertAcceptable).toHaveBeenCalledWith({
        password: 'A-new-strong-permanent-password',
        username: 'RootAdmin',
        usernameNormalized: 'rootadmin',
      })
      expect(fixture.passwords.hash).toHaveBeenCalledWith(
        'A-new-strong-permanent-password',
      )
      expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction, {
        eventType: AuditEventType.SYSTEM_ADMIN_RECOVERED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.SYSTEM,
        targetType: 'User',
        targetId: ADMIN_ID,
        requestId: recoveryAudit?.requestId,
        metadata: { enabledDisabledUser: enableDisabled },
      })
      const timeoutQuery = fixture.transaction.$queryRaw.mock.calls[0]?.[0]
      expect(timeoutQuery).toBeDefined()
      expect(queryText(timeoutQuery)).toContain(
        "set_config('lock_timeout'",
      )
      const roleLockQuery = fixture.transaction.$queryRaw.mock.calls[1]?.[0]
      const userLockQuery = fixture.transaction.$queryRaw.mock.calls[2]?.[0]
      expect(queryText(roleLockQuery)).toContain('FROM "roles"')
      expect(queryText(userLockQuery)).toContain('FROM "users"')
    },
  )

  it('rechecks system_admin membership under the Role and User locks before changing credentials', async () => {
    const fixture = createFixture()
    prepareRecoveryTarget(fixture.prisma, UserStatus.ACTIVE)
    prepareRecoveryQueries(fixture.transaction, UserStatus.ACTIVE)
    fixture.transaction.userRole.findUnique.mockResolvedValue(null)

    await expect(
      fixture.service.recover({
        username: 'rootadmin',
        password: 'A-new-strong-permanent-password',
        enableDisabled: false,
      }),
    ).rejects.toMatchObject<Pick<AuthAdminOperationError, 'code'>>({
      code: 'SYSTEM_ADMIN_RECOVERY_TARGET_INVALID',
    })

    expect(fixture.transaction.user.update).not.toHaveBeenCalled()
    expect(fixture.transaction.authSession.updateMany).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })
})
