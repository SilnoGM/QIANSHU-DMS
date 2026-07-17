import { HttpStatus } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { PermissionsService } from './permissions.service'

const PERMISSION_A_ID = '00000000-0000-4000-8000-000000000001'
const PERMISSION_B_ID = '00000000-0000-4000-8000-000000000002'

function createService(findMany: jest.Mock) {
  const prisma = {
    permission: { findMany },
  } as unknown as PrismaService

  return new PermissionsService(prisma)
}

describe('PermissionsService', () => {
  it('returns the safe permission catalogue ordered by code and id', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: PERMISSION_A_ID,
        code: 'audit:read',
        name: '查询安全审计',
        description: null,
        systemOnly: true,
      },
      {
        id: PERMISSION_B_ID,
        code: 'roles:read',
        name: '查询角色和权限目录',
        description: '管理权限',
        systemOnly: true,
      },
    ])
    const service = createService(findMany)

    await expect(service.list()).resolves.toEqual([
      {
        id: PERMISSION_A_ID,
        code: 'audit:read',
        name: '查询安全审计',
        description: null,
        systemOnly: true,
      },
      {
        id: PERMISSION_B_ID,
        code: 'roles:read',
        name: '查询角色和权限目录',
        description: '管理权限',
        systemOnly: true,
      },
    ])
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        systemOnly: true,
      },
    })
  })

  it('does not expose database details when the catalogue query fails', async () => {
    const service = createService(
      jest
        .fn()
        .mockRejectedValue(
          new Error('postgres://secret@example.invalid?password=leak'),
        ),
    )

    const error = await service.list().catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'INTERNAL_ERROR',
      publicMessage: '服务器内部错误',
    })
    expect((error as { getStatus(): number }).getStatus()).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    )
    expect((error as Error).message).not.toContain('postgres://')
  })
})
