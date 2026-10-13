import type {
  SlhBillLineUnmatchedReasonCountDto,
  SlhReconciliationBatchListItemDto,
  SlhReconciliationMatchedPurchaseOrderDto,
  SlhReconciliationMatchedSalesOrderDto,
} from '@/api/generated/types.gen'

/**
 * 批次状态与匹配原因的「取值 → 文案/颜色」映射（前端唯一一处），
 * 以及本页两个写动作的门禁：完成批次、本行核对。
 * 取值全部以契约为准（生成类型）：批次自身状态、以及「这一行为什么不能核对」。
 */
export type SlhReconciliationBatchStatus = SlhReconciliationBatchListItemDto['status']
export type SlhBillLineUnmatchedReason = SlhBillLineUnmatchedReasonCountDto['code']

/** 进行中用主色（还在作业中），已完成用绿色（收口）。与对账状态标签同款 outline 变体，不铺底色。 */
const BATCH_STATUS_TONES: Readonly<Record<SlhReconciliationBatchStatus, string>> = {
  IN_PROGRESS: 'border-primary/40 text-primary',
  COMPLETED: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
}

export function resolveSlhReconciliationBatchTone(status: SlhReconciliationBatchStatus): string {
  return BATCH_STATUS_TONES[status]
}

export function resolveSlhReconciliationBatchLabelKey(status: SlhReconciliationBatchStatus): string {
  return `slhReconciliation.batchStatus.${status}`
}

/** 完成批次的门禁原因：批次已结束、或还有未核对的明细行。 */
export type SlhReconciliationCompleteBlockReason = 'BATCH_COMPLETED' | 'LINES_UNRECONCILED'

const COMPLETE_BLOCK_LABEL_KEYS: Readonly<Record<SlhReconciliationCompleteBlockReason, string>> = {
  BATCH_COMPLETED: 'slhReconciliation.detail.completeBlockedBatchCompleted',
  LINES_UNRECONCILED: 'slhReconciliation.detail.completeBlockedUnreconciled',
}

/**
 * 完成批次的门禁：返回 null 表示可以完成。
 * 判定只看服务端下发的计数（已核对行数由服务端统计），前端不自行推导每一行的状态；
 * 成员数为 0 的批次不挡（没有可核对的行，与既有语义一致）。
 */
export function resolveSlhReconciliationCompleteBlockReason(batch: {
  readonly memberCount: number
  readonly reconciledMemberCount: number
  readonly status: SlhReconciliationBatchStatus
}): SlhReconciliationCompleteBlockReason | null {
  if (batch.status !== 'IN_PROGRESS') {
    return 'BATCH_COMPLETED'
  }
  return batch.reconciledMemberCount >= batch.memberCount ? null : 'LINES_UNRECONCILED'
}

export function resolveSlhReconciliationCompleteBlockLabelKey(reason: SlhReconciliationCompleteBlockReason): string {
  return COMPLETE_BLOCK_LABEL_KEYS[reason]
}

/** 「本行核对正确」的门禁原因：销售订单或采购订单未达到核对前置状态。 */
export type SlhReconciliationSettleBlockReason = 'SALES_ORDER_NOT_READY' | 'PURCHASE_ORDER_NOT_READY'

const SETTLE_BLOCK_LABEL_KEYS: Readonly<Record<SlhReconciliationSettleBlockReason, string>> = {
  SALES_ORDER_NOT_READY: 'slhReconciliation.detail.settleBlockedSalesOrder',
  PURCHASE_ORDER_NOT_READY: 'slhReconciliation.detail.settleBlockedPurchaseOrder',
}

/**
 * 「本行核对正确」的门禁：返回 null 表示可以核对。
 *
 * 销售侧三个维度必须同时成立——待对账不蕴含已付清：待对账状态下仍允许作废收款，
 * 付款状态会回落而订单状态不会跟着退，因此付款状态必须单独查（已签收是履约终态，不会被回退）。
 * 采购侧只查订单状态：`COMPLETED` 由服务端从履约与付款事实派生，数据库还有
 * `purchase_orders_completed_requires_signed_paid_check` 兜底，其余两维无需重复校验。
 * 订单来源缺失（脏数据）与条件不满足同路，从紧不放行。
 */
export function resolveSlhReconciliationSettleBlockReason(member: {
  readonly salesOrder?: Pick<SlhReconciliationMatchedSalesOrderDto, 'orderStatus' | 'fulfillmentStatus' | 'paymentStatus'> | null
  readonly purchaseOrder?: Pick<SlhReconciliationMatchedPurchaseOrderDto, 'orderStatus' | 'fulfillmentStatus' | 'paymentStatus'> | null
}): SlhReconciliationSettleBlockReason | null {
  const sales = member.salesOrder ?? null
  if (
    sales === null
    || sales.orderStatus !== 'PENDING_RECONCILIATION'
    || sales.fulfillmentStatus !== 'SIGNED'
    || sales.paymentStatus !== 'PAID'
  ) {
    return 'SALES_ORDER_NOT_READY'
  }
  const purchase = member.purchaseOrder ?? null
  if (purchase === null || purchase.orderStatus !== 'COMPLETED') {
    return 'PURCHASE_ORDER_NOT_READY'
  }
  return null
}

export function resolveSlhReconciliationSettleBlockLabelKey(reason: SlhReconciliationSettleBlockReason): string {
  return SETTLE_BLOCK_LABEL_KEYS[reason]
}

/** 不合格原因：与账单行的匹配规则一一对应（见 slh-bill-line-matching），前端只做取值到文案键的映射。 */
export function resolveSlhBillLineUnmatchedReasonLabelKey(reason: SlhBillLineUnmatchedReason): string {
  return `slhReconciliation.unmatchedReason.${reason}`
}
