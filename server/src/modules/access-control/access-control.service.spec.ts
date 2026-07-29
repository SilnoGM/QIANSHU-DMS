import { ApiException } from '../../infrastructure/http/api.exception'
import { PrismaService } from '../../infrastructure/database/prisma.service'

import {
  MANAGEMENT_PERMISSION_CODES,
  SYSTEM_ADMIN_ROLE_CODE,
} from './permission.constants'
import { AccessControlService } from './access-control.service'

type PermissionQueryResult = Array<{
  role: {
    permissions: Array<{
      permission: {
        code: string
      }
    }>
  }
}>

function createPrismaService(
  findMany: jest.Mock<Promise<PermissionQueryResult>, [unknown]>,
): PrismaService {
  return {
    userRole: {
      findMany,
    },
  } as unknown as PrismaService
}

describe('permission constants', () => {
  it('matches the built-in system administrator role and its seeded catalog', () => {
    expect(SYSTEM_ADMIN_ROLE_CODE).toBe('system_admin')
    expect(MANAGEMENT_PERMISSION_CODES).toEqual([
      'users:read',
      'users:create',
      'users:update',
      'users:enable',
      'users:disable',
      'users:assign-roles',
      'users:reset-password',
      'roles:read',
      'roles:create',
      'roles:update',
      'roles:assign-permissions',
      'audit:read',
      'regions:read',
      'regions:create',
      'regions:update',
      'regions:enable',
      'regions:disable',
      'currencies:read',
      'currencies:create',
      'currencies:update',
      'currencies:enable',
      'currencies:disable',
      'exchange-rates:read',
      'exchange-rates:create',
      'exchange-rates:update',
    ])
    expect(new Set(MANAGEMENT_PERMISSION_CODES)).toHaveProperty('size', 25)
  })
})

describe('AccessControlService', () => {
  it('loads current permissions through UserRole, RolePermission and Permission', async () => {
    const findMany = jest.fn<Promise<PermissionQueryResult>, [unknown]>()
      .mockResolvedValue([
        {
          role: {
            permissions: [
              { permission: { code: 'users:update' } },
              { permission: { code: 'users:read' } },
            ],
          },
        },
        {
          role: {
            permissions: [
              { permission: { code: 'users:read' } },
              { permission: { code: 'audit:read' } },
            ],
          },
        },
      ])
    const service = new AccessControlService(createPrismaService(findMany))

    await expect(service.getPermissionCodes('user-123')).resolves.toEqual([
      'audit:read',
      'users:read',
      'users:update',
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-123' },
      select: {
        role: {
          select: {
            permissions: {
              select: {
                permission: {
                  select: { code: true },
                },
              },
            },
          },
        },
      },
    })
  })

  it('queries the database on every call instead of caching stale grants', async () => {
    const findMany = jest.fn<Promise<PermissionQueryResult>, [unknown]>()
      .mockResolvedValueOnce([
        {
          role: {
            permissions: [{ permission: { code: 'users:read' } }],
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          role: {
            permissions: [{ permission: { code: 'users:update' } }],
          },
        },
      ])
    const service = new AccessControlService(createPrismaService(findMany))

    await expect(service.getPermissionCodes('user-123')).resolves.toEqual([
      'users:read',
    ])
    await expect(service.getPermissionCodes('user-123')).resolves.toEqual([
      'users:update',
    ])
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('can read permissions through the caller transaction for an atomic auth response', async () => {
    const defaultFindMany = jest
      .fn<Promise<PermissionQueryResult>, [unknown]>()
      .mockResolvedValue([])
    const transactionFindMany = jest
      .fn<Promise<PermissionQueryResult>, [unknown]>()
      .mockResolvedValue([
        {
          role: {
            permissions: [{ permission: { code: 'users:read' } }],
          },
        },
      ])
    const service = new AccessControlService(
      createPrismaService(defaultFindMany),
    )
    const transaction = createPrismaService(transactionFindMany)

    await expect(
      service.getPermissionCodesInTransaction(
        transaction as never,
        'user-123',
      ),
    ).resolves.toEqual(['users:read'])
    expect(transactionFindMany).toHaveBeenCalledTimes(1)
    expect(defaultFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty list when the user has no roles or permissions', async () => {
    const findMany = jest.fn<Promise<PermissionQueryResult>, [unknown]>()
      .mockResolvedValue([])
    const service = new AccessControlService(createPrismaService(findMany))

    await expect(service.getPermissionCodes('user-123')).resolves.toEqual([])
  })

  it('maps database failures to one fixed safe API error', async () => {
    const findMany = jest.fn<Promise<PermissionQueryResult>, [unknown]>()
      .mockRejectedValue(
        new Error('password=must-not-leak host=internal-db.example'),
      )
    const service = new AccessControlService(createPrismaService(findMany))

    let thrown: unknown
    try {
      await service.getPermissionCodes('user-123')
    }
    catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ApiException)
    expect((thrown as ApiException).getStatus()).toBe(500)
    expect((thrown as ApiException).code).toBe('INTERNAL_ERROR')
    expect((thrown as ApiException).publicMessage).toBe('服务器内部错误')
    expect((thrown as Error).message).not.toContain('must-not-leak')
    expect((thrown as Error).message).not.toContain('internal-db.example')
  })

  it('checks all required permissions without depending on input order', () => {
    const service = new AccessControlService(
      createPrismaService(jest.fn<Promise<PermissionQueryResult>, [unknown]>()),
    )

    expect(
      service.hasAll(
        ['users:update', 'users:read'],
        ['users:read', 'users:update'],
      ),
    ).toBe(true)
    expect(service.hasAll(['users:read'], ['users:read', 'users:update']))
      .toBe(false)
    expect(service.hasAll([], [])).toBe(true)
  })

  it('checks whether at least one required permission is granted', () => {
    const service = new AccessControlService(
      createPrismaService(jest.fn<Promise<PermissionQueryResult>, [unknown]>()),
    )

    expect(service.hasAny(['users:read'], ['audit:read', 'users:read']))
      .toBe(true)
    expect(service.hasAny(['users:read'], ['audit:read', 'roles:read']))
      .toBe(false)
    expect(service.hasAny(['users:read'], [])).toBe(false)
  })
})
