import type {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPartStatus,
  PurchaseOrderPaymentStatus,
  PurchaseOrderStatus,
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'
import {
  formatPurchaseOrderAmountUnits,
  parsePurchaseOrderAmountUnits,
} from '../domain/purchase-order-decimal'

export interface PurchaseCorrectionBlocker {
  readonly code: string
  readonly message: string
  readonly targetType: 'SALES_ORDER' | 'PURCHASE_ORDER' | 'PURCHASE_ORDER_PART' | 'PACKAGING_COST' | 'RECONCILIATION_BATCH'
  readonly targetId: string
}

export interface PurchaseCorrectionOrderSnapshot {
  readonly id: string
  readonly orderNo: string
  readonly orderStatus: SalesOrderStatus
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  readonly version: number
}

export interface PurchaseCorrectionPaymentSnapshot {
  readonly id: string
  readonly purchaseOrderId: string
  readonly purchaseOrderNo: string
  readonly paymentType: string
  readonly amount: string
  readonly paidAt: Date
  readonly paymentMethod: string | null
}

export interface PurchaseCorrectionPackagingSnapshot {
  readonly id: string
  readonly purchaseOrderId: string
  readonly shipmentId: string
  readonly shipmentNo: string
  readonly amount: string
  readonly status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED'
}

export interface PurchaseCorrectionReconciliationSnapshot {
  readonly id: string
  readonly batchNo: string
  readonly completedAt: Date | null
}

export interface PurchaseCorrectionContainerItemSnapshot {
  readonly id: string
  readonly shipmentId: string | null
  readonly containerBatchId: string
  readonly containerBatchNo: string
  readonly hasChanges: boolean
  readonly reconciliations: readonly PurchaseCorrectionReconciliationSnapshot[]
}

export interface PurchaseCorrectionLoadGroupSnapshot {
  readonly id: string
  readonly version: number
  readonly memberShipmentIds: readonly string[]
}

export interface PurchaseCorrectionPartSnapshot {
  readonly id: string
  readonly partNumber: number
  readonly shipmentNo: string | null
  readonly status: PurchaseOrderPartStatus
  readonly shippedAt: Date | null
  readonly warehouseReceivedAt: Date | null
  readonly loadedAt: Date | null
  readonly deliveredAt: Date | null
  readonly storageRecordCount: number
  readonly ownership: {
    readonly ownerType: 'SALES_ORDER' | 'STORAGE_POOL' | 'COMPANY'
    readonly ownerSalesOrderId: string | null
    readonly state: 'ACTIVE' | 'VOIDED'
  } | null
}

export interface PurchaseCorrectionPurchaseSnapshot {
  readonly id: string
  readonly orderNo: string
  readonly orderStatus: PurchaseOrderStatus
  readonly fulfillmentStatus: PurchaseOrderFulfillmentStatus
  readonly paymentStatus: PurchaseOrderPaymentStatus
  readonly version: number
  readonly parts: readonly PurchaseCorrectionPartSnapshot[]
  readonly payments: readonly PurchaseCorrectionPaymentSnapshot[]
  readonly packagingCosts: readonly PurchaseCorrectionPackagingSnapshot[]
  readonly containerItems: readonly PurchaseCorrectionContainerItemSnapshot[]
  readonly loadGroups: readonly PurchaseCorrectionLoadGroupSnapshot[]
}

export interface PurchaseCorrectionPlanInput {
  readonly order: PurchaseCorrectionOrderSnapshot
  readonly purchases: readonly PurchaseCorrectionPurchaseSnapshot[]
  /// 目标销售单已有的寄仓认领数量；任何一行大于 0 都说明不是整单误建。
  readonly claimedQuantities: ReadonlyMap<string, number>
}

export interface PurchaseCorrectionPlan {
  readonly blockers: readonly PurchaseCorrectionBlocker[]
  readonly purchaseOrderIds: readonly string[]
  readonly partIds: readonly string[]
  readonly payments: readonly PurchaseCorrectionPaymentSnapshot[]
  readonly totalPaymentAmount: string
  readonly packagingCostsToCancel: readonly PurchaseCorrectionPackagingSnapshot[]
  readonly containerItemsToDetach: readonly PurchaseCorrectionContainerItemSnapshot[]
  readonly loadGroupIds: readonly string[]
  readonly preservedReconciliations: readonly PurchaseCorrectionReconciliationSnapshot[]
  readonly canApply: boolean
}

function blocker(
  code: string,
  message: string,
  targetType: PurchaseCorrectionBlocker['targetType'],
  targetId: string,
): PurchaseCorrectionBlocker {
  return { code, message, targetType, targetId }
}

function uniqueById<T extends { readonly id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

/**
 * 把纠正所需的原始快照收敛成一个可执行计划。
 *
 * 这里不做任何 I/O，只回答两个问题：能不能纠正、纠正要动哪些对象。
 * 阻断项按“先不可逆、后数据不一致”的顺序生成，调用方直接展示即可；
 * 任何阻断都会让 `canApply` 为 false，服务端不会跳过阻断继续执行。
 */
export function buildPurchaseCorrectionPlan(
  input: PurchaseCorrectionPlanInput,
): PurchaseCorrectionPlan {
  const blockers: PurchaseCorrectionBlocker[] = []
  const { order, purchases } = input

  if (order.orderStatus !== 'CONFIRMED') {
    blockers.push(blocker(
      'PURCHASE_CORRECTION_NOT_ALLOWED',
      '只有已确认且未进入对账终态的销售订单可以纠正',
      'SALES_ORDER',
      order.id,
    ))
  }

  const signed = order.fulfillmentStatus === 'SIGNED'
    || purchases.some(purchase => purchase.parts.some(part => part.deliveredAt !== null))
  if (signed) {
    blockers.push(blocker(
      'PURCHASE_CORRECTION_SIGNED',
      '订单或货件已签收，V1 不支持撤销签收后的采购链',
      'SALES_ORDER',
      order.id,
    ))
  }

  if (purchases.length === 0) {
    blockers.push(blocker(
      'PURCHASE_CORRECTION_NO_ACTIVE_PURCHASE',
      '该销售订单没有可纠正的有效采购单',
      'SALES_ORDER',
      order.id,
    ))
  }

  const claimed = [...input.claimedQuantities.values()].some(quantity => quantity > 0)
  if (claimed) {
    blockers.push(blocker(
      'PURCHASE_CORRECTION_OTHER_COVERAGE',
      '该销售订单已存在寄仓认领覆盖，不是整单误建采购，不能整单退回待采购',
      'SALES_ORDER',
      order.id,
    ))
  }

  const parts = purchases.flatMap(purchase => purchase.parts)
  const partIds = new Set(parts.map(part => part.id))

  for (const purchase of purchases) {
    for (const part of purchase.parts) {
      if (
        part.ownership === null
        || part.ownership.state !== 'ACTIVE'
        || part.ownership.ownerType !== 'SALES_ORDER'
        || part.ownership.ownerSalesOrderId !== order.id
      ) {
        blockers.push(blocker(
          'PURCHASE_CORRECTION_OWNERSHIP_CHANGED',
          `货件 ${part.shipmentNo ?? `货件-${part.partNumber}`} 的归属已变化，请先处理归属后再纠正`,
          'PURCHASE_ORDER_PART',
          part.id,
        ))
      }
    }
    for (const cost of purchase.packagingCosts) {
      if (cost.status === 'PAID') {
        blockers.push(blocker(
          'PURCHASE_CORRECTION_PACKAGING_PAID',
          `货件 ${cost.shipmentNo} 的打木架费已付款，当前没有冲回入口，不能纠正`,
          'PACKAGING_COST',
          cost.id,
        ))
      }
    }
    for (const group of purchase.loadGroups) {
      const outside = group.memberShipmentIds.filter(id => !partIds.has(id))
      if (outside.length > 0) {
        blockers.push(blocker(
          'PURCHASE_CORRECTION_LOAD_GROUP_MISMATCH',
          '装柜合并组成员超出本销售单的有效货件范围，请先释放合并组',
          'PURCHASE_ORDER',
          purchase.id,
        ))
      }
    }
  }

  const storageRecordCount = purchases.reduce(
    (count, purchase) => count + purchase.parts.filter(part => part.storageRecordCount > 0).length,
    0,
  )
  if (storageRecordCount > 0) {
    blockers.push(blocker(
      'PURCHASE_CORRECTION_STORAGE_RECORD',
      '货件已进入寄仓池，存在寄仓记录，不能按误建采购纠正',
      'SALES_ORDER',
      order.id,
    ))
  }

  const containerItems = uniqueById(purchases.flatMap(purchase => purchase.containerItems))
  const reconciliations = uniqueById(
    containerItems.flatMap(item => item.reconciliations),
  )
  for (const reconciliation of reconciliations) {
    if (reconciliation.completedAt === null) {
      blockers.push(blocker(
        'PURCHASE_CORRECTION_RECONCILING',
        `柜次仍在进行中的对账批次 ${reconciliation.batchNo} 内，当前没有撤账入口，请先完成或撤销对账`,
        'RECONCILIATION_BATCH',
        reconciliation.id,
      ))
    }
  }

  const payments = purchases
    .flatMap(purchase => purchase.payments)
    .sort((left, right) => (
      left.paidAt.getTime() - right.paidAt.getTime()
      || left.id.localeCompare(right.id)
    ))
  const packagingCostsToCancel = purchases
    .flatMap(purchase => purchase.packagingCosts)
    .filter(cost => cost.status === 'PENDING_PAYMENT')
  const loadGroupIds = [...new Set(purchases.flatMap(purchase => purchase.loadGroups.map(group => group.id)))].sort()
  const preservedReconciliations = reconciliations.filter(row => row.completedAt !== null)

  return {
    blockers,
    purchaseOrderIds: purchases.map(purchase => purchase.id),
    partIds: [...partIds],
    payments,
    totalPaymentAmount: payments.length === 0
      ? '0.00'
      : formatPurchaseOrderAmountUnits(payments.reduce(
          (sum, payment) => sum + parsePurchaseOrderAmountUnits(payment.amount),
          0n,
        )),
    packagingCostsToCancel,
    containerItemsToDetach: containerItems.filter(item => item.shipmentId !== null),
    loadGroupIds,
    preservedReconciliations,
    canApply: blockers.length === 0 && purchases.length > 0,
  }
}
