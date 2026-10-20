import type { Prisma } from '../../generated/prisma/client'
import type { DataScope } from '../access-control/data-scope'

/**
 * 销售订单及其子资源的归属谓词：出单人是业务归属人。
 *
 * 传 `ALL` 时返回空对象，保持财务/采运/管理员与既有自定义角色的全量行为。
 */
export function salesOrderScopeWhere(
  scope: DataScope,
  actorUserId: string,
): Prisma.SalesOrderWhereInput {
  return scope === 'SELF' ? { issuerUserId: actorUserId } : {}
}
