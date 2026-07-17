import { HttpStatus } from '@nestjs/common'

import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { RolesService } from './roles.service'

jest.mock('../../infrastructure/database/transaction-timeouts', () => ({
  applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
}))

const mockedApplyTransactionTimeouts = jest.mocked(applyTransactionTimeouts)

const TARGET_ROLE_ID = '1a000000-0000-4000-8000-000000000001'
const SYSTEM_ROLE_ID = '0a000000-0000-4000-8000-000000000001'
const ACTOR_USER_ID = '2a000000-0000-4000-8000-000000000001'
const PERMISSION_A_ID = '3a000000-0000-4000-8000-000000000001'
const PERMISSION_B_ID = '3b000000-0000-4000-8000-000000000002'
const SYSTEM_PERMISSION_ID = '3c000000-0000-4000-8000-000000000003'
const PERMISSION_C_ID = '3d000000-0000-4000-8000-000000000004'
const REQUEST_ID = 'request-role-test'

const MUTATION_CONTEXT = {
  actorUserId: ACTOR_USER_ID,
  requestId: REQUEST_ID,
} as const

type TransactionMock = ReturnType<typeof createTransactionMock>

function createTransactionMock() {
  return {
    $queryRaw: jest.fn(),
    role: {
      create: jest.fn(),
      update: jest.fn(),
    },
    rolePermission: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    userRole: {
      findUnique: jest.fn().mockResolvedValue({
        user: { status: 'ACTIVE' },
      }),
    },
  }
}

function createFixture() {
  const transaction = createTransactionMock()
  const prisma = {
    role: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(
      async (callback: (tx: TransactionMock) => Promise<unknown>) =>
        callback(transaction),
    ),
  }
  const audit = {
    record: jest.fn().mockResolvedValue({}),
  }
  const service = new RolesService(
    prisma as unknown as PrismaService,
    audit,
  )

  return { service, prisma, transaction, audit }
}

function createRoleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ROLE_ID,
    code: 'inventory_manager',
    name: '库存管理员',
    description: null,
    isSystem: false,
    permissions: [
      { permissionId: PERMISSION_B_ID },
      { permissionId: PERMISSION_A_ID },
      { permissionId: PERMISSION_A_ID },
    ],
    ...overrides,
  }
}

function createLockedRole(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ROLE_ID,
    code: 'inventory_manager',
    name: '库存管理员',
    description: null,
    isSystem: false,
    ...overrides,
  }
}

function createSystemRole() {
  return {
    id: SYSTEM_ROLE_ID,
    code: 'system_admin',
    name: '系统管理员',
    description: null,
    isSystem: true,
  }
}

async function captureError(operation: Promise<unknown>): Promise<{
  code: string
  publicMessage: string
  getStatus(): number
}> {
  return operation.then(
    () => {
      throw new Error('Expected operation to fail')
    },
    (error: unknown) => error as {
      code: string
      publicMessage: string
      getStatus(): number
    },
  )
}

describe('RolesService reads', () => {
  it('lists roles by code/id and emits sorted unique permission ids', async () => {
    const fixture = createFixture()
    fixture.prisma.role.findMany.mockResolvedValue([createRoleRecord()])

    await expect(fixture.service.list()).resolves.toEqual([
      {
        id: TARGET_ROLE_ID,
        code: 'inventory_manager',
        name: '库存管理员',
        description: null,
        isSystem: false,
        permissionIds: [PERMISSION_A_ID, PERMISSION_B_ID],
      },
    ])
    expect(fixture.prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
      }),
    )
  })

  it('returns ROLE_NOT_FOUND for a missing role detail', async () => {
    const fixture = createFixture()
    fixture.prisma.role.findUnique.mockResolvedValue(null)

    const error = await captureError(fixture.service.getById(TARGET_ROLE_ID))

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND)
    expect(error.code).toBe('ROLE_NOT_FOUND')
  })
})

describe('RolesService creates and updates ordinary roles', () => {
  beforeEach(() => {
    mockedApplyTransactionTimeouts.mockClear()
  })

  it('creates only an ordinary role and writes its Audit in the same transaction', async () => {
    const fixture = createFixture()
    fixture.transaction.role.create.mockResolvedValue(
      createRoleRecord({ permissions: [] }),
    )

    await expect(
      fixture.service.create(
        MUTATION_CONTEXT,
        {
          code: 'inventory_manager',
          name: '  库存管理员  ',
          description: '负责库存管理',
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: TARGET_ROLE_ID,
        code: 'inventory_manager',
        isSystem: false,
        permissionIds: [],
      }),
    )
    expect(fixture.transaction.role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          code: 'inventory_manager',
          name: '库存管理员',
          description: '负责库存管理',
          isSystem: false,
        },
      }),
    )
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction, {
      eventType: AuditEventType.ROLE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_USER_ID,
      targetType: 'Role',
      targetId: TARGET_ROLE_ID,
      requestId: REQUEST_ID,
    })
    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(
      fixture.transaction,
    )
    expect(
      mockedApplyTransactionTimeouts.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.transaction.role.create.mock.invocationCallOrder[0],
    )
  })

  it('maps a concurrent unique code collision to ROLE_CODE_ALREADY_EXISTS', async () => {
    const fixture = createFixture()
    fixture.transaction.role.create.mockRejectedValue({
      code: 'P2002',
    })

    const error = await captureError(
      fixture.service.create(
        MUTATION_CONTEXT,
        { code: 'inventory_manager', name: '库存管理员' },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT)
    expect(error.code).toBe('ROLE_CODE_ALREADY_EXISTS')
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('locks an ordinary target before updating and audits the committed fields', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw.mockResolvedValueOnce([createLockedRole()])
    fixture.transaction.role.update.mockResolvedValue(
      createRoleRecord({ name: '新名称', description: '新描述' }),
    )

    await expect(
      fixture.service.update(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { name: ' 新名称 ', description: ' 新描述 ' },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ name: '新名称', description: '新描述' }),
    )

    const rawQueryCalls = fixture.transaction.$queryRaw.mock.calls as unknown[][]
    const lockQuery = rawQueryCalls[0]?.[0] as {
      strings: readonly string[]
      values: readonly unknown[]
    }
    expect(lockQuery.strings.join('')).toContain('FOR UPDATE')
    expect(lockQuery.values).toContain(TARGET_ROLE_ID)
    expect(fixture.transaction.role.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TARGET_ROLE_ID },
        data: { name: '新名称', description: '新描述' },
      }),
    )
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        eventType: AuditEventType.ROLE_UPDATED,
        targetId: TARGET_ROLE_ID,
      }),
    )
  })

  it('does not allow the system_admin role to be edited', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw.mockResolvedValueOnce([
      createLockedRole({ code: 'system_admin', isSystem: true }),
    ])

    const error = await captureError(
      fixture.service.update(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { name: '新管理员' },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN)
    expect(error.code).toBe('FORBIDDEN')
    expect(fixture.transaction.role.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('returns ROLE_NOT_FOUND when the update target disappears before its lock', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw.mockResolvedValueOnce([])

    const error = await captureError(
      fixture.service.update(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { name: '新名称' },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND)
    expect(error.code).toBe('ROLE_NOT_FOUND')
    expect(fixture.transaction.role.update).not.toHaveBeenCalled()
  })
})

describe('RolesService replaces permissions', () => {
  it('locks roles and the complete sorted permission set, verifies system_admin, replaces and audits atomically', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockResolvedValueOnce([createSystemRole(), createLockedRole()])
      .mockResolvedValueOnce([{ id: ACTOR_USER_ID }])
      .mockResolvedValueOnce([
        { id: PERMISSION_A_ID, systemOnly: false },
        { id: PERMISSION_B_ID, systemOnly: false },
        { id: PERMISSION_C_ID, systemOnly: false },
      ])
    fixture.transaction.rolePermission.findMany.mockResolvedValue([
      { permissionId: PERMISSION_C_ID },
    ])
    fixture.transaction.rolePermission.createMany.mockResolvedValue({ count: 2 })

    await expect(
      fixture.service.replacePermissions(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID.toUpperCase(),
        {
          permissionIds: [
            PERMISSION_B_ID.toUpperCase(),
            PERMISSION_A_ID,
          ],
        },
      ),
    ).resolves.toEqual({
      id: TARGET_ROLE_ID,
      code: 'inventory_manager',
      name: '库存管理员',
      description: null,
      isSystem: false,
      permissionIds: [PERMISSION_A_ID, PERMISSION_B_ID],
    })

    const rawQueryCalls = fixture.transaction.$queryRaw.mock.calls as unknown[][]
    const [roleLock, userLock, permissionLock] = rawQueryCalls.map(
      call => call[0],
    ) as Array<{
      strings: readonly string[]
      values: readonly unknown[]
    }>
    expect(roleLock.strings.join('')).toContain('ORDER BY "id"')
    expect(roleLock.strings.join('')).toContain('FOR UPDATE')
    expect(roleLock.values).toContain(TARGET_ROLE_ID)
    expect(userLock.strings.join('')).toContain('FROM "users"')
    expect(userLock.strings.join('')).toContain('ORDER BY "id"')
    expect(userLock.strings.join('')).toContain('FOR UPDATE')
    expect(userLock.values).toContain(ACTOR_USER_ID)
    expect(permissionLock.strings.join('')).toContain('ORDER BY "id"')
    expect(permissionLock.strings.join('')).toContain('FOR UPDATE')
    expect(permissionLock.values).toEqual(
      expect.arrayContaining([
        PERMISSION_A_ID,
        PERMISSION_B_ID,
        PERMISSION_C_ID,
      ]),
    )
    expect(fixture.transaction.userRole.findUnique).toHaveBeenCalledWith({
      where: {
        userId_roleId: {
          userId: ACTOR_USER_ID,
          roleId: SYSTEM_ROLE_ID,
        },
      },
      select: { user: { select: { status: true } } },
    })
    const [roleLockOrder, userLockOrder, permissionLockOrder] =
      fixture.transaction.$queryRaw.mock.invocationCallOrder
    const membershipOrder =
      fixture.transaction.userRole.findUnique.mock.invocationCallOrder[0]
    expect(roleLockOrder).toBeLessThan(userLockOrder)
    expect(userLockOrder).toBeLessThan(membershipOrder)
    expect(membershipOrder).toBeLessThan(permissionLockOrder)
    expect(fixture.transaction.rolePermission.deleteMany).toHaveBeenCalledWith({
      where: { roleId: TARGET_ROLE_ID },
    })
    expect(fixture.transaction.rolePermission.createMany).toHaveBeenCalledWith({
      data: [
        { roleId: TARGET_ROLE_ID, permissionId: PERMISSION_A_ID },
        { roleId: TARGET_ROLE_ID, permissionId: PERMISSION_B_ID },
      ],
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        eventType: AuditEventType.ROLE_PERMISSIONS_CHANGED,
        targetId: TARGET_ROLE_ID,
        metadata: { permissionCount: 2 },
      }),
    )
    const replaceOrder = fixture.transaction.rolePermission.createMany.mock
      .invocationCallOrder[0]
    const auditOrder = fixture.audit.record.mock.invocationCallOrder[0]
    expect(replaceOrder).toBeLessThan(auditOrder)
  })

  it('supports clearing all ordinary permissions without an empty IN query', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockResolvedValueOnce([createSystemRole(), createLockedRole()])
      .mockResolvedValueOnce([{ id: ACTOR_USER_ID }])

    await expect(
      fixture.service.replacePermissions(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { permissionIds: [] },
      ),
    ).resolves.toEqual(expect.objectContaining({ permissionIds: [] }))
    expect(fixture.transaction.$queryRaw).toHaveBeenCalledTimes(2)
    expect(fixture.transaction.rolePermission.createMany).not.toHaveBeenCalled()
  })

  it('rejects a missing target without writing relationships or Audit', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw.mockResolvedValueOnce([createSystemRole()])

    const error = await captureError(
      fixture.service.replacePermissions(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { permissionIds: [PERMISSION_A_ID] },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND)
    expect(error.code).toBe('ROLE_NOT_FOUND')
    expect(fixture.transaction.rolePermission.deleteMany).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('rejects a missing permission without partial replacement', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockResolvedValueOnce([createSystemRole(), createLockedRole()])
      .mockResolvedValueOnce([{ id: ACTOR_USER_ID }])
      .mockResolvedValueOnce([])

    const error = await captureError(
      fixture.service.replacePermissions(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { permissionIds: [PERMISSION_A_ID] },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND)
    expect(error.code).toBe('PERMISSION_NOT_FOUND')
    expect(fixture.transaction.rolePermission.deleteMany).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('does not assign a systemOnly permission to an ordinary role', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockResolvedValueOnce([createSystemRole(), createLockedRole()])
      .mockResolvedValueOnce([{ id: ACTOR_USER_ID }])
      .mockResolvedValueOnce([
        { id: SYSTEM_PERMISSION_ID, systemOnly: true },
      ])

    const error = await captureError(
      fixture.service.replacePermissions(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { permissionIds: [SYSTEM_PERMISSION_ID] },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN)
    expect(error.code).toBe('FORBIDDEN')
    expect(fixture.transaction.rolePermission.deleteMany).not.toHaveBeenCalled()
  })

  it('rechecks active system_admin membership in every replacement transaction', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockResolvedValueOnce([createSystemRole(), createLockedRole()])
      .mockResolvedValueOnce([{ id: ACTOR_USER_ID }])
    fixture.transaction.userRole.findUnique.mockResolvedValue(null)

    const error = await captureError(
      fixture.service.replacePermissions(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { permissionIds: [] },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN)
    expect(error.code).toBe('FORBIDDEN')
    expect(fixture.transaction.rolePermission.findMany).not.toHaveBeenCalled()
    expect(fixture.transaction.rolePermission.deleteMany).not.toHaveBeenCalled()
  })

  it('rejects a missing actor after the Role locks and before membership or Permission reads', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockResolvedValueOnce([createSystemRole(), createLockedRole()])
      .mockResolvedValueOnce([])

    const error = await captureError(
      fixture.service.replacePermissions(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { permissionIds: [PERMISSION_A_ID] },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN)
    expect(error.code).toBe('FORBIDDEN')
    expect(fixture.transaction.userRole.findUnique).not.toHaveBeenCalled()
    expect(fixture.transaction.rolePermission.findMany).not.toHaveBeenCalled()
    expect(fixture.transaction.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('does not allow permissions on system_admin to be replaced', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw.mockResolvedValueOnce([createSystemRole()])

    const error = await captureError(
      fixture.service.replacePermissions(
        MUTATION_CONTEXT,
        SYSTEM_ROLE_ID,
        { permissionIds: [] },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN)
    expect(error.code).toBe('FORBIDDEN')
    expect(fixture.transaction.userRole.findUnique).not.toHaveBeenCalled()
  })

  it('maps a database transaction conflict to AUTH_STATE_CHANGED', async () => {
    const fixture = createFixture()
    fixture.prisma.$transaction.mockRejectedValue({ code: 'P2034' })

    const error = await captureError(
      fixture.service.replacePermissions(
        MUTATION_CONTEXT,
        TARGET_ROLE_ID,
        { permissionIds: [] },
      ),
    )

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT)
    expect(error.code).toBe('AUTH_STATE_CHANGED')
  })
})
