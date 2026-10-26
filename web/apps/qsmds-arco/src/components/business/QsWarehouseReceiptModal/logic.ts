import type { PurchaseOrderDetailDto, PurchaseOrderWarehouseReceiptRequestDto } from '@/api/generated/types.gen'

const CANONICAL_UTC_ISO_PATTERN
  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u

export function eligibleWarehouseParts(detail: PurchaseOrderDetailDto, scopeIds?: readonly string[]) {
  if (detail.orderStatus !== 'CONFIRMED') {
    return []
  }
  return detail.parts.filter(part => part.status === 'ACTIVE' && part.shippedAt !== null && part.warehouseReceivedAt === null && (!scopeIds || scopeIds.includes(part.id)))
}

export function buildWarehouseReceiptRequest(input: {
  detail: PurchaseOrderDetailDto
  scopeIds?: readonly string[]
  selectedIds: readonly string[]
  receivedAt: string
  remark: string
  now: Date
}): { valid: true, request: PurchaseOrderWarehouseReceiptRequestDto } | { valid: false, error: string } {
  const eligible = eligibleWarehouseParts(input.detail, input.scopeIds)
  const selected = eligible.filter(part => input.selectedIds.includes(part.id))
  if (selected.length === 0 || selected.length !== input.selectedIds.length) {
    return { valid: false, error: 'purchaseWarehouseReceipt.validation.selection' }
  }
  const date = new Date(input.receivedAt)
  // 字段组件只输出 canonical UTC ISO；这里再拦截无时区、非法日历值和手工构造的值。
  if (
    !CANONICAL_UTC_ISO_PATTERN.test(input.receivedAt)
    || !Number.isFinite(date.getTime())
    || date.toISOString() !== input.receivedAt
  ) {
    return { valid: false, error: 'purchaseWarehouseReceipt.validation.time' }
  }
  if (date.getTime() > input.now.getTime() || selected.some(part => date.getTime() < Date.parse(part.shippedAt!))) {
    return { valid: false, error: 'purchaseWarehouseReceipt.validation.timeRange' }
  }
  const remark = input.remark.trim()
  if ([...remark].length > 500) {
    return { valid: false, error: 'purchaseWarehouseReceipt.validation.remark' }
  }
  return { valid: true, request: { expectedVersion: input.detail.version, partIds: [...input.selectedIds], receivedAt: input.receivedAt, ...(remark ? { remark } : {}) } }
}
