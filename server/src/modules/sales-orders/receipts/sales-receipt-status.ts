import type { SalesReceiptRequestStatus } from '../../../generated/prisma/enums'

/**
 * 三步流转中尚未落到终态的状态集合。
 *
 * 额度占用、订单取消资格与「待处理金额」都以这份清单为准：
 * 只统计 PENDING_REVIEW 会让已发群或已确认到账的款项脱离占用。
 */
export const SALES_RECEIPT_IN_FLIGHT_STATUSES = Object.freeze([
  'PENDING_REVIEW',
  'PENDING_CONFIRM',
  'PENDING_POSTING',
] as const) satisfies readonly SalesReceiptRequestStatus[]

/** 待发群：提交后等待财务发送水单，也是唯一可以驳回与重新提交的起点。 */
export const SALES_RECEIPT_ENTRY_STATUS = 'PENDING_REVIEW' satisfies SalesReceiptRequestStatus
/** 待入账：核对入账只在这个状态开放。 */
export const SALES_RECEIPT_POSTING_STATUS = 'PENDING_POSTING' satisfies SalesReceiptRequestStatus

/** 三个阶段都允许驳回；处于任一在途状态即视为「处理中」。 */
export function isSalesReceiptInFlight(status: string): boolean {
  return (SALES_RECEIPT_IN_FLIGHT_STATUSES as readonly string[]).includes(status)
}
