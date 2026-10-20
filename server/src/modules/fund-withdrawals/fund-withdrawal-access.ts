import type { Prisma } from '../../generated/prisma/client'
import type { DataScope } from '../access-control/data-scope'

/** 提款申请的归属人就是申请人；审批视图在 SELF 下也只能看到本人申请。 */
export function fundWithdrawalScopeWhere(
  scope: DataScope,
  actorUserId: string,
): Prisma.FundWithdrawalRequestWhereInput {
  return scope === 'SELF' ? { userId: actorUserId } : {}
}
