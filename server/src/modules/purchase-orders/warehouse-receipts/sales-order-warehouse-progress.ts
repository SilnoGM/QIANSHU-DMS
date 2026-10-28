import type { Prisma } from '../../../generated/prisma/client'
import type { AuditService } from '../../audit/audit.service'
import { assertSalesOrderFulfillmentTransition } from '../../sales-orders/domain/sales-order-state-machine'
import { readSalesOrderShipmentFacts } from '../../sales-orders/sales-order-owned-shipments'

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

  // 货件集合按当前归属读取：释放后转池的货件不再推进原订单，认领货件参与新订单到仓。
  const facts = await readSalesOrderShipmentFacts(transaction, input.salesOrderId)
  if (!facts.allReceived || !facts.covered) return

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
