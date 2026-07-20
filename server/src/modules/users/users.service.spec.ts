import { HttpStatus } from '@nestjs/common'

import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AuditService } from '../audit/audit.service'
import type { PasswordPolicyProvider } from '../auth/providers/password-policy.provider'
import type { PasswordProvider } from '../auth/providers/password.provider'
import { SessionRevokedReason, UserStatus } from '../../generated/prisma/enums'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { AuthMetricLogger } from '../../infrastructure/observability/auth-metric.logger'
import { SYSTEM_ADMIN_ROLE_CODE } from '../access-control/permission.constants'
import { UpdateUserRequestDto } from './dto/update-user-request.dto'
import { UsersService, type UsersCommandContext } from './users.service'

const ACTOR_ID = '02ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const TARGET_ID = '12ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const SESSION_ID = '22ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const SYSTEM_ROLE_ID = '32ad40d4-7fa5-46fb-81e4-1986bcebf8f4'
const ROLE_A_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f5'
const ROLE_B_ID = '52ad40d4-7fa5-46fb-81e4-1986bcebf8f6'
const DATABASE_NOW = new Date('2026-07-17T06:00:00.000Z')

const context: UsersCommandContext = {
  actorUserId: ACTOR_ID,
  actorSessionId: SESSION_ID,
  requestId: 'req-users-1',
}

interface UserFixture {
  id: string
  username: string
  usernameNormalized: string
  displayName: string
  passwordHash: string
  status: UserStatus
  mustChangePassword: boolean
  authVersion: number
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
  roles: Array<{ roleId: string }>
  profile: {
    email: string | null
    mobileE164: string | null
    avatarUrl: string | null
    remark: string | null
    createdAt: Date
    updatedAt: Date
  } | null
}

type AsyncReaderMock = jest.Mock<Promise<unknown>, [unknown]>

interface SqlShape {
  strings: readonly string[]
  values: unknown[]
}

function getSqlText(value: unknown): string {
  if (
    typeof value !== 'object'
    || value === null
    || !('strings' in value)
    || !Array.isArray(value.strings)
  ) {
    throw new Error('Expected Prisma SQL object')
  }

  return (value as SqlShape).strings.join(' ')
}

function getSqlValues(value: unknown): unknown[] {
  if (
    typeof value !== 'object'
    || value === null
    || !('values' in value)
    || !Array.isArray(value.values)
  ) {
    throw new Error('Expected Prisma SQL object')
  }

  return (value as SqlShape).values
}

/**
 * 防止后续新增 User 写事务时遗漏 PostgreSQL transaction-local timeout。
 * 除了验证 SQL 内容，也验证 timeout 查询早于 callback 内的首个业务数据库调用。
 */
function expectTransactionTimeoutAppliedFirst(
  transaction: TransactionFixture,
): void {
  const firstQuery = transaction.$queryRaw.mock.calls[0]?.[0]
  expect(getSqlText(firstQuery)).toContain("set_config('lock_timeout'")
  expect(getSqlText(firstQuery)).toContain("set_config('statement_timeout'")

  const timeoutCallOrder = transaction.$queryRaw.mock.invocationCallOrder[0]
  const businessCallOrders = [
    transaction.user.create,
    transaction.user.findUnique,
    transaction.user.update,
    transaction.role.findMany,
    transaction.role.findUnique,
    transaction.userRole.count,
    transaction.userRole.createMany,
    transaction.userRole.deleteMany,
    transaction.userRole.findMany,
    transaction.userRole.findUnique,
    transaction.authSession.updateMany,
  ].flatMap((mock) => mock.mock.invocationCallOrder)

  expect(timeoutCallOrder).toBeDefined()
  expect(businessCallOrders.length).toBeGreaterThan(0)
  expect(timeoutCallOrder).toBeLessThan(Math.min(...businessCallOrders))
}

function prepareUpdateTarget(
  transaction: TransactionFixture,
  present = true,
): void {
  transaction.$queryRaw
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(present
      ? [{
          id: TARGET_ID,
          status: UserStatus.ACTIVE,
          authVersion: 3,
          passwordHash: 'old-password-hash',
        }]
      : [])
}

interface TransactionFixture {
  $queryRaw: AsyncReaderMock
  user: {
    create: AsyncReaderMock
    findUnique: AsyncReaderMock
    update: AsyncReaderMock
  }
  role: {
    findMany: AsyncReaderMock
    findUnique: AsyncReaderMock
  }
  userRole: {
    count: AsyncReaderMock
    createMany: AsyncReaderMock
    deleteMany: AsyncReaderMock
    findMany: AsyncReaderMock
    findUnique: AsyncReaderMock
  }
  authSession: {
    updateMany: AsyncReaderMock
  }
}

interface PrismaFixture {
  user: {
    count: AsyncReaderMock
    findMany: AsyncReaderMock
    findUnique: AsyncReaderMock
  }
  role: {
    findMany: AsyncReaderMock
    findUnique: AsyncReaderMock
  }
  $transaction: jest.Mock<
    Promise<unknown>,
    [(transaction: TransactionFixture) => Promise<unknown>]
  >
}

interface AuditFixture {
  record: jest.Mock<Promise<unknown>, [unknown, unknown]>
}

interface PasswordPolicyFixture {
  assertAcceptable: jest.Mock<
    string,
    [{ password: string; [key: string]: unknown }]
  >
}

interface PasswordsFixture {
  hash: jest.Mock<Promise<string>, [string]>
}

interface ProfileServiceFixture {
  updateInTransaction: jest.Mock<Promise<unknown>, [unknown, string, unknown, unknown]>
}

function userFixture(overrides: Partial<UserFixture> = {}): UserFixture {
  return {
    id: TARGET_ID,
    username: 'Alice',
    usernameNormalized: 'alice',
    displayName: 'Alice',
    passwordHash: 'old-password-hash',
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    authVersion: 3,
    lastLoginAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    roles: [{ roleId: ROLE_A_ID }],
    profile: {
      email: null,
      mobileE164: null,
      avatarUrl: null,
      remark: null,
      createdAt: new Date('2026-07-01T01:00:00.000Z'),
      updatedAt: new Date('2026-07-02T01:00:00.000Z'),
    },
    ...overrides,
  }
}

interface ServiceFixture {
  service: UsersService
  prisma: PrismaFixture
  transaction: TransactionFixture
  audit: AuditFixture
  passwordPolicy: PasswordPolicyFixture
  passwords: PasswordsFixture
  profile: ProfileServiceFixture
  metrics: jest.Mocked<Pick<
    AuthMetricLogger,
    'recordPassword' | 'recordSessionRevoked'
  >>
}

function createServiceFixture(): ServiceFixture {
  const asyncReader = (): AsyncReaderMock => jest.fn<Promise<unknown>, [unknown]>()
  const transaction: TransactionFixture = {
    $queryRaw: asyncReader(),
    user: {
      create: asyncReader(),
      findUnique: asyncReader(),
      update: asyncReader(),
    },
    role: {
      findMany: asyncReader(),
      findUnique: asyncReader(),
    },
    userRole: {
      count: asyncReader(),
      createMany: asyncReader(),
      deleteMany: asyncReader(),
      findMany: asyncReader(),
      findUnique: asyncReader(),
    },
    authSession: {
      updateMany: asyncReader(),
    },
  }
  const prisma: PrismaFixture = {
    user: {
      count: asyncReader(),
      findMany: asyncReader(),
      findUnique: asyncReader(),
    },
    role: {
      findMany: asyncReader(),
      findUnique: asyncReader(),
    },
    $transaction: jest.fn<
      Promise<unknown>,
      [(transaction: TransactionFixture) => Promise<unknown>]
    >((callback) =>
      callback(transaction),
    ),
  }
  const audit: AuditFixture = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const passwordPolicy: PasswordPolicyFixture = {
    assertAcceptable: jest.fn<
      string,
      [{ password: string; [key: string]: unknown }]
    >((input) => input.password.normalize('NFC')),
  }
  const passwords: PasswordsFixture = {
    hash: jest.fn<Promise<string>, [string]>().mockResolvedValue(
      'new-password-hash',
    ),
  }
  const profile: ProfileServiceFixture = {
    updateInTransaction: jest.fn<
      Promise<unknown>,
      [unknown, string, unknown, unknown]
    >(),
  }
  const metrics: ServiceFixture['metrics'] = {
    recordPassword: jest.fn(),
    recordSessionRevoked: jest.fn(),
  }
  const service = new UsersService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordProvider,
    passwordPolicy as unknown as PasswordPolicyProvider,
    audit as AuditService,
    profile as never,
    metrics as unknown as AuthMetricLogger,
  )

  return {
    service,
    prisma,
    transaction,
    audit,
    passwordPolicy,
    passwords,
    profile,
    metrics,
  }
}

function expectApiException(
  operation: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  return operation.then(
    () => {
      throw new Error(`Expected ${code}`)
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(ApiException)
      expect(error).toMatchObject({ code })
      expect((error as ApiException).getStatus()).toBe(status)
    },
  )
}

describe('UsersService reads', () => {
  it('按规范化 username 精确匹配、稳定排序并返回分页 DTO', async () => {
    const { service, prisma } = createServiceFixture()
    prisma.user.count.mockResolvedValue(1)
    prisma.user.findMany.mockResolvedValue([userFixture()])

    await expect(
      service.list({ page: 2, pageSize: 20, username: '  ALICE\u0301  ' }),
    ).resolves.toEqual({
      items: [
        {
          id: TARGET_ID,
          username: 'Alice',
          displayName: 'Alice',
          status: UserStatus.ACTIVE,
          mustChangePassword: false,
          roleIds: [ROLE_A_ID],
          lastLoginAt: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
          profile: {
            email: null,
            mobileE164: null,
            avatarUrl: null,
            remark: null,
            createdAt: '2026-07-01T01:00:00.000Z',
            updatedAt: '2026-07-02T01:00:00.000Z',
          },
        },
      ],
      page: 2,
      pageSize: 20,
      total: 1,
    })

    const expectedWhere = { usernameNormalized: 'alicé' }
    expect(prisma.user.count).toHaveBeenCalledWith({ where: expectedWhere })
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
        skip: 20,
        take: 20,
        orderBy: [{ usernameNormalized: 'asc' }, { id: 'asc' }],
      }),
    )
  })

  it('详情不存在时返回 USER_NOT_FOUND', async () => {
    const { service, prisma } = createServiceFixture()
    prisma.user.findUnique.mockResolvedValue(null)

    await expectApiException(
      service.getById(TARGET_ID),
      HttpStatus.NOT_FOUND,
      'USER_NOT_FOUND',
    )
  })

  it('详情查询在服务边界将合法大写 UUID 规范为小写', async () => {
    const { service, prisma } = createServiceFixture()
    prisma.user.findUnique.mockResolvedValue(userFixture())

    await service.getById(TARGET_ID.toUpperCase())

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET_ID } }),
    )
  })
})

describe('UsersService create and simple updates', () => {
  it('创建 ACTIVE 且无角色的用户，使用 DB clock 并在同一事务写审计', async () => {
    const { service, transaction, audit, passwordPolicy, passwords, metrics } =
      createServiceFixture()
    const created = userFixture({
      authVersion: 0,
      mustChangePassword: true,
      roles: [],
    })
    transaction.$queryRaw.mockResolvedValue([{ now: DATABASE_NOW }])
    transaction.user.create.mockResolvedValue(created)

    const result = await service.create(
      {
        ...context,
        actorUserId: ACTOR_ID.toUpperCase(),
        actorSessionId: SESSION_ID.toUpperCase(),
      },
      {
        username: '  ALICÉ  ',
        displayName: '  Alice Operator  ',
        password: 'correct horse power',
        mustChangePassword: true,
      },
    )

    expect(passwordPolicy.assertAcceptable).toHaveBeenCalledWith({
      password: 'correct horse power',
      fieldName: 'password',
    })
    expect(passwords.hash).toHaveBeenCalledWith('correct horse power')
    const createArgs = transaction.user.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(createArgs.data).toMatchObject({
      username: 'ALICÉ',
      usernameNormalized: 'alicé',
      displayName: 'Alice Operator',
      passwordHash: 'new-password-hash',
      status: UserStatus.ACTIVE,
      mustChangePassword: true,
      passwordChangedAt: DATABASE_NOW,
      authVersion: 0,
      lastLoginAt: null,
      createdByUserId: ACTOR_ID,
      profile: { create: {} },
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'USER_CREATED',
        actorUserId: ACTOR_ID,
        targetId: TARGET_ID,
        requestId: context.requestId,
      }),
    )
    expect(JSON.stringify(result)).not.toContain('password')
    expect(result.roleIds).toEqual([])
    expect(metrics.recordPassword).toHaveBeenCalledWith('create', 'success')
    expectTransactionTimeoutAppliedFirst(transaction)
  })

  it('把 username 唯一冲突稳定映射为 USERNAME_ALREADY_EXISTS', async () => {
    const { service, transaction, metrics } = createServiceFixture()
    transaction.$queryRaw.mockResolvedValue([{ now: DATABASE_NOW }])
    transaction.user.create.mockRejectedValue({ code: 'P2002' })

    await expectApiException(
      service.create(context, {
        username: 'Alice',
        displayName: 'Alice',
        password: 'correct horse power',
        mustChangePassword: false,
      }),
      HttpStatus.CONFLICT,
      'USERNAME_ALREADY_EXISTS',
    )
    expect(metrics.recordPassword).toHaveBeenCalledWith('create', 'failure')
  })

  it('Profile 嵌套创建失败时不继续写 Audit，并让外层事务整体失败', async () => {
    const { service, transaction, audit, metrics } = createServiceFixture()
    transaction.$queryRaw.mockResolvedValue([{ now: DATABASE_NOW }])
    transaction.user.create.mockRejectedValue(
      new Error('user profile nested create failed'),
    )

    await expectApiException(
      service.create(context, {
        username: 'Alice',
        displayName: 'Alice',
        password: 'correct horse power',
        mustChangePassword: false,
      }),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )

    expect(audit.record).not.toHaveBeenCalled()
    expect(metrics.recordPassword).toHaveBeenCalledWith('create', 'failure')
  })

  it('创建 User 后 Audit 失败时继续向外传播，确保事务不能提交 User/Profile', async () => {
    const { service, transaction, audit, metrics } = createServiceFixture()
    transaction.$queryRaw.mockResolvedValue([{ now: DATABASE_NOW }])
    transaction.user.create.mockResolvedValue(userFixture({ roles: [] }))
    audit.record.mockRejectedValue(new Error('audit failed'))

    await expectApiException(
      service.create(context, {
        username: 'Alice',
        displayName: 'Alice',
        password: 'correct horse power',
        mustChangePassword: false,
      }),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )

    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(metrics.recordPassword).toHaveBeenCalledWith('create', 'failure')
  })

  it('PATCH 仅更新规范化后的 displayName 并写一次脱敏 USER_UPDATED', async () => {
    const { service, transaction, audit, profile } = createServiceFixture()
    prepareUpdateTarget(transaction)
    transaction.user.findUnique.mockResolvedValue(
      userFixture({ displayName: '新名称' }),
    )
    transaction.user.update.mockResolvedValue({ id: TARGET_ID })

    await service.update(context, TARGET_ID, {
      displayName: '  新名称  ',
    })

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: TARGET_ID },
      data: { displayName: '新名称' },
      select: { id: true },
    })
    expect(profile.updateInTransaction).not.toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'USER_UPDATED',
        metadata: { changedFields: 'displayName' },
      }),
    )
    expectTransactionTimeoutAppliedFirst(transaction)
  })

  it('Profile-only PATCH 复用事务内服务，并返回完整嵌套聚合', async () => {
    const { service, transaction, audit, profile } = createServiceFixture()
    const updated = userFixture({
      profile: {
        email: 'Operator@Example.com',
        mobileE164: '+8613800138000',
        avatarUrl: null,
        remark: 'internal note',
        createdAt: new Date('2026-07-01T01:00:00.000Z'),
        updatedAt: new Date('2026-07-03T01:00:00.000Z'),
      },
    })
    prepareUpdateTarget(transaction)
    transaction.user.findUnique.mockResolvedValue(updated)
    profile.updateInTransaction.mockResolvedValue({
      profile: {},
      changedFields: 'email,mobileE164,remark',
    })

    const result = await service.update(context, TARGET_ID, {
      email: '  Operator@Example.com  ',
      mobileE164: '+8613800138000',
      remark: ' internal note ',
    })

    expect(transaction.user.update).not.toHaveBeenCalled()
    expect(profile.updateInTransaction).toHaveBeenCalledWith(
      transaction,
      TARGET_ID,
      {
        email: '  Operator@Example.com  ',
        mobileE164: '+8613800138000',
        remark: ' internal note ',
      },
      { allowRemark: true },
    )
    expect(result.profile).toMatchObject({
      email: 'Operator@Example.com',
      mobileE164: '+8613800138000',
      remark: 'internal note',
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        metadata: { changedFields: 'email,mobileE164,remark' },
      }),
    )
  })

  it('忽略 ValidationPipe 转换后未提交但值为 undefined 的 DTO own fields', async () => {
    const { service, transaction, profile } = createServiceFixture()
    const transformedDto = new UpdateUserRequestDto()
    transformedDto.email = 'operator@example.com'
    expect(Object.hasOwn(transformedDto, 'displayName')).toBe(true)
    expect(Object.hasOwn(transformedDto, 'mobileE164')).toBe(true)
    prepareUpdateTarget(transaction)
    transaction.user.findUnique.mockResolvedValue(userFixture())
    profile.updateInTransaction.mockResolvedValue({
      profile: {},
      changedFields: 'email',
    })

    await service.update(context, TARGET_ID, transformedDto)

    expect(transaction.user.update).not.toHaveBeenCalled()
    expect(profile.updateInTransaction).toHaveBeenCalledWith(
      transaction,
      TARGET_ID,
      { email: 'operator@example.com' },
      { allowRemark: true },
    )
  })

  it('User/Profile 组合 PATCH 合并并排序 changedFields，只写一次 Audit', async () => {
    const { service, transaction, audit, profile } = createServiceFixture()
    prepareUpdateTarget(transaction)
    transaction.user.findUnique.mockResolvedValue(
      userFixture({ displayName: '新名称' }),
    )
    transaction.user.update.mockResolvedValue({ id: TARGET_ID })
    profile.updateInTransaction.mockResolvedValue({
      profile: {},
      changedFields: 'avatarUrl,email,remark',
    })

    await service.update(
      {
        ...context,
        actorUserId: ACTOR_ID.toUpperCase(),
        actorSessionId: SESSION_ID.toUpperCase(),
      },
      TARGET_ID.toUpperCase(),
      {
        displayName: ' 新名称 ',
        email: 'operator@example.com',
        avatarUrl: null,
        remark: null,
      },
    )

    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        targetId: TARGET_ID,
        metadata: {
          changedFields: 'avatarUrl,displayName,email,remark',
        },
      }),
    )
    const serializedAudit = JSON.stringify(audit.record.mock.calls[0]?.[1])
    expect(serializedAudit).not.toContain('operator@example.com')
    expect(serializedAudit).not.toContain('新名称')
  })

  it('空 PATCH 在打开事务前返回 VALIDATION_FAILED', async () => {
    const { service, prisma } = createServiceFixture()

    await expectApiException(
      service.update(context, TARGET_ID, {}),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('目标 User 不存在时不调用 Profile 更新并返回 USER_NOT_FOUND', async () => {
    const { service, transaction, profile } = createServiceFixture()
    prepareUpdateTarget(transaction, false)

    await expectApiException(
      service.update(context, TARGET_ID, { email: 'operator@example.com' }),
      HttpStatus.NOT_FOUND,
      'USER_NOT_FOUND',
    )
    expect(profile.updateInTransaction).not.toHaveBeenCalled()
  })

  it('Profile 不变量损坏时返回固定内部错误，不运行时 upsert', async () => {
    const { service, transaction, profile } = createServiceFixture()
    prepareUpdateTarget(transaction)
    transaction.user.findUnique.mockResolvedValue(
      userFixture({ profile: null }),
    )
    profile.updateInTransaction.mockResolvedValue({
      profile: {},
      changedFields: 'email',
    })

    await expectApiException(
      service.update(context, TARGET_ID, { email: 'operator@example.com' }),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })

  it.each([
    ['EMAIL_ALREADY_EXISTS', 'email'],
    ['MOBILE_ALREADY_EXISTS', 'mobileE164'],
  ] as const)(
    '%s 冲突不写 Audit，并原样保留稳定 409',
    async (code, field) => {
      const { service, transaction, audit, profile } = createServiceFixture()
      prepareUpdateTarget(transaction)
      profile.updateInTransaction.mockRejectedValue(
        new ApiException(HttpStatus.CONFLICT, code, '资料已存在'),
      )

      await expectApiException(
        service.update(context, TARGET_ID, {
          [field]: field === 'email'
            ? 'duplicate@example.com'
            : '+8613800138000',
        }),
        HttpStatus.CONFLICT,
        code,
      )
      expect(audit.record).not.toHaveBeenCalled()
    },
  )

  it('Audit 失败向外传播，确保 User/Profile 更新不能部分提交', async () => {
    const { service, transaction, audit, profile } = createServiceFixture()
    prepareUpdateTarget(transaction)
    transaction.user.findUnique.mockResolvedValue(
      userFixture({ displayName: '新名称' }),
    )
    transaction.user.update.mockResolvedValue({ id: TARGET_ID })
    profile.updateInTransaction.mockResolvedValue({
      profile: {},
      changedFields: 'email',
    })
    audit.record.mockRejectedValue(new Error('audit failed'))

    await expectApiException(
      service.update(context, TARGET_ID, {
        displayName: '新名称',
        email: 'operator@example.com',
      }),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
    expect(transaction.user.update).toHaveBeenCalledTimes(1)
    expect(profile.updateInTransaction).toHaveBeenCalledTimes(1)
  })

  it('启用用户不递增 authVersion，并清空禁用字段', async () => {
    const { service, transaction } = createServiceFixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: TARGET_ID, status: UserStatus.DISABLED },
      ])
    transaction.user.update.mockResolvedValue(userFixture())

    await service.enable(context, TARGET_ID)

    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: UserStatus.ACTIVE,
          disabledAt: null,
          disabledByUserId: null,
        },
      }),
    )
    expectTransactionTimeoutAppliedFirst(transaction)
  })

  it('启用用户时可用合法大写 path UUID 命中小写锁记录', async () => {
    const { service, transaction } = createServiceFixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: TARGET_ID, status: UserStatus.DISABLED },
      ])
    transaction.user.update.mockResolvedValue(userFixture())

    await expect(service.enable(context, TARGET_ID.toUpperCase())).resolves.toMatchObject({
      id: TARGET_ID,
    })
    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET_ID } }),
    )
  })
})

describe('UsersService disable', () => {
  it('禁止管理员禁用自己，且不打开事务', async () => {
    const { service, prisma } = createServiceFixture()

    await expectApiException(
      service.disable(context, ACTOR_ID),
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('大小写不同的同一 UUID 仍按管理员本人处理', async () => {
    const { service, prisma } = createServiceFixture()

    await expectApiException(
      service.disable(
        { ...context, actorUserId: ACTOR_ID.toUpperCase() },
        ACTOR_ID,
      ),
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('拒绝禁用最后一个 active system_admin', async () => {
    const { service, transaction } = createServiceFixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: SYSTEM_ROLE_ID, code: SYSTEM_ADMIN_ROLE_CODE }])
      .mockResolvedValueOnce([
        { id: TARGET_ID, status: UserStatus.ACTIVE, authVersion: 3 },
      ])
    transaction.userRole.findUnique.mockResolvedValue({ userId: TARGET_ID })
    transaction.userRole.count.mockResolvedValue(1)

    await expectApiException(
      service.disable(context, TARGET_ID),
      HttpStatus.CONFLICT,
      'LAST_SYSTEM_ADMIN_REQUIRED',
    )
    expect(transaction.user.update).not.toHaveBeenCalled()
  })

  it('禁用时递增 authVersion，只吊销活跃 Session 并原子写审计', async () => {
    const { service, transaction, audit, metrics } = createServiceFixture()
    const disabled = userFixture({ status: UserStatus.DISABLED })
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: SYSTEM_ROLE_ID, code: SYSTEM_ADMIN_ROLE_CODE }])
      .mockResolvedValueOnce([
        { id: TARGET_ID, status: UserStatus.ACTIVE, authVersion: 3 },
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])
    transaction.userRole.findUnique.mockResolvedValue(null)
    transaction.user.update.mockResolvedValue(disabled)
    transaction.authSession.updateMany.mockResolvedValue({ count: 2 })

    await service.disable(context, TARGET_ID)

    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: UserStatus.DISABLED,
          disabledAt: DATABASE_NOW,
          disabledByUserId: ACTOR_ID,
          authVersion: { increment: 1 },
        },
      }),
    )
    expect(transaction.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: TARGET_ID, revokedAt: null },
      data: {
        revokedAt: DATABASE_NOW,
        revokedReason: SessionRevokedReason.USER_DISABLED,
      },
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ eventType: 'USER_DISABLED' }),
    )
    expect(metrics.recordSessionRevoked).toHaveBeenCalledWith(2)
    expectTransactionTimeoutAppliedFirst(transaction)
  })
})

describe('UsersService replaceRoles', () => {
  it('任一请求 Role 不存在时整体返回 ROLE_NOT_FOUND', async () => {
    const { service, prisma } = createServiceFixture()
    prisma.user.findUnique.mockResolvedValue(userFixture())
    prisma.role.findUnique.mockResolvedValue({
      id: SYSTEM_ROLE_ID,
      code: SYSTEM_ADMIN_ROLE_CODE,
    })
    prisma.role.findMany.mockResolvedValue([{ id: ROLE_A_ID }])

    await expectApiException(
      service.replaceRoles(context, TARGET_ID, {
        roleIds: [ROLE_A_ID, ROLE_B_ID],
      }),
      HttpStatus.NOT_FOUND,
      'ROLE_NOT_FOUND',
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('只有当前 system_admin 可替换角色', async () => {
    const { service, prisma, transaction } = createServiceFixture()
    prisma.user.findUnique.mockResolvedValue(userFixture())
    prisma.role.findUnique.mockResolvedValue({
      id: SYSTEM_ROLE_ID,
      code: SYSTEM_ADMIN_ROLE_CODE,
    })
    prisma.role.findMany.mockResolvedValue([{ id: ROLE_A_ID }])
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: SYSTEM_ROLE_ID, code: SYSTEM_ADMIN_ROLE_CODE },
        { id: ROLE_A_ID, code: 'operator' },
      ])
      .mockResolvedValueOnce([
        { id: ACTOR_ID, status: UserStatus.ACTIVE },
        { id: TARGET_ID, status: UserStatus.ACTIVE },
      ])
    transaction.userRole.findMany.mockResolvedValue([
      { roleId: ROLE_A_ID },
    ])
    transaction.userRole.findUnique.mockResolvedValue(null)

    await expectApiException(
      service.replaceRoles(context, TARGET_ID, { roleIds: [ROLE_A_ID] }),
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
    )
    expect(transaction.userRole.deleteMany).not.toHaveBeenCalled()
  })

  it('拒绝最后一个 active system_admin 移除自己的系统角色', async () => {
    const { service, prisma, transaction } = createServiceFixture()
    const selfContext = { ...context, actorUserId: TARGET_ID }
    prisma.user.findUnique.mockResolvedValue(
      userFixture({ roles: [{ roleId: SYSTEM_ROLE_ID }] }),
    )
    prisma.role.findUnique.mockResolvedValue({
      id: SYSTEM_ROLE_ID,
      code: SYSTEM_ADMIN_ROLE_CODE,
    })
    prisma.role.findMany.mockResolvedValue([])
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: SYSTEM_ROLE_ID, code: SYSTEM_ADMIN_ROLE_CODE },
      ])
      .mockResolvedValueOnce([
        { id: TARGET_ID, status: UserStatus.ACTIVE },
      ])
    transaction.userRole.findMany.mockResolvedValue([
      { roleId: SYSTEM_ROLE_ID },
    ])
    transaction.userRole.findUnique.mockResolvedValue({ userId: TARGET_ID })
    transaction.userRole.count.mockResolvedValue(1)

    await expectApiException(
      service.replaceRoles(selfContext, TARGET_ID, { roleIds: [] }),
      HttpStatus.CONFLICT,
      'LAST_SYSTEM_ADMIN_REQUIRED',
    )
    expect(transaction.userRole.deleteMany).not.toHaveBeenCalled()
  })

  it('去重排序 Role，按 Role 后 User 的顺序加锁并替换集合', async () => {
    const { service, prisma, transaction, audit } = createServiceFixture()
    prisma.user.findUnique.mockResolvedValue(userFixture())
    prisma.role.findUnique.mockResolvedValue({
      id: SYSTEM_ROLE_ID,
      code: SYSTEM_ADMIN_ROLE_CODE,
    })
    prisma.role.findMany.mockResolvedValue([
      { id: ROLE_A_ID },
      { id: ROLE_B_ID },
    ])
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: SYSTEM_ROLE_ID, code: SYSTEM_ADMIN_ROLE_CODE },
        { id: ROLE_A_ID, code: 'operator' },
        { id: ROLE_B_ID, code: 'reviewer' },
      ])
      .mockResolvedValueOnce([
        { id: ACTOR_ID, status: UserStatus.ACTIVE },
        { id: TARGET_ID, status: UserStatus.ACTIVE },
      ])
    transaction.userRole.findMany.mockResolvedValue([
      { roleId: ROLE_A_ID },
    ])
    transaction.userRole.findUnique.mockResolvedValue({ userId: ACTOR_ID })
    transaction.userRole.deleteMany.mockResolvedValue({ count: 1 })
    transaction.userRole.createMany.mockResolvedValue({ count: 2 })
    transaction.user.findUnique.mockResolvedValue(
      userFixture({ roles: [{ roleId: ROLE_A_ID }, { roleId: ROLE_B_ID }] }),
    )

    const result = await service.replaceRoles(context, TARGET_ID, {
      roleIds: [ROLE_B_ID, ROLE_A_ID, ROLE_B_ID],
    })

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(3)
    expect(transaction.userRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: TARGET_ID },
    })
    expect(transaction.userRole.createMany).toHaveBeenCalledWith({
      data: [
        { userId: TARGET_ID, roleId: ROLE_A_ID },
        { userId: TARGET_ID, roleId: ROLE_B_ID },
      ],
    })
    expect(result.roleIds).toEqual([ROLE_A_ID, ROLE_B_ID])
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'USER_ROLES_CHANGED',
        metadata: { roleCount: 2 },
      }),
    )
    expectTransactionTimeoutAppliedFirst(transaction)
  })

  it('混合大小写重复 Role UUID 先规范化再去重、锁定与写入', async () => {
    const { service, prisma, transaction, audit } = createServiceFixture()
    const uppercaseContext = {
      ...context,
      actorUserId: ACTOR_ID.toUpperCase(),
      actorSessionId: SESSION_ID.toUpperCase(),
    }
    prisma.user.findUnique.mockResolvedValue(userFixture())
    prisma.role.findUnique.mockResolvedValue({
      id: SYSTEM_ROLE_ID,
      code: SYSTEM_ADMIN_ROLE_CODE,
    })
    prisma.role.findMany.mockResolvedValue([
      { id: ROLE_A_ID },
      { id: ROLE_B_ID },
    ])
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: SYSTEM_ROLE_ID, code: SYSTEM_ADMIN_ROLE_CODE },
        { id: ROLE_A_ID, code: 'operator' },
        { id: ROLE_B_ID, code: 'reviewer' },
      ])
      .mockResolvedValueOnce([
        { id: ACTOR_ID, status: UserStatus.ACTIVE },
        { id: TARGET_ID, status: UserStatus.ACTIVE },
      ])
    transaction.userRole.findMany.mockResolvedValue([{ roleId: ROLE_A_ID }])
    transaction.userRole.findUnique.mockResolvedValue({ userId: ACTOR_ID })
    transaction.userRole.deleteMany.mockResolvedValue({ count: 1 })
    transaction.userRole.createMany.mockResolvedValue({ count: 2 })
    transaction.user.findUnique.mockResolvedValue(
      userFixture({ roles: [{ roleId: ROLE_A_ID }, { roleId: ROLE_B_ID }] }),
    )

    await service.replaceRoles(uppercaseContext, TARGET_ID.toUpperCase(), {
      roleIds: [ROLE_B_ID.toUpperCase(), ROLE_A_ID, ROLE_B_ID],
    })

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET_ID } }),
    )
    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [ROLE_A_ID, ROLE_B_ID] } },
      }),
    )
    expect(transaction.userRole.createMany).toHaveBeenCalledWith({
      data: [
        { userId: TARGET_ID, roleId: ROLE_A_ID },
        { userId: TARGET_ID, roleId: ROLE_B_ID },
      ],
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        targetId: TARGET_ID,
        metadata: { roleCount: 2 },
      }),
    )
  })
})

describe('UsersService resetPassword', () => {
  it('Hash 前拒绝管理员重置本人密码', async () => {
    const { service, prisma, passwords, metrics } = createServiceFixture()

    await expectApiException(
      service.resetPassword(context, ACTOR_ID, {
        newPassword: 'correct horse power',
        mustChangePassword: true,
      }),
      HttpStatus.CONFLICT,
      'SELF_PASSWORD_RESET_NOT_ALLOWED',
    )
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(passwords.hash).not.toHaveBeenCalled()
    expect(metrics.recordPassword).toHaveBeenCalledWith('reset', 'failure')
  })

  it('大小写不同的同一 UUID 仍禁止通过管理接口重置本人密码', async () => {
    const { service, prisma, passwords } = createServiceFixture()

    await expectApiException(
      service.resetPassword(
        { ...context, actorUserId: ACTOR_ID.toUpperCase() },
        ACTOR_ID,
        {
          newPassword: 'correct horse power',
          mustChangePassword: true,
        },
      ),
      HttpStatus.CONFLICT,
      'SELF_PASSWORD_RESET_NOT_ALLOWED',
    )
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(passwords.hash).not.toHaveBeenCalled()
  })

  it('Hash 后 target 快照变化时返回 AUTH_STATE_CHANGED 且不写入', async () => {
    const { service, prisma, transaction, metrics } = createServiceFixture()
    prisma.user.findUnique.mockResolvedValue(userFixture())
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: ACTOR_ID,
          status: UserStatus.ACTIVE,
          authVersion: 7,
          passwordHash: 'actor-hash',
        },
        {
          id: TARGET_ID,
          status: UserStatus.ACTIVE,
          authVersion: 4,
          passwordHash: 'concurrently-changed-hash',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: SESSION_ID,
          userId: ACTOR_ID,
          authVersion: 7,
          revokedAt: null,
          idleExpiresAt: new Date('2026-07-18T00:00:00.000Z'),
          absoluteExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])

    await expectApiException(
      service.resetPassword(context, TARGET_ID, {
        newPassword: 'correct horse power',
        mustChangePassword: false,
      }),
      HttpStatus.CONFLICT,
      'AUTH_STATE_CHANGED',
    )
    expect(transaction.user.update).not.toHaveBeenCalled()
    expect(metrics.recordPassword).toHaveBeenCalledWith('reset', 'failure')
  })

  it('允许重置 DISABLED 用户但不启用，递增版本并吊销全部活跃 Session', async () => {
    const { service, prisma, transaction, audit, passwordPolicy, metrics } =
      createServiceFixture()
    const snapshot = userFixture({ status: UserStatus.DISABLED })
    const updated = userFixture({
      status: UserStatus.DISABLED,
      mustChangePassword: true,
      authVersion: 4,
    })
    prisma.user.findUnique.mockResolvedValue(snapshot)
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: ACTOR_ID,
          status: UserStatus.ACTIVE,
          authVersion: 7,
          passwordHash: 'actor-hash',
        },
        {
          id: TARGET_ID,
          status: UserStatus.DISABLED,
          authVersion: 3,
          passwordHash: 'old-password-hash',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: SESSION_ID,
          userId: ACTOR_ID,
          authVersion: 7,
          revokedAt: null,
          idleExpiresAt: new Date('2026-07-18T00:00:00.000Z'),
          absoluteExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])
    transaction.user.update.mockResolvedValue(updated)
    transaction.authSession.updateMany.mockResolvedValue({ count: 3 })

    const result = await service.resetPassword(context, TARGET_ID, {
      newPassword: 'correct horse power',
      mustChangePassword: true,
    })

    expect(passwordPolicy.assertAcceptable).toHaveBeenCalledWith({
      password: 'correct horse power',
      fieldName: 'newPassword',
    })
    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          passwordHash: 'new-password-hash',
          passwordChangedAt: DATABASE_NOW,
          mustChangePassword: true,
          authVersion: { increment: 1 },
        },
      }),
    )
    const passwordUpdateArgs = transaction.user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(passwordUpdateArgs.data).not.toHaveProperty('status')
    expect(transaction.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: TARGET_ID, revokedAt: null },
      data: {
        revokedAt: DATABASE_NOW,
        revokedReason: SessionRevokedReason.PASSWORD_RESET,
      },
    })
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: 'USER_PASSWORD_RESET',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: ACTOR_ID,
      targetType: 'User',
      targetId: TARGET_ID,
      requestId: context.requestId,
      metadata: { mustChangePassword: true },
    })
    expect(result.status).toBe(UserStatus.DISABLED)
    expect(metrics.recordPassword).toHaveBeenCalledWith('reset', 'success')
    expect(metrics.recordSessionRevoked).toHaveBeenCalledWith(3)
    expect(JSON.stringify(result)).not.toContain('password')
    expectTransactionTimeoutAppliedFirst(transaction)
  })

  it('重置密码前规范化 actor、session 与 target UUID', async () => {
    const { service, prisma, transaction, audit } = createServiceFixture()
    const uppercaseContext = {
      ...context,
      actorUserId: ACTOR_ID.toUpperCase(),
      actorSessionId: SESSION_ID.toUpperCase(),
    }
    prisma.user.findUnique.mockResolvedValue(userFixture())
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: ACTOR_ID,
          status: UserStatus.ACTIVE,
          authVersion: 7,
          passwordHash: 'actor-hash',
        },
        {
          id: TARGET_ID,
          status: UserStatus.ACTIVE,
          authVersion: 3,
          passwordHash: 'old-password-hash',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: SESSION_ID,
          userId: ACTOR_ID,
          authVersion: 7,
          revokedAt: null,
          idleExpiresAt: new Date('2026-07-18T00:00:00.000Z'),
          absoluteExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ now: DATABASE_NOW }])
    transaction.user.update.mockResolvedValue(userFixture({ authVersion: 4 }))
    transaction.authSession.updateMany.mockResolvedValue({ count: 1 })

    await service.resetPassword(
      uppercaseContext,
      TARGET_ID.toUpperCase(),
      {
        newPassword: 'correct horse power',
        mustChangePassword: false,
      },
    )

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET_ID } }),
    )
    expect(getSqlValues(transaction.$queryRaw.mock.calls[1]?.[0])).toEqual([
      ACTOR_ID,
      TARGET_ID,
    ])
    expect(getSqlValues(transaction.$queryRaw.mock.calls[2]?.[0])).toEqual([
      SESSION_ID,
    ])
    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET_ID } }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        targetId: TARGET_ID,
      }),
    )
  })
})
