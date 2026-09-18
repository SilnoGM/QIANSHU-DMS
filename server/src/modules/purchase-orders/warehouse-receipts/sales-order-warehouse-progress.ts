import type { Prisma } from '../../../generated/prisma/client'
import type { AuditService } from '../../audit/audit.service'
import { assertSalesOrderFulfillmentTransition } from '../../sales-orders/domain/sales-order-state-machine'
import { isSalesOrderPurchaseFullyCovered } from '../sales-order-purchase-coverage.service'

/**
 * 调用方须先按销售明细、关联采购单、销售主行、货件的顺序加锁。
 * 汇总读取本事务刚写入的入仓事实，销售状态、历史和审计随入仓一起提交或回滚。
 */
export async function advanceSalesOrderWhenAllShipmentsReceived(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  input: { salesOrderId: string, actorUserId: string, requestId: string },
): Promise<void> {
  const order = await transaction.salesOrder.findUnique({
    where: { id: input.salesOrderId },
    select: { orderStatus: true, fulfillmentStatus: true },
  })
  if (order?.orderStatus !== 'CONFIRMED' || order.fulfillmentStatus !== 'LAND_TRANSIT') return

  const salesLines = await transaction.salesOrderLine.findMany({
    where: { salesOrderId: input.salesOrderId, removedAt: null },
    select: { id: true, quantity: true },
  })
  const purchases = await transaction.purchaseOrder.findMany({
    where: { salesOrderId: input.salesOrderId, purchaseType: 'SALES_LINKED', orderStatus: { not: 'CANCELLED' } },
    select: {
      orderStatus: true,
      parts: { select: {
        status: true, shippedAt: true, warehouseReceivedAt: true,
        items: { select: { quantity: true, line: { select: { sourceSalesOrderLineId: true } } } },
      } },
    },
  })
  if (purchases.length === 0) return
  const receivedBySource = new Map<string, number>()
  for (const purchase of purchases) {
    if (!['CONFIRMED', 'COMPLETED'].includes(purchase.orderStatus)) return
    const active = purchase.parts.filter(part => part.status === 'ACTIVE')
    if (active.length === 0 || purchase.parts.some(part => part.status === 'PENDING_REVIEW')) return
    for (const part of active) {
      if (part.shippedAt === null || part.warehouseReceivedAt === null) return
      // 按销售明细分别累计实收数量；取消货件、其他明细的多余数量不能补足缺口。
      for (const item of part.items) {
        const sourceId = item.line.sourceSalesOrderLineId
        if (sourceId !== null) receivedBySource.set(sourceId, (receivedBySource.get(sourceId) ?? 0) + item.quantity)
      }
    }
  }
  if (!isSalesOrderPurchaseFullyCovered(salesLines, receivedBySource)) return

  assertSalesOrderFulfillmentTransition('LAND_TRANSIT', 'WAREHOUSE_ARRIVED', { hasActiveDeliveryReceipt: false })
  await transaction.salesOrder.update({
    where: { id: input.salesOrderId },
    data: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: { increment: 1 } },
  })
  await transaction.salesOrderStatusHistory.create({ data: {
    salesOrderId: input.salesOrderId, dimension: 'FULFILLMENT',
    fromStatus: 'LAND_TRANSIT', toStatus: 'WAREHOUSE_ARRIVED',
    reason: '全部有效关联采购货件已入仓，且入仓数量覆盖全部销售明细',
    changedByUserId: input.actorUserId,
  } })
  await audit.record(transaction, {
    eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED', outcome: 'SUCCESS',
    actorType: 'USER', actorUserId: input.actorUserId, requestId: input.requestId,
    targetType: 'SALES_ORDER', targetId: input.salesOrderId,
    metadata: { automatic: true, fromStatus: 'LAND_TRANSIT', toStatus: 'WAREHOUSE_ARRIVED', trigger: 'PURCHASE_WAREHOUSE_RECEIPT' },
  })
}
