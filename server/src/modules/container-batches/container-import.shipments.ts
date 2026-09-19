import { Prisma } from '../../generated/prisma/client'
import { containerFailure } from './container-batch.normalizer'
import type { ContainerImportCandidateDto } from './container-import.dto'
import { extractContainerReferenceTokens } from './import-matching'

const shipmentSelect = {
  id: true, shipmentNo: true, shippingMarkText: true, trackingNo: true, destinationWarehouseValue: true, status: true,
  purchaseOrder: { select: { orderNo: true, salesOrder: { select: { orderNo: true } } } },
  items: { select: { line: { select: { productNameSnapshot: true } } } },
  containerLoadingItems: { select: { containerBatchId: true } },
} satisfies Prisma.PurchaseOrderPartSelect
export type ImportShipment = Prisma.PurchaseOrderPartGetPayload<{ select: typeof shipmentSelect }>
export function shipmentEligibility(shipment: ImportShipment, batchId: string, warehouseValue: string) {
  if (shipment.status !== 'ACTIVE') return '货件尚未生效或已取消'
  if (shipment.destinationWarehouseValue !== warehouseValue) return '货件目的地仓库与柜次装柜仓库不一致'
  if (shipment.containerLoadingItems.some(item => item.containerBatchId !== batchId)) return '货件已分配到其他柜次，不能跨柜拆分'
  return null
}
export function serializeImportCandidate(shipment: ImportShipment, batchId: string, warehouseValue: string, canSales: boolean): ContainerImportCandidateDto {
  const ineligibleReason = shipmentEligibility(shipment, batchId, warehouseValue)
  return { id: shipment.id, shipmentNo: shipment.shipmentNo, shippingMarkText: shipment.shippingMarkText, trackingNo: shipment.trackingNo,
    warehouseValue: shipment.destinationWarehouseValue, goodsName: [...new Set(shipment.items.map(item => item.line.productNameSnapshot))].join(' + '),
    purchaseOrderNo: shipment.purchaseOrder.orderNo, salesOrderNo: canSales ? shipment.purchaseOrder.salesOrder?.orderNo ?? null : null,
    eligible: ineligibleReason === null, ineligibleReason }
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
    if (!row || row.status !== 'ACTIVE') return containerFailure('CONTAINER_SHIPMENT_UNAVAILABLE', '所选货件不存在、尚未生效或已取消')
    if (row.destinationWarehouseValue !== warehouseValue) return containerFailure('CONTAINER_SHIPMENT_WAREHOUSE_MISMATCH', '所选货件目的地仓库与柜次仓库不一致')
    if (row.containerLoadingItems.some(item => item.containerBatchId !== batchId)) return containerFailure('CONTAINER_SHIPMENT_ALREADY_ASSIGNED', '所选货件已分配到其他柜次，不能跨柜拆分', 409)
  }
}
