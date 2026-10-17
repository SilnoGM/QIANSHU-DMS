import type {
  FundAccountView,
  FundSelfAccountView,
} from './fund-account.contract'
import type {
  FundSelfTransactionView,
  FundTransactionView,
} from './fund-transaction.contract'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
} from './fund-posting.errors'

/**
 * 本人账户投影。
 *
 * 只接受 USER 账户：公司账户不属于任何运营个人；比例与调整时间在 USER
 * 账户上由数据库约束保证非空。公司分成比例即使可推导也不出现在投影里。
 */
export function mapFundSelfAccountView(
  view: FundAccountView,
): FundSelfAccountView {
  if (
    view.ownerType !== 'USER'
    || view.userShareRate === null
    || view.shareRateUpdatedAt === null
  ) {
    throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }

  return Object.freeze({
    id: view.id,
    currency: view.currency,
    balance: view.balance,
    userShareRate: view.userShareRate,
    shareRateUpdatedAt: view.shareRateUpdatedAt,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  })
}

/**
 * 本人流水投影：来源说明保留，公司比例与内部标识/规则策略不下发。
 */
export function mapFundSelfTransactionView(
  view: FundTransactionView,
): FundSelfTransactionView {
  return Object.freeze({
    entryId: view.entryId,
    batchNo: view.batchNo,
    batchKind: view.batchKind,
    postingTypeId: view.postingTypeId,
    postingTypeName: view.postingTypeName,
    businessCategory: view.businessCategory,
    businessSourceName: view.businessSourceName,
    direction: view.direction,
    amount: view.amount,
    balanceBefore: view.balanceBefore,
    balanceAfter: view.balanceAfter,
    accountSequence: view.accountSequence,
    businessAmount: view.businessAmount,
    userShareRateSnapshot: view.userShareRateSnapshot,
    businessNo: view.businessNo,
    summary: view.summary,
    businessOccurredAt: view.businessOccurredAt,
    reversalStatus: view.reversalStatus,
    postedAt: view.postedAt,
  })
}
