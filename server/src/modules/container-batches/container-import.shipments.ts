import { Prisma } from '../../generated/prisma/client'
import { resolvePurchaseShipmentViewStatus } from '../purchase-orders/shipments/purchase-shipment-view'
import { containerFailure } from './container-batch.normalizer'
import type { ContainerImportCandidateDto } from './container-import.dto'
import { containerShipmentEligibilitySelect, resolveContainerShipmentEligibility } from './container-shipment-eligibility'
import { extractContainerReferenceTokens, type ReferenceField } from './import-matching'

const shipmentSelect = {
  ...containerShipmentEligibilitySelect,
  id: true, shipmentNo: true, shippingMarkText: true, trackingNo: true, shippedAt: true,
  purchaseOrder: {
    select: { orderNo: true, purchaseType: true, salesOrder: { select: { orderNo: true, customerName: true } } },
  },
  items: { select: { line: { select: { productNameSnapshot: true } } } },
  containerLoadingItems: {
    select: {
      containerBatchId: true,
      containerBatch: { select: { id: true, containerBatchNo: true, containerBatchName: true } },
    },
  },
} satisfies Prisma.PurchaseOrderPartSelect
export type ImportShipment = Prisma.PurchaseOrderPartGetPayload<{ select: typeof shipmentSelect }>
export function shipmentEligibility(shipment: ImportShipment, batchId: string, warehouseValue: string) {
  return resolveContainerShipmentEligibility(shipment, batchId, warehouseValue)?.message ?? null
}
export function serializeImportCandidate(
  shipment: ImportShipment,
  batchId: string,
  warehouseValue: string,
  canSales: boolean,
  matchFields: readonly ReferenceField[],
): ContainerImportCandidateDto {
  const failure = resolveContainerShipmentEligibility(shipment, batchId, warehouseValue)
  return {
    id: shipment.id, shipmentNo: shipment.shipmentNo, shippingMarkText: shipment.shippingMarkText, trackingNo: shipment.trackingNo,
    warehouseValue: shipment.destinationWarehouseValue,
    goodsName: [...new Set(shipment.items.map(item => item.line.productNameSnapshot))].join(' + '),
    purchaseOrderNo: shipment.purchaseOrder.orderNo,
    salesOrderNo: canSales ? shipment.purchaseOrder.salesOrder?.orderNo ?? null : null,
    // 客户名按采购域口径返回：采购读者已经在采购单/货件列表见过同一字段，不再按 sales-orders:read 二次门控。
    customerName: shipment.purchaseOrder.salesOrder?.customerName ?? null,
    purchaseType: shipment.purchaseOrder.purchaseType,
    viewStatus: resolvePurchaseShipmentViewStatus(shipment),
    warehouseReceivedAt: shipment.warehouseReceivedAt?.toISOString() ?? null,
    // 同一货件只能落在一个柜次（数据库触发器保证），取首条即可；同柜多行时柜次相同。
    containerBatch: shipment.containerLoadingItems[0]?.containerBatch ?? null,
    matchFields: [...new Set(matchFields)],
    eligible: failure === null,
    ineligibleReason: failure?.message ?? null,
  }
}
export async function findImportCandidates(tx: Prisma.TransactionClient, references: (string | null)[]) {
  const tokens = [...new Set(references.flatMap(extractContainerReferenceTokens))]
  if (!tokens.length) return []
  // 精确标识条件分批查询，避免全表扫描/含糊 contains 匹配，也不截断候选而误报唯一命中。
  const found = new Map<string, ImportShipment>()
  for (let offset = 0; offset < tokens.length; offset += 1000) {
    const subset = tokens.slice(offset, offset + 1000)
    const rows = await tx.purchaseOrderPart.findMany({ where: { OR: [{ shipmentNo: { in: subset } }, { shippingMarkText: { in: subset } }, { trackingNo: { in: subset } }] }, select: shipmentSelect, orderBy: { id: 'asc' } })
    for (const row of rows) found.set(row.id, row)
  }
  return [...found.values()]
}
export async function lockImportShipments(tx: Prisma.TransactionClient, shipmentIds: string[], batchId: string, warehouseValue: string) {
  const ids = [...new Set(shipmentIds)].sort()
  // 同柜允许多个包装行关联同一货件；跨柜竞争统一按货件 ID 排序取锁，随后重查归属。
  if (!ids.length) return
  await tx.$queryRaw(Prisma.sql`SELECT id FROM purchase_order_parts WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`)
  const found = await tx.purchaseOrderPart.findMany({ where: { id: { in: ids } }, select: shipmentSelect })
  for (const id of ids) {
    const row = found.find(shipment => shipment.id === id)
    if (!row) return containerFailure('CONTAINER_SHIPMENT_UNAVAILABLE', '所选货件不存在、尚未生效或已取消')
    const failure = resolveContainerShipmentEligibility(row, batchId, warehouseValue)
    if (failure) return containerFailure(failure.code, failure.message, failure.status)
  }
}
