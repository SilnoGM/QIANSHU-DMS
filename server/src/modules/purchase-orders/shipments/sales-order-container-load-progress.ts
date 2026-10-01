import { Prisma } from '../../../generated/prisma/client'
import { AuditService } from '../../audit/audit.service'
import { assertSalesOrderFulfillmentTransition } from '../../sales-orders/domain/sales-order-state-machine'
import { isSalesOrderPurchaseFullyCovered } from '../sales-order-purchase-coverage.service'

/**
 * 关联即已装柜：货件装柜事实写入后，汇总推进其销售订单。
 * 只有当该销售订单的全部有效货件都已装柜、且入仓数量仍覆盖全部销售明细时才推进到海运在途；
 * 未推进的订单会随每次装柜重新评估（幂等，且历史数据可在下次装柜时补齐）。
 */

/** 本次装柜涉及的销售订单：只取销售关联采购下的货件，去重排序保证加锁顺序稳定。 */
export async function salesOrderIdsOfShipments(
  transaction: Prisma.TransactionClient,
  shipmentIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(shipmentIds)].sort()
  if (!ids.length) return []
  const rows = await transaction.purchaseOrderPart.findMany({
    where: { id: { in: ids } },
    select: { purchaseOrder: { select: { salesOrderId: true } } },
  })
  return [...new Set(rows.flatMap(row => row.purchaseOrder.salesOrderId === null ? [] : [row.purchaseOrder.salesOrderId]))].sort()
}

/**
 * 与入仓推进共用同一把锁序：销售明细 → 同来源有效采购单 → 销售主行，多个销售订单按 id 升序逐个加锁。
 * 必须在锁货件之前调用，避免与发货、入仓形成反向申请。
 */
export async function lockSalesOrderChains(transaction: Prisma.TransactionClient, salesOrderIds: readonly string[]): Promise<void> {
  for (const salesOrderId of [...new Set(salesOrderIds)].sort()) {
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM sales_order_lines WHERE sales_order_id = ${salesOrderId}::uuid AND removed_at IS NULL ORDER BY id FOR UPDATE`)
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_orders WHERE sales_order_id = ${salesOrderId}::uuid AND purchase_type = 'SALES_LINKED' AND order_status <> 'CANCELLED' ORDER BY id FOR UPDATE`)
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM sales_orders WHERE id = ${salesOrderId}::uuid FOR UPDATE`)
  }
}

export interface AdvanceSalesOrdersWhenLoadedInput {
  readonly actorUserId: string
  readonly containerBatchId: string
  readonly requestId: string
  readonly salesOrderIds: readonly string[]
}

/** 调用方须已按上锁序持有销售链条锁；判定与写入都基于持锁后重读的数据。 */
export async function advanceSalesOrdersWhenAllShipmentsLoaded(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  input: AdvanceSalesOrdersWhenLoadedInput,
): Promise<void> {
  for (const salesOrderId of [...new Set(input.salesOrderIds)].sort()) {
    const order = await transaction.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: { orderStatus: true, fulfillmentStatus: true },
    })
    if (order?.orderStatus !== 'CONFIRMED' || order.fulfillmentStatus !== 'WAREHOUSE_ARRIVED') continue

    const salesLines = await transaction.salesOrderLine.findMany({
      where: { salesOrderId, removedAt: null },
      select: { id: true, quantity: true },
    })
    const purchases = await transaction.purchaseOrder.findMany({
      where: { salesOrderId, purchaseType: 'SALES_LINKED', orderStatus: { not: 'CANCELLED' } },
      select: {
        orderStatus: true,
        parts: { select: {
          status: true, warehouseReceivedAt: true, loadedAt: true,
          items: { select: { quantity: true, line: { select: { sourceSalesOrderLineId: true } } } },
        } },
      },
    })
    if (purchases.length === 0) continue

    // 取消采购单不参与判断；与入仓同一口径，未生效采购单或待审核货件都不允许推进。
    let allLoaded = true
    const receivedBySource = new Map<string, number>()
    for (const purchase of purchases) {
      if (!['CONFIRMED', 'COMPLETED'].includes(purchase.orderStatus)) { allLoaded = false; break }
      const active = purchase.parts.filter(part => part.status === 'ACTIVE')
      if (active.length === 0 || purchase.parts.some(part => part.status === 'PENDING_REVIEW')) { allLoaded = false; break }
      for (const part of active) {
        // 装柜以到仓为前提，两侧事实都要求，历史回填数据也不会被误判。
        if (part.loadedAt === null || part.warehouseReceivedAt === null) { allLoaded = false; break }
        for (const item of part.items) {
          const sourceId = item.line.sourceSalesOrderLineId
          if (sourceId !== null) receivedBySource.set(sourceId, (receivedBySource.get(sourceId) ?? 0) + item.quantity)
        }
      }
      if (!allLoaded) break
    }
    // 装柜后销售明细可能被追加或改量，覆盖判断必须按持锁后的现状重新计算。
    if (!allLoaded || !isSalesOrderPurchaseFullyCovered(salesLines, receivedBySource)) continue

    assertSalesOrderFulfillmentTransition('WAREHOUSE_ARRIVED', 'SEA_TRANSIT', { hasActiveDeliveryReceipt: false })
    await transaction.salesOrder.update({
      where: { id: salesOrderId },
      data: { fulfillmentStatus: 'SEA_TRANSIT', version: { increment: 1 } },
    })
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId,
      dimension: 'FULFILLMENT',
      fromStatus: 'WAREHOUSE_ARRIVED',
      toStatus: 'SEA_TRANSIT',
      reason: '全部有效关联采购货件已装柜，且入仓数量覆盖全部销售明细',
      changedByUserId: input.actorUserId,
    } })
    await audit.record(transaction, {
      eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED', outcome: 'SUCCESS',
      actorType: 'USER', actorUserId: input.actorUserId, requestId: input.requestId,
      targetType: 'SALES_ORDER', targetId: salesOrderId,
      metadata: {
        automatic: true, fromStatus: 'WAREHOUSE_ARRIVED', toStatus: 'SEA_TRANSIT',
        trigger: 'CONTAINER_LOAD', containerBatchId: input.containerBatchId,
      },
    })
  }
}
