import type { Prisma } from '../../../generated/prisma/client'
import type { DataScope } from '../../access-control/data-scope'

/**
 * 资金域的数据范围谓词。
 *
 * 流水必须经 `accountId -> FundAccount.userId` 归属；不能只看
 * `FundPostingBatch.userId`，否则同一批次里的 COMPANY 分录会带出公司余额。
 */
export function fundAccountScopeWhere(
  scope: DataScope,
  actorUserId: string,
): Prisma.FundAccountWhereInput {
  return scope === 'SELF' ? { userId: actorUserId } : {}
}

export function fundLedgerEntryScopeWhere(
  scope: DataScope,
  actorUserId: string,
): Prisma.FundLedgerEntryWhereInput {
  return scope === 'SELF'
    ? { account: { is: { userId: actorUserId } } }
    : {}
}
