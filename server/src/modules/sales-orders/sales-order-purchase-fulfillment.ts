import { Prisma, type Prisma as PrismaTypes } from '../../generated/prisma/client'
import { salesOrderRuleFailure } from './domain/sales-order-errors'

/**
 * 手工履约入口与采购审核、取消、发货共享锁顺序：销售明细 -> 采购单 -> 销售主行。
 * 必须在调用方锁定销售主行之前执行，避免主行与采购依赖互相等待。
 */
export async function lockSalesOrderPurchaseDependencies(
  transaction: PrismaTypes.TransactionClient,
  salesOrderId: string,
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "sales_order_lines"
    WHERE "sales_order_id" = CAST(${salesOrderId} AS uuid)
      AND "removed_at" IS NULL
    ORDER BY "id" FOR UPDATE
  `)
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "purchase_orders"
    WHERE "sales_order_id" = CAST(${salesOrderId} AS uuid)
      AND "purchase_type" = CAST('SALES_LINKED' AS "purchase_order_type")
      AND "order_status" <> CAST('CANCELLED' AS "purchase_order_status")
    ORDER BY "id" FOR UPDATE
  `)
}

/** 调用方已持有依赖及销售主行锁；状态快照不能替代实际已审核数量和发货事实。 */
export async function assertSalesOrderPurchaseFulfillment(
  transaction: PrismaTypes.TransactionClient,
  salesOrderId: string,
  toStatus: 'PREPARING' | 'LAND_TRANSIT',
): Promise<void> {
  const salesLines = await transaction.salesOrderLine.findMany({
    where: { salesOrderId, removedAt: null },
    select: { id: true, quantity: true },
  })
  const purchases = await transaction.purchaseOrder.findMany({
    where: {
      purchaseType: 'SALES_LINKED',
      salesOrderId,
      orderStatus: { not: 'CANCELLED' },
    },
    select: {
      orderStatus: true,
      fulfillmentStatus: true,
      lines: {
        where: { sourceSalesOrderLineId: { in: salesLines.map(line => line.id) } },
        select: { sourceSalesOrderLineId: true, quantity: true },
      },
    },
  })
  const approvedBySource = new Map<string, number>()
  for (const purchase of purchases) {
    if (purchase.orderStatus !== 'CONFIRMED' && purchase.orderStatus !== 'COMPLETED') continue
    for (const line of purchase.lines) {
      if (line.sourceSalesOrderLineId === null) continue
      approvedBySource.set(line.sourceSalesOrderLineId,
        (approvedBySource.get(line.sourceSalesOrderLineId) ?? 0) + line.quantity)
    }
  }
  const fullyCovered = salesLines.length > 0 && salesLines.every(line => (
    (approvedBySource.get(line.id) ?? 0) >= line.quantity
  ))
  if (!fullyCovered) {
    return salesOrderRuleFailure(
      'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID',
      '已审核采购数量尚未覆盖全部销售产品',
    )
  }
  if (toStatus === 'LAND_TRANSIT' && !purchases.every(purchase => (
    (purchase.orderStatus === 'CONFIRMED' || purchase.orderStatus === 'COMPLETED')
    && (purchase.fulfillmentStatus === 'SHIPPED' || purchase.fulfillmentStatus === 'SIGNED')
  ))) {
    return salesOrderRuleFailure(
      'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID',
      '全部有效关联采购订单审核通过并发货后才能进入陆运',
    )
  }
}
