import { HttpStatus } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { AuditService } from '../audit/audit.service'
import { salesOrderRuleFailure } from './domain/sales-order-errors'
import { assertSalesOrderFulfillmentTransition } from './domain/sales-order-state-machine'
import type { SalesOrderAutomaticStateService } from './sales-order-automatic-state.service'

export interface ShipmentDeliveryContext {
  readonly actorUserId: string
  readonly requestId: string
}

export interface SalesOrderShipmentSignOutcome {
  readonly salesOrderSigned: boolean
  readonly remainingShipmentCount: number
  readonly salesOrderReceiptRequired: boolean
}

export interface ShipmentPartRow {
  readonly id: string
  readonly purchaseOrderId: string
  readonly shipmentNo: string | null
  readonly partNumber: number
  readonly status: 'PENDING_REVIEW' | 'ACTIVE' | 'CANCELLED'
  readonly loadedAt: Date | null
  readonly deliveredAt: Date | null
}

export interface ShipmentDeliveryState {
  readonly parts: readonly ShipmentPartRow[]
  readonly activePartIds: readonly string[]
  readonly undeliveredActivePartIds: readonly string[]
  readonly pendingReviewPartIds: readonly string[]
  readonly unloadedActivePartIds: readonly string[]
}

/**
 * 有效货件的唯一口径：未取消销售关联采购单下的货件。
 * 待审核货件也算在集合里，因为审核通过后会变成新的有效货件，签收前必须先解决。
 */
export async function readSalesOrderShipmentDeliveryState(
  transaction: Prisma.TransactionClient,
  salesOrderId: string,
): Promise<ShipmentDeliveryState> {
  const parts = await transaction.purchaseOrderPart.findMany({
    where: {
      purchaseOrder: {
        is: {
          salesOrderId,
          purchaseType: 'SALES_LINKED',
          orderStatus: { not: 'CANCELLED' },
        },
      },
    },
    select: {
      id: true,
      purchaseOrderId: true,
      shipmentNo: true,
      partNumber: true,
      status: true,
      loadedAt: true,
      deliveredAt: true,
    },
    orderBy: [{ purchaseOrderId: 'asc' }, { partNumber: 'asc' }, { id: 'asc' }],
  })
  return {
    parts,
    activePartIds: parts.filter(part => part.status === 'ACTIVE').map(part => part.id),
    undeliveredActivePartIds: parts
      .filter(part => part.status === 'ACTIVE' && part.deliveredAt === null)
      .map(part => part.id),
    pendingReviewPartIds: parts
      .filter(part => part.status === 'PENDING_REVIEW')
      .map(part => part.id),
    unloadedActivePartIds: parts
      .filter(part => part.status === 'ACTIVE' && part.loadedAt === null)
      .map(part => part.id),
  }
}

function shipmentLabel(part: ShipmentPartRow): string {
  return part.shipmentNo ?? `货件-${part.partNumber}`
}

function blockingShipmentMessage(
  state: ShipmentDeliveryState,
  ids: readonly string[],
  action: string,
): string {
  const byId = new Map(state.parts.map(part => [part.id, part]))
  const labels = ids
    .slice(0, 5)
    .map(id => byId.get(id))
    .filter((part): part is ShipmentPartRow => part !== undefined)
    .map(shipmentLabel)
  const suffix = ids.length > labels.length ? ` 等 ${ids.length} 个` : ''
  return `${action}（${labels.join('、')}${suffix}）`
}

/**
 * 订单签收必须同步签收其下全部有效货件。
 * 调用方须已锁定销售订单；货件状态与订单签收在同一事务提交。
 */
export async function deliverAllShipmentsForOrderSign(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  context: ShipmentDeliveryContext,
  salesOrderId: string,
): Promise<number> {
  const state = await readSalesOrderShipmentDeliveryState(transaction, salesOrderId)
  if (state.pendingReviewPartIds.length > 0) {
    return salesOrderRuleFailure(
      'SALES_ORDER_SHIPMENTS_NOT_READY',
      '订单下仍有待审核货件，不能签收订单',
    )
  }
  if (state.unloadedActivePartIds.length > 0) {
    return salesOrderRuleFailure(
      'SALES_ORDER_SHIPMENTS_NOT_READY',
      blockingShipmentMessage(state, state.unloadedActivePartIds, '存在未装柜货件，不能签收订单'),
    )
  }
  if (state.undeliveredActivePartIds.length === 0) return 0

  const undelivered = state.parts.filter(part => (
    part.status === 'ACTIVE' && part.deliveredAt === null
  ))
  const recordedAt = new Date()
  const updated = await transaction.purchaseOrderPart.updateMany({
    where: {
      id: { in: undelivered.map(part => part.id) },
      status: 'ACTIVE',
      loadedAt: { not: null },
      deliveredAt: null,
    },
    data: {
      deliveredAt: recordedAt,
      deliveredById: context.actorUserId,
      deliveredRecordedAt: recordedAt,
    },
  })
  if (updated.count !== undelivered.length) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'SALES_ORDER_SHIPMENTS_CHANGED',
      '货件签收状态已变化，请刷新后重试',
    )
  }

  const byPurchaseOrder = new Map<string, string[]>()
  for (const part of undelivered) {
    const ids = byPurchaseOrder.get(part.purchaseOrderId) ?? []
    ids.push(part.id)
    byPurchaseOrder.set(part.purchaseOrderId, ids)
  }
  for (const [purchaseOrderId, partIds] of byPurchaseOrder) {
    await audit.record(transaction, {
      eventType: 'PURCHASE_SHIPMENT_DELIVERED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: context.actorUserId,
      requestId: context.requestId,
      targetType: 'PURCHASE_ORDER',
      targetId: purchaseOrderId,
      metadata: {
        salesOrderId,
        partIds: [...partIds].sort(),
        deliveredAt: recordedAt.toISOString(),
        recordedAt: recordedAt.toISOString(),
        source: 'SALES_ORDER_SIGN',
      },
    })
  }
  return updated.count
}

/**
 * 单个货件签收后，只有「全部有效货件已签收 + 已有有效签收单」才推进订单。
 * 调用方须已锁定销售订单；签收单缺失时货件签收保留，订单留在待签收等待补传。
 */
export async function autoSignSalesOrderWhenAllShipmentsDelivered(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  automaticState: SalesOrderAutomaticStateService,
  context: ShipmentDeliveryContext,
  salesOrderId: string,
  lastPartId: string,
): Promise<SalesOrderShipmentSignOutcome> {
  const order = await transaction.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { orderStatus: true, fulfillmentStatus: true },
  })
  if (order === null) {
    throw new ApiException(
      HttpStatus.NOT_FOUND,
      'SALES_ORDER_NOT_FOUND',
      '销售订单不存在',
    )
  }
  if (order.fulfillmentStatus === 'SIGNED') {
    return {
      salesOrderSigned: true,
      remainingShipmentCount: 0,
      salesOrderReceiptRequired: false,
    }
  }

  const state = await readSalesOrderShipmentDeliveryState(transaction, salesOrderId)
  if (
    order.orderStatus !== 'CONFIRMED'
    || order.fulfillmentStatus !== 'SEA_TRANSIT'
    || state.pendingReviewPartIds.length > 0
    || state.undeliveredActivePartIds.length > 0
  ) {
    return {
      salesOrderSigned: false,
      remainingShipmentCount: state.undeliveredActivePartIds.length,
      salesOrderReceiptRequired: false,
    }
  }

  const receiptCount = await transaction.salesOrderDocument.count({
    where: {
      salesOrderId,
      documentType: 'DELIVERY_RECEIPT',
      detachedAt: null,
    },
  })
  if (receiptCount === 0) {
    return {
      salesOrderSigned: false,
      remainingShipmentCount: 0,
      salesOrderReceiptRequired: true,
    }
  }

  assertSalesOrderFulfillmentTransition('SEA_TRANSIT', 'SIGNED', {
    hasActiveDeliveryReceipt: true,
  })
  await transaction.salesOrder.update({
    where: { id: salesOrderId },
    data: { fulfillmentStatus: 'SIGNED', version: { increment: 1 } },
  })
  await transaction.salesOrderStatusHistory.create({
    data: {
      salesOrderId,
      dimension: 'FULFILLMENT',
      fromStatus: 'SEA_TRANSIT',
      toStatus: 'SIGNED',
      reason: '全部有效货件已签收且存在有效签收单，系统自动确认签收',
      changedByUserId: context.actorUserId,
    },
  })
  await audit.record(transaction, {
    eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
    outcome: 'SUCCESS',
    actorType: 'USER',
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    targetType: 'SALES_ORDER',
    targetId: salesOrderId,
    metadata: {
      automatic: true,
      trigger: 'SHIPMENT_SIGNED',
      fromStatus: 'SEA_TRANSIT',
      toStatus: 'SIGNED',
      lastPartId,
    },
  })
  await automaticState.advanceWhenEligible(
    transaction,
    context,
    salesOrderId,
    'SHIPMENT_SIGNED',
  )
  return {
    salesOrderSigned: true,
    remainingShipmentCount: 0,
    salesOrderReceiptRequired: false,
  }
}
