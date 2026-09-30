import { Prisma, type ContainerBatch, type ContainerLoadingItem } from '../../generated/prisma/client'
import { formatDecimal, parseDecimal } from '../ocean-freight-calculation/ocean-decimal'
import { VOLUME_CAI_SCALE, volumeDifferenceAtRecordScale } from '../ocean-freight-calculation/ocean-freight-calculation'
import type { ContainerBatchDto, ContainerLoadingItemDto } from './container-batch.dto'

export const containerSummaryInclude = { items: { select: { shipmentId: true, packageCount: true, grossWeightKg: true, volumeCai: true, chargeableVolumeCai: true } } } satisfies Prisma.ContainerBatchInclude
type SummaryItem = Pick<ContainerLoadingItem, 'shipmentId' | 'packageCount' | 'grossWeightKg' | 'volumeCai' | 'chargeableVolumeCai'>
interface ItemReferences {
  shipment?: { shipmentNo: string | null, shippingMarkText: string | null, purchaseOrder: { id: string, orderNo: string, salesOrder?: { id: string, orderNo: string } | null } } | null
}
function summarize(items: SummaryItem[]) {
  // 合计保留全部十进制位，且任一行缺值时不能伪装为完整合计。汇总只展示，不写回单行存储量程。
  const total = (field: 'grossWeightKg' | 'volumeCai', scale: number) => {
    if (items.some(item => item[field] == null)) return null
    const sum = items.reduce((value, item) => value + BigInt(item[field]!.toFixed(scale).replace('.', '')), 0n)
    const text = sum.toString().padStart(scale + 1, '0')
    return `${text.slice(0, -scale)}.${text.slice(-scale)}`
  }
  return { itemCount: items.length, shipmentCount: new Set(items.flatMap(item => item.shipmentId ? [item.shipmentId] : [])).size, packageCountTotal: items.reduce((sum, item) => sum + item.packageCount, 0), grossWeightKgTotal: total('grossWeightKg', 3), volumeCaiTotal: total('volumeCai', 8), chargeableVolumeCaiTotal: items.some(item => item.chargeableVolumeCai == null) ? null : items.reduce((sum, item) => sum + item.chargeableVolumeCai!, 0) }
}
export function serializeContainerBatch(row: ContainerBatch & { items?: SummaryItem[] }): ContainerBatchDto {
  return { ...summarize(row.items ?? []), createdById: row.createdById, id: row.id, containerBatchNo: row.containerBatchNo, containerBatchName: row.containerBatchName, loadingDate: row.loadingDate.toISOString().slice(0, 10), sequenceInDay: row.sequenceInDay, warehouseValue: row.warehouseValue, sourceFileId: row.sourceFileId, remark: row.remark, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}
export function serializeContainerItem(row: ContainerLoadingItem & ItemReferences, canPurchase = false, canSales = false): ContainerLoadingItemDto {
  return {
    shipmentNo: canPurchase ? row.shipment?.shipmentNo ?? null : null, shippingMark: canPurchase ? row.shipment?.shippingMarkText ?? null : null,
    purchaseOrderId: canPurchase ? row.shipment?.purchaseOrder.id ?? null : null, purchaseOrderNo: canPurchase ? row.shipment?.purchaseOrder.orderNo ?? null : null,
    salesOrderId: canPurchase && canSales ? row.shipment?.purchaseOrder.salesOrder?.id ?? null : null, salesOrderNo: canPurchase && canSales ? row.shipment?.purchaseOrder.salesOrder?.orderNo ?? null : null,
    recipientName: row.recipientName ?? null, recipientPhone: row.recipientPhone ?? null, recipientAddress: row.recipientAddress ?? null, codAmountTwd: row.codAmountTwd?.toFixed(2) ?? null,
    id: row.id, containerBatchId: row.containerBatchId, shipmentId: row.shipmentId, lineNumber: row.lineNumber, oceanShippingMarkText: row.oceanShippingMarkText, warehouseReceiptReference: row.warehouseReceiptReference, goodsName: row.goodsName, packageCount: row.packageCount, packageUnit: row.packageUnit, remark: row.remark, version: row.version,
    grossWeightKg: row.grossWeightKg?.toFixed(3) ?? null,
    lengthCm: row.lengthCm?.toFixed(2) ?? null, widthCm: row.widthCm?.toFixed(2) ?? null, heightCm: row.heightCm?.toFixed(2) ?? null,
    volumeCai: row.volumeCai?.toFixed(8) ?? null, chargeableVolumeCai: row.chargeableVolumeCai,
    reportedVolumeCai: row.reportedVolumeCai?.toFixed(8) ?? null,
    // 差异也按定点数相减，避免 Decimal 默认有效位数截掉大来源值的小数位。
    volumeDifferenceCai: row.volumeCai == null || row.reportedVolumeCai == null ? null : formatDecimal(
      volumeDifferenceAtRecordScale(
        parseDecimal(row.volumeCai.toFixed(8), 24, 8, 'volumeCai'),
        parseDecimal(row.reportedVolumeCai.toFixed(8), 24, 8, 'reportedVolumeCai'),
      ), 24, VOLUME_CAI_SCALE, 'volumeDifferenceCai'),
  }
}
