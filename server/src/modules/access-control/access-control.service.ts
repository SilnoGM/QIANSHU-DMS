import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'

const INTERNAL_ERROR_STATUS = 500
const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR'
const INTERNAL_ERROR_MESSAGE = '服务器内部错误'

/**
 * 提供每次请求实时读取权限的最小能力。
 *
 * 本服务刻意不缓存结果：管理员替换角色权限或用户角色后，下一次受保护请求必须立即
 * 使用数据库中的最新关系。当前 Schema 没有角色/权限启停字段；`isSystem` 与
 * `systemOnly` 仅表示内置归属，不能作为过滤条件。
 */
@Injectable()
export class AccessControlService {
  constructor(private readonly prisma: PrismaService) {}

  async getPermissionCodes(userId: string): Promise<string[]> {
    const userRoles = await this.loadUserRoles(userId)
    const permissionCodes = new Set<string>()

    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.permissions) {
        permissionCodes.add(rolePermission.permission.code)
      }
    }

    // 权限码由 ASCII 技术标识组成，默认字符串排序可提供跨请求稳定的输出。
    return [...permissionCodes].sort()
  }

  hasAll(
    grantedPermissionCodes: readonly string[],
    requiredPermissionCodes: readonly string[],
  ): boolean {
    const granted = new Set(grantedPermissionCodes)
    return requiredPermissionCodes.every((code) => granted.has(code))
  }

  hasAny(
    grantedPermissionCodes: readonly string[],
    requiredPermissionCodes: readonly string[],
  ): boolean {
    const granted = new Set(grantedPermissionCodes)
    return requiredPermissionCodes.some((code) => granted.has(code))
  }

  private async loadUserRoles(userId: string) {
    try {
      return await this.prisma.userRole.findMany({
        where: { userId },
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
    }
    catch {
      // Prisma/驱动错误可能包含 SQL、主机和连接信息；授权链路只返回固定安全契约。
      throw new ApiException(
        INTERNAL_ERROR_STATUS,
        INTERNAL_ERROR_CODE,
        INTERNAL_ERROR_MESSAGE,
      )
    }
  }
}
