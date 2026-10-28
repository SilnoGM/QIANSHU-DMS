import type { Prisma as PrismaTypes } from '../../generated/prisma/client'

/**
 * 销售单当前实际拥有的货件以归属投影为准，而不是创建时的采购单来源。
 * 释放后归属转池、认领后归属转新单，都必须让装柜/到仓/签收聚合跟随当前归属，
 * 否则被释放的货件会继续推进原订单，认领货件则永远看不见。
 */
function ownershipWhere(salesOrderId: string) {
  return {
    ownershipCurrent: {
      ownerType: 'SALES_ORDER' as const,
      ownerSalesOrderId: salesOrderId,
      state: 'ACTIVE' as const,
    },
  }
}

const SHIPMENT_PROGRESS_SELECT = {
  id: true,
  status: true,
  loadedAt: true,
  shippedAt: true,
  warehouseReceivedAt: true,
  items: {
    select: {
      quantity: true,
      line: { select: { sourceSalesOrderLineId: true } },
    },
  },
} as const satisfies PrismaTypes.PurchaseOrderPartSelect

const SHIPMENT_DELIVERY_SELECT = {
  id: true,
  purchaseOrderId: true,
  shipmentNo: true,
  partNumber: true,
  status: true,
  loadedAt: true,
  deliveredAt: true,
} as const satisfies PrismaTypes.PurchaseOrderPartSelect

export type OwnedShipmentPart = PrismaTypes.PurchaseOrderPartGetPayload<{
  select: typeof SHIPMENT_PROGRESS_SELECT
}>

export type OwnedShipmentDeliveryPart = PrismaTypes.PurchaseOrderPartGetPayload<{
  select: typeof SHIPMENT_DELIVERY_SELECT
}>

/**
 * 装柜与到仓聚合用的货件集合。不读取签收列，签收迁移回放期间也能安全执行。
 * 返回集合包含归属仍为 ACTIVE 的待审核货件，调用方按状态决定是否阻断。
 */
export async function readSalesOrderShipmentParts(
  transaction: PrismaTypes.TransactionClient,
  salesOrderId: string,
): Promise<readonly OwnedShipmentPart[]> {
  return transaction.purchaseOrderPart.findMany({
    where: ownershipWhere(salesOrderId),
    select: SHIPMENT_PROGRESS_SELECT,
    orderBy: [{ id: 'asc' }],
  })
}

/** 订单签收聚合用的货件集合；需要签收事实与来源采购单标识。 */
export async function readSalesOrderShipmentDeliveryParts(
  transaction: PrismaTypes.TransactionClient,
  salesOrderId: string,
): Promise<readonly OwnedShipmentDeliveryPart[]> {
  return transaction.purchaseOrderPart.findMany({
    where: ownershipWhere(salesOrderId),
    select: SHIPMENT_DELIVERY_SELECT,
    orderBy: [{ purchaseOrderId: 'asc' }, { partNumber: 'asc' }, { id: 'asc' }],
  })
}
