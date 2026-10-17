import {
  FUND_WITHDRAWAL_POSTING_TYPE,
  FUND_WITHDRAWAL_SUMMARY,
} from './fund-withdrawal'

/**
 * 摘要与独立关联单号同时展示时，摘要不再重复业务单号。
 * 旧提款批次曾把单号写进摘要，但资金批次不可变，因此读取时按同一规则收敛；
 * 新写入的摘要本身已不含单号。
 */
export function resolveFundTransactionSummary(input: {
  readonly postingTypeCode: string
  readonly businessNo: string | null
  readonly summary: string
}): string {
  if (input.postingTypeCode !== FUND_WITHDRAWAL_POSTING_TYPE || input.businessNo === null) {
    return input.summary
  }
  return input.summary === `${FUND_WITHDRAWAL_SUMMARY} ${input.businessNo}`
    ? FUND_WITHDRAWAL_SUMMARY
    : input.summary
}
