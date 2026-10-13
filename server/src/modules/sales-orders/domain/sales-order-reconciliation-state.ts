import type { Prisma } from '../../../generated/prisma/client'
import type {
  SalesOrderFulfillmentStatus,
  SalesOrderPaymentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'

/**
 * 订单级对账状态（口径 R3）：订单被对账覆盖（存在冻结进批次的成员行）且
 * 没有任何成员行处于进行中的批次，才算「对账已完结」——从未被账单覆盖的订单
 * （账单未导入或匹配失败）视为未完结，停在对账前等待，直到账单完成对账。
 *
 * `unreconciledMemberCount` 只用于停留原因展示（进行中批次里还有多少行没核对）；
 * 完成判定只依赖 `settled`：批次能结束就说明其成员全部已核对，这是完成批次的服务端门禁
 * 保证的硬不变量。
 */
export interface SalesOrderReconciliationState {
  readonly memberCount: number
  readonly pendingBatchCount: number
  readonly unreconciledMemberCount: number
  readonly settled: boolean
}

/** 待对账订单停在「待对账」的可见原因（完成判定见自动状态服务，口径 R3）。 */
export type SalesOrderCompletionHoldReason
  = | 'AWAITING_RECONCILIATION_COVERAGE'
    | 'PAYMENT_INCOMPLETE'
    | 'RECONCILIATION_IN_PROGRESS'

/**
 * `pendingBatchCount` / `unreconciledMemberCount` 只在原因与对账相关时才有信息量，
 * 「款项未收齐」也一并带上，前端可组合成更具体的提示文案。
 */
export interface SalesOrderCompletionHold {
  readonly reason: SalesOrderCompletionHoldReason
  readonly pendingBatchCount: number
  readonly unreconciledMemberCount: number
}

const NO_COVERAGE: SalesOrderReconciliationState = Object.freeze({
  memberCount: 0,
  pendingBatchCount: 0,
  unreconciledMemberCount: 0,
  settled: false,
})

/**
 * 停留原因与自动状态服务的完成判定共用同一份对账状态，保证「为什么没自动完成」的
 * 展示口径与推进口径不漂移：先看付清前置（完成要求已签收且已付清），再看对账完备性
 * （口径 R3：有覆盖且没有进行中的批次）。
 * 「对账已完结」正常会被自动推进到已完成，这里兜底返回 null，不显示误导性原因。
 */
export function resolveSalesOrderCompletionHold(
  order: {
    readonly orderStatus: SalesOrderStatus
    readonly fulfillmentStatus: SalesOrderFulfillmentStatus
    readonly paymentStatus: SalesOrderPaymentStatus
  },
  state: SalesOrderReconciliationState | undefined,
): SalesOrderCompletionHold | null {
  if (order.orderStatus !== 'PENDING_RECONCILIATION') {
    return null
  }
  const counts = {
    pendingBatchCount: state?.pendingBatchCount ?? 0,
    unreconciledMemberCount: state?.unreconciledMemberCount ?? 0,
  }
  if (order.fulfillmentStatus !== 'SIGNED' || order.paymentStatus !== 'PAID') {
    return { reason: 'PAYMENT_INCOMPLETE', ...counts }
  }
  if (state === undefined || state.settled) {
    return null
  }
  if (state.pendingBatchCount > 0) {
    return { reason: 'RECONCILIATION_IN_PROGRESS', ...counts }
  }
  return { reason: 'AWAITING_RECONCILIATION_COVERAGE', ...counts }
}

/**
 * 批量读取订单级对账状态：列表页一次覆盖当页全部待对账订单，详情页传单个主键。
 * 调用方可以传事务客户端（自动状态服务在持锁事务内）或常规客户端（读路径）。
 */
export async function readSalesOrderReconciliationStates(
  client: Prisma.TransactionClient,
  salesOrderIds: readonly string[],
): Promise<ReadonlyMap<string, SalesOrderReconciliationState>> {
  if (salesOrderIds.length === 0) {
    return new Map()
  }
  const rows = await client.slhReconciliationBatchLine.findMany({
    where: {
      matchedLoadingItem: { shipment: { purchaseOrder: { salesOrderId: { in: [...salesOrderIds] } } } },
    },
    select: {
      batchId: true,
      reconciledAt: true,
      batch: { select: { completedAt: true } },
      matchedLoadingItem: {
        select: { shipment: { select: { purchaseOrder: { select: { salesOrderId: true } } } } },
      },
    },
  })
  const pendingBatchIdsByOrder = new Map<string, Set<string>>()
  const totals = new Map<string, { memberCount: number, unreconciledMemberCount: number }>()
  for (const row of rows) {
    // 备货采购（无来源销售订单）的货件不会被归到任何订单，直接跳过。
    const salesOrderId = row.matchedLoadingItem.shipment?.purchaseOrder.salesOrderId
    if (salesOrderId === undefined || salesOrderId === null) {
      continue
    }
    const totalsEntry = totals.get(salesOrderId) ?? { memberCount: 0, unreconciledMemberCount: 0 }
    totalsEntry.memberCount += 1
    if (row.reconciledAt === null) {
      totalsEntry.unreconciledMemberCount += 1
    }
    totals.set(salesOrderId, totalsEntry)
    if (row.batch.completedAt === null) {
      const pending = pendingBatchIdsByOrder.get(salesOrderId) ?? new Set<string>()
      pending.add(row.batchId)
      pendingBatchIdsByOrder.set(salesOrderId, pending)
    }
  }
  const states = new Map<string, SalesOrderReconciliationState>()
  for (const salesOrderId of salesOrderIds) {
    const totalsEntry = totals.get(salesOrderId)
    if (totalsEntry === undefined) {
      states.set(salesOrderId, NO_COVERAGE)
      continue
    }
    const pendingBatchCount = pendingBatchIdsByOrder.get(salesOrderId)?.size ?? 0
    states.set(salesOrderId, {
      memberCount: totalsEntry.memberCount,
      pendingBatchCount,
      unreconciledMemberCount: totalsEntry.unreconciledMemberCount,
      settled: pendingBatchCount === 0,
    })
  }
  return states
}
