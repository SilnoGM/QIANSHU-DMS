import type { Prisma } from '../../generated/prisma/client'
import type { DataScope } from '../access-control/data-scope'

/**
 * 包装费用按费用归属人（销售单出单人）过滤；它同时是付款扣款账户的归属人。
 *
 * 提交人只用于审计，不作为数据范围依据。
 */
export function packagingCostScopeWhere(
  scope: DataScope,
  actorUserId: string,
): Prisma.PackagingCostRequestWhereInput {
  return scope === 'SELF' ? { ownerUserId: actorUserId } : {}
}
