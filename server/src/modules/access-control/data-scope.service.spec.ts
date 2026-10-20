import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { DataScopeService } from './data-scope.service'

type RoleRow = {
  role: {
    code: string
    permissions: Array<{ permission: { code: string } }>
  }
}

function createService(findMany: jest.Mock<Promise<RoleRow[]>, [unknown]>): DataScopeService {
  return new DataScopeService({
    userRole: { findMany },
  } as unknown as PrismaService)
}

describe('DataScopeService', () => {
  it('queries only the data scope permissions and resolves SELF for operations', async () => {
    const findMany = jest.fn<Promise<RoleRow[]>, [unknown]>().mockResolvedValue([
      {
        role: {
          code: 'operations_staff',
          permissions: [{ permission: { code: 'data-scope:self' } }],
        },
      },
    ])

    await expect(createService(findMany).resolve('user-1')).resolves.toBe('SELF')

    const query = findMany.mock.calls[0]?.[0] as {
      where: { userId: string }
      select: { role: { select: { permissions: { where: { permission: { code: { in: string[] } } } } } } }
    }
    expect(query.where).toEqual({ userId: 'user-1' })
    expect(query.select.role.select.permissions.where.permission.code.in).toEqual([
      'data-scope:all',
      'data-scope:self',
    ])
  })

  it('lets an all grant win over the operations role', async () => {
    const findMany = jest.fn<Promise<RoleRow[]>, [unknown]>().mockResolvedValue([
      {
        role: {
          code: 'operations_staff',
          permissions: [{ permission: { code: 'data-scope:self' } }],
        },
      },
      {
        role: {
          code: 'finance_staff',
          permissions: [{ permission: { code: 'data-scope:all' } }],
        },
      },
    ])

    await expect(createService(findMany).resolve('user-1')).resolves.toBe('ALL')
  })

  it('fails closed with the stable internal error contract', async () => {
    const findMany = jest.fn<Promise<RoleRow[]>, [unknown]>()
      .mockRejectedValue(new Error('database password leaked in message'))

    await expect(createService(findMany).resolve('user-1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      publicMessage: '服务器内部错误',
    })
  })
})
