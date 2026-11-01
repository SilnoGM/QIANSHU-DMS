import type { Prisma as PrismaTypes } from '../../generated/prisma/client'
import {
  mergeClaimedCoverage,
  readClaimedQuantitiesBySalesLine,
} from './sales-order-claim-coverage'

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

export interface SalesOrderShipmentFacts {
  /** 当前归属货件的已发货、已到仓、已装柜事实是否全部成立。 */
  readonly allShipped: boolean
  readonly allReceived: boolean
  readonly allLoaded: boolean
  /** 归属货件的实收数量与认领数量是否覆盖全部销售明细。 */
  readonly covered: boolean
}

/**
 * 装柜、到仓、签收与认领推进共用的事实口径。
 * 货件集合按当前归属读取；覆盖数量来自本单持有货件的条目数量加认领数量，
 * 不能再用采购行数量，否则已释放货件仍会为原单“充数”。
 */
export async function readSalesOrderShipmentFacts(
  transaction: PrismaTypes.TransactionClient,
  salesOrderId: string,
): Promise<SalesOrderShipmentFacts> {
  const salesLines = await transaction.salesOrderLine.findMany({
    where: { salesOrderId, removedAt: null },
    select: { id: true, quantity: true },
  })
  const parts = await readSalesOrderShipmentParts(transaction, salesOrderId)
  if (parts.length === 0 || salesLines.length === 0) {
    return { allLoaded: false, allReceived: false, allShipped: false, covered: false }
  }

  let allShipped = true
  let allReceived = true
  let allLoaded = true
  const receivedBySource = new Map<string, number>()
  for (const part of parts) {
    if (part.status !== 'ACTIVE') {
      allShipped = false
      allReceived = false
      allLoaded = false
      break
    }
    if (part.shippedAt === null) {
      allShipped = false
      allReceived = false
      allLoaded = false
      break
    }
    if (part.warehouseReceivedAt === null) {
      allReceived = false
      allLoaded = false
      break
    }
    if (part.loadedAt === null) allLoaded = false
    for (const item of part.items) {
      const sourceId = item.line.sourceSalesOrderLineId
      if (sourceId !== null) receivedBySource.set(sourceId, (receivedBySource.get(sourceId) ?? 0) + item.quantity)
    }
  }
  const claimedBySalesLine = await readClaimedQuantitiesBySalesLine(
    transaction,
    salesOrderId,
    salesLines.map(line => line.id),
  )
  const coverage = mergeClaimedCoverage(receivedBySource, claimedBySalesLine)
  return {
    allLoaded,
    allReceived,
    allShipped,
    covered: salesLines.every(line => (coverage.get(line.id) ?? 0) >= line.quantity),
  }
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
