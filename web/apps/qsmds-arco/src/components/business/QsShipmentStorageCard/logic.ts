import type { ShipmentStorageListItemDto, ShipmentStorageProductPreviewDto } from '@/api/generated/types.gen'

export interface ShipmentStorageCardProductSummary {
  product: ShipmentStorageProductPreviewDto | null
  totalCount: number
  extraCount: number
}

/** 卡片只展示第一个产品，其余数量交给详情。 */
export function resolveStorageCardProducts(
  summary: Pick<ShipmentStorageListItemDto['lineSummary'], 'previews'>,
): ShipmentStorageCardProductSummary {
  const product = summary.previews[0] ?? null
  return {
    product,
    totalCount: summary.previews.length,
    extraCount: Math.max(0, summary.previews.length - 1),
  }
}

export interface ShipmentStorageCardMarkSummary {
  visibleText: string
  fullText: string
  hiddenCount: number
}

/** 装柜唛头按调用方传入的可容纳数量截取；复制和悬停仍使用完整内容。 */
export function resolveStorageCardMarks(
  marks: readonly string[],
  limit = Number.POSITIVE_INFINITY,
): ShipmentStorageCardMarkSummary {
  const normalized = marks.map(mark => mark.trim()).filter(Boolean)
  const visible = normalized.slice(0, Math.max(0, limit))
  return {
    visibleText: visible.join('、') || '—',
    fullText: normalized.join('、') || '—',
    hiddenCount: Math.max(0, normalized.length - visible.length),
  }
}

export interface ShipmentStorageCardLocation {
  scope: string
  scopeClass: string
  warehouse: string
}

export function resolveStorageCardLocation(
  record: Pick<ShipmentStorageListItemDto, 'locationScope' | 'warehouseLabel' | 'warehouseValue'>,
): ShipmentStorageCardLocation {
  return {
    scope: record.locationScope === 'MAINLAND' ? '内地' : '海外',
    scopeClass: record.locationScope === 'MAINLAND'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
      : 'border-sky-500/30 bg-sky-500/10 text-sky-700',
    warehouse: record.warehouseLabel ?? record.warehouseValue,
  }
}
