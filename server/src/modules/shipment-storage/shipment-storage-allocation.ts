import type { Prisma } from '../../generated/prisma/client'

export interface ShipmentStorageAllocationSnapshot {
  readonly lineId: string
  readonly lineNumber: number | null
  readonly productName: string | null
  readonly quantity: number
}

/**
 * origin_allocations 是 JSONB 快照，历史数据可能缺字段或被人工修正。
 * 读取时只接受能定位采购行的记录，其余字段保留空值，由调用方回退到当前行数据。
 */
export function readShipmentStorageAllocations(
  value: Prisma.JsonValue,
): readonly ShipmentStorageAllocationSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    if (typeof record.purchaseOrderLineId !== 'string') return []
    return [{
      lineId: record.purchaseOrderLineId,
      lineNumber: typeof record.lineNumber === 'number' ? record.lineNumber : null,
      productName: typeof record.productName === 'string' ? record.productName : null,
      quantity: typeof record.quantity === 'number' ? record.quantity : 0,
    }]
  })
}
