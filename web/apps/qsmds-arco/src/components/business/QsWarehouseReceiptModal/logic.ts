import type { PurchaseOrderDetailDto, PurchaseOrderWarehouseReceiptRequestDto } from '@/api/generated/types.gen'

export function eligibleWarehouseParts(detail: PurchaseOrderDetailDto, scopeIds?: readonly string[]) {
  if (detail.orderStatus !== 'CONFIRMED') {
    return []
  }
  return detail.parts.filter(part => part.status === 'ACTIVE' && part.shippedAt !== null && part.warehouseReceivedAt === null && (!scopeIds || scopeIds.includes(part.id)))
}

/** 保留毫秒，避免默认时间截断后早于刚刚发出的货件；订单时间使用浏览器本地时区输入。 */
export function formatWarehouseLocalTime(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

export function buildWarehouseReceiptRequest(input: {
  detail: PurchaseOrderDetailDto
  scopeIds?: readonly string[]
  selectedIds: readonly string[]
  receivedAtLocal: string
  remark: string
  now: Date
}): { valid: true, request: PurchaseOrderWarehouseReceiptRequestDto } | { valid: false, error: string } {
  const eligible = eligibleWarehouseParts(input.detail, input.scopeIds)
  const selected = eligible.filter(part => input.selectedIds.includes(part.id))
  if (selected.length === 0 || selected.length !== input.selectedIds.length) {
    return { valid: false, error: 'purchaseWarehouseReceipt.validation.selection' }
  }
  const local = input.receivedAtLocal
  const date = new Date(local)
  // 拒绝时区后缀、日期溢出和 DST 不存在的本地时间，不让 Date 自动纠正用户输入。
  const normalized = local.length === 16 ? `${local}:00.000` : local.length === 19 ? `${local}.000` : local.replace(/\.(\d{1,3})$/, (_, fraction: string) => `.${fraction.padEnd(3, '0')}`)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(local) || !Number.isFinite(date.getTime()) || formatWarehouseLocalTime(date) !== normalized) {
    return { valid: false, error: 'purchaseWarehouseReceipt.validation.time' }
  }
  if (date.getTime() > input.now.getTime() || selected.some(part => date.getTime() < Date.parse(part.shippedAt!))) {
    return { valid: false, error: 'purchaseWarehouseReceipt.validation.timeRange' }
  }
  const remark = input.remark.trim()
  if ([...remark].length > 500) {
    return { valid: false, error: 'purchaseWarehouseReceipt.validation.remark' }
  }
  return { valid: true, request: { expectedVersion: input.detail.version, partIds: [...input.selectedIds], receivedAt: date.toISOString(), ...(remark ? { remark } : {}) } }
}
