import { HttpStatus, Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { PermissionDto } from './dto/permission.dto'

const PERMISSION_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  systemOnly: true,
} as const

/**
 * Permission 是迁移维护的只读目录；首期不提供运行时增删改入口。
 *
 * 排序在 SQL 中完成并同时使用 id 作为稳定次序，避免相同 code 的异常数据导致
 * 前端选择列表在请求之间跳动。
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PermissionDto[]> {
    try {
      return await this.prisma.permission.findMany({
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        select: PERMISSION_SELECT,
      })
    } catch {
      // Prisma/驱动错误可能包含 SQL 或连接信息，HTTP 边界只暴露固定错误。
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
        '服务器内部错误',
      )
    }
  }
}
