import type { SalesOrderFulfillmentStatus } from '../../../generated/prisma/enums'

/**
 * 履约阶段是单向流水线。产品编辑只允许沿这条链补推，或在尚未发货时
 * 退回待采购；已经形成的发货/入仓/装柜事实不能被一次产品编辑抹掉。
 */
export const SALES_ORDER_FULFILLMENT_STAGE_ORDER = [
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
  'SEA_TRANSIT',
  'SIGNED',
] as const satisfies readonly SalesOrderFulfillmentStatus[]

export interface ProductEditFulfillmentFacts {
  readonly currentStatus: SalesOrderFulfillmentStatus
  readonly remainingQuantity: number
  readonly approvedPurchaseOrderCount: number
  readonly activePurchaseOrderCount: number
  readonly allPurchaseOrdersApproved: boolean
  readonly hasPendingReviewParts: boolean
  readonly activePartCount: number
  readonly shippedPartCount: number
  readonly receivedPartCount: number
  readonly loadedPartCount: number
  readonly hasShippedPurchaseOrder: boolean
}

export function salesOrderFulfillmentStageRank(
  status: SalesOrderFulfillmentStatus,
): number {
  return SALES_ORDER_FULFILLMENT_STAGE_ORDER.indexOf(status)
}

export function deriveProductEditFulfillmentStatus(
  facts: ProductEditFulfillmentFacts,
): SalesOrderFulfillmentStatus {
  const current = facts.currentStatus
  if (facts.remainingQuantity > 0) {
    // 一旦存在发货事实，产品编辑不能再把订单降回待采购：新增的缺口由采购域
    // 按采购来源继续处理，履约阶段必须保持已经发生的物理事实。
    const hasShippedFacts = facts.hasShippedPurchaseOrder
      || facts.shippedPartCount > 0
    if (
      hasShippedFacts
      || salesOrderFulfillmentStageRank(current)
        >= salesOrderFulfillmentStageRank('LAND_TRANSIT')
    ) {
      return current
    }
    return 'PENDING'
  }

  // 覆盖完整但没有任何已审核采购时保持现状，避免凭空推进履约阶段。
  if (facts.approvedPurchaseOrderCount === 0) return current

  const allShipped = facts.activePurchaseOrderCount > 0
    && facts.allPurchaseOrdersApproved
    && !facts.hasPendingReviewParts
    && facts.activePartCount > 0
    && facts.shippedPartCount === facts.activePartCount
  const allReceived = allShipped
    && facts.receivedPartCount === facts.activePartCount
  const allLoaded = allReceived
    && facts.loadedPartCount === facts.activePartCount
  const derived: SalesOrderFulfillmentStatus = allLoaded
    ? 'SEA_TRANSIT'
    : allReceived
      ? 'WAREHOUSE_ARRIVED'
      : allShipped
        ? 'LAND_TRANSIT'
        : 'PREPARING'
  return salesOrderFulfillmentStageRank(derived)
    > salesOrderFulfillmentStageRank(current)
    ? derived
    : current
}

/**
 * 产品编辑后需要写入状态历史的阶段链路。前向补齐按顺序逐级返回，
 * 唯一的回退（尚未发货时的 PREPARING → PENDING）返回单条边。
 */
export function productEditFulfillmentSteps(
  from: SalesOrderFulfillmentStatus,
  to: SalesOrderFulfillmentStatus,
): readonly {
  readonly fromStatus: SalesOrderFulfillmentStatus
  readonly toStatus: SalesOrderFulfillmentStatus
}[] {
  const fromRank = salesOrderFulfillmentStageRank(from)
  const toRank = salesOrderFulfillmentStageRank(to)
  if (fromRank < 0 || toRank < 0 || fromRank === toRank) return []
  if (toRank < fromRank) return [{ fromStatus: from, toStatus: to }]
  return SALES_ORDER_FULFILLMENT_STAGE_ORDER
    .slice(fromRank + 1, toRank + 1)
    .map((toStatus, index) => ({
      fromStatus: SALES_ORDER_FULFILLMENT_STAGE_ORDER[fromRank + index],
      toStatus,
    }))
}

export function productEditFulfillmentReason(
  toStatus: SalesOrderFulfillmentStatus,
): string {
  switch (toStatus) {
    case 'PENDING':
      return '销售产品修改后存在待采购数量'
    case 'PREPARING':
      return '销售产品修改后已完成采购覆盖'
    case 'LAND_TRANSIT':
      return '销售产品修改后按采购发货事实补齐陆运'
    case 'WAREHOUSE_ARRIVED':
      return '销售产品修改后按货件入仓事实补齐入仓'
    case 'SEA_TRANSIT':
      return '销售产品修改后按货件装柜事实补齐海运在途'
    default:
      return '销售产品修改后重新计算履约状态'
  }
}
