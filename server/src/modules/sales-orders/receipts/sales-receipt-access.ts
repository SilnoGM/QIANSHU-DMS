import type { Prisma } from '../../../generated/prisma/client'
import type { DataScope } from '../../access-control/data-scope'

/**
 * 销售收款申请按业务归属人（销售单出单人）过滤。
 *
 * `submittedByUserId` 是实际提交人，可能由财务/管理员代提交；资金入账使用
 * `accountOwnerUserId`，因此数据范围也以它为准。
 */
export function salesReceiptScopeWhere(
  scope: DataScope,
  actorUserId: string,
): Prisma.SalesReceiptRequestWhereInput {
  return scope === 'SELF' ? { accountOwnerUserId: actorUserId } : {}
}
