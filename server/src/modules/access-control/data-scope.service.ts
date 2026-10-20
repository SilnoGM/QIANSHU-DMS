import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  DATA_SCOPE_PERMISSION_CODES,
  resolveDataScope,
  type DataScope,
} from './data-scope'

export { resolveDataScopeActor } from './data-scope'

/**
 * 仅用于直接实例化 service 的旧测试：生产 Nest 注入真实 DataScopeService；
 * 非测试环境缺少依赖时立即抛错，不能静默按 ALL 放行。
 */
export function dataScopeFallback(): DataScopeService {
  if (
    process.env.NODE_ENV === 'test'
    || process.env.JEST_WORKER_ID !== undefined
  ) {
    return {
      resolve: () => Promise.resolve('ALL'),
      resolveInTransaction: () => Promise.resolve('ALL'),
    } as unknown as DataScopeService
  }
  throw new Error('DataScopeService is required')
}

const INTERNAL_ERROR_STATUS = 500
const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR'
const INTERNAL_ERROR_MESSAGE = '服务器内部错误'

type DataScopeReader = Pick<Prisma.TransactionClient, 'userRole'>

/**
 * 每次请求实时解析数据范围，不缓存角色或权限结果。
 *
 * 查询只取角色码与两条数据范围权限，避免把完整权限集合加载到业务查询层；
 * 与 PermissionGuard 一样，角色/权限变更在下一个请求立即生效。
 */
@Injectable()
export class DataScopeService {
  constructor(private readonly prisma: PrismaService) {}

  resolve(userId: string): Promise<DataScope> {
    return this.resolveFrom(this.prisma, userId)
  }

  resolveInTransaction(
    transaction: DataScopeReader,
    userId: string,
  ): Promise<DataScope> {
    return this.resolveFrom(transaction, userId)
  }

  private async resolveFrom(
    reader: DataScopeReader,
    userId: string,
  ): Promise<DataScope> {
    try {
      const userRoles = await reader.userRole.findMany({
        where: { userId },
        select: {
          role: {
            select: {
              code: true,
              permissions: {
                where: {
                  permission: {
                    code: { in: [...DATA_SCOPE_PERMISSION_CODES] },
                  },
                },
                select: { permission: { select: { code: true } } },
              },
            },
          },
        },
      })

      return resolveDataScope({
        permissionCodes: userRoles.flatMap(userRole =>
          userRole.role.permissions.map(item => item.permission.code),
        ),
        roleCodes: userRoles.map(userRole => userRole.role.code),
      })
    }
    catch {
      // 授权链路只暴露固定安全契约，避免把 SQL、连接信息带入响应。
      throw new ApiException(
        INTERNAL_ERROR_STATUS,
        INTERNAL_ERROR_CODE,
        INTERNAL_ERROR_MESSAGE,
      )
    }
  }
}
