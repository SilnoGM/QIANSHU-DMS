import { createHash } from 'node:crypto'

import { normalizePurchaseOrderSnapshotAmount } from '../domain/purchase-order-decimal'
import type { PurchaseOrderDetail } from '../purchase-order-query.service'

export const PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION = '1'

export class PurchaseOrderImageError extends Error {
  constructor(readonly code: 'PURCHASE_ORDER_IMAGE_SNAPSHOT_INVALID' | 'PURCHASE_ORDER_IMAGE_TOO_LARGE' | 'PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE' | 'PURCHASE_ORDER_IMAGE_PRODUCT_IMAGE_UNAVAILABLE') {
    super(code)
    this.name = 'PurchaseOrderImageError'
  }
}

export interface PurchaseOrderImageSnapshot {
  readonly templateVersion: string
  readonly purchaseOrderId: string
  readonly orderNo: string
  readonly orderDate: string
  readonly currencyCode: string
  readonly supplierName: string
  readonly purchaserName: string
  readonly shippingMarkText: string
  readonly purchaseTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly remark: string | null
  readonly lines: readonly {
    readonly id: string
    readonly lineNumber: number
    readonly productNo: string | null
    readonly productName: string
    readonly attributes: readonly string[]
    readonly description: string | null
    readonly mainImageId: string | null
    readonly quantity: number
    readonly unitPrice: string
    readonly amount: string
  }[]
  readonly parts: readonly {
    readonly id: string
    readonly shipmentNo: string
    readonly partNumber: number
    readonly shippingMarkText: string
    readonly items: readonly { readonly purchaseOrderLineId: string, readonly quantity: number }[]
  }[]
}

type SnapshotInput = Pick<PurchaseOrderDetail, 'id' | 'orderNo' | 'orderDate' | 'currencyCode' | 'supplier' | 'createdBy' | 'shippingMarkText' | 'amounts' | 'remark' | 'lines' | 'lineSummary'> & {
  readonly parts: readonly Pick<PurchaseOrderDetail['parts'][number], 'id' | 'shipmentNo' | 'partNumber' | 'status' | 'shippingMarkText' | 'items'>[]
}

function invalid(): never {
  throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_SNAPSHOT_INVALID')
}
function requiredText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : invalid()
}
function optionalText(value: unknown): string | null {
  return value == null ? null : typeof value === 'string' ? value : invalid()
}
function positiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : invalid()
}
function amount(value: unknown): string {
  try { return normalizePurchaseOrderSnapshotAmount(value) }
  catch { return invalid() }
}
function attributes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return invalid()
  return value.map((item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return invalid()
    const attribute = item as Record<string, unknown>
    const title = optionalText(attribute.title) ?? optionalText(attribute.name) ?? ''
    const rawValue = attribute.value
    const text = typeof rawValue === 'string' || typeof rawValue === 'number'
      ? String(rawValue)
      : Array.isArray(rawValue) && rawValue.every(entry => typeof entry === 'string' || typeof entry === 'number')
        ? rawValue.join('、')
        : ''
    return title && text ? `${title}：${text}` : title || text
  }).filter(Boolean)
}

/** 只截取单据实际展示的业务快照；状态、付款流水和生成时间不进入摘要，关闭重开可以复用同一张图。 */
export function createPurchaseOrderImageSnapshot(detail: SnapshotInput): PurchaseOrderImageSnapshot {
  const images = new Map(detail.lineSummary.previews.map(line => [line.lineId, line.mainImage?.id ?? null]))
  const lines = detail.lines.map(line => ({
    id: requiredText(line.id), lineNumber: positiveInteger(line.lineNumber),
    productNo: optionalText(line.productNo), productName: requiredText(line.productName),
    attributes: attributes(line.productAttributes), description: optionalText(line.description),
    mainImageId: images.get(requiredText(line.id)) ?? null,
    quantity: positiveInteger(line.quantity), unitPrice: amount(line.actualPurchaseUnitPriceAmount), amount: amount(line.lineTotalAmount),
  })).sort((a, b) => a.lineNumber - b.lineNumber || a.id.localeCompare(b.id))
  const lineIds = new Set(lines.map(line => line.id))
  if (lines.length === 0 || lineIds.size !== lines.length) return invalid()
  const parts = detail.parts.filter(part => part.status !== 'CANCELLED').map(part => ({
    id: requiredText(part.id), shipmentNo: requiredText(part.shipmentNo),
    partNumber: positiveInteger(part.partNumber), shippingMarkText: requiredText(part.shippingMarkText),
    items: part.items.map(item => {
      if (!lineIds.has(item.purchaseOrderLineId)) return invalid()
      return { purchaseOrderLineId: item.purchaseOrderLineId, quantity: positiveInteger(item.quantity) }
    }).sort((a, b) => a.purchaseOrderLineId.localeCompare(b.purchaseOrderLineId)),
  })).sort((a, b) => a.partNumber - b.partNumber || a.id.localeCompare(b.id))
  if (parts.length === 0 || parts.some(part => part.items.length === 0)) return invalid()
  return {
    templateVersion: PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION,
    purchaseOrderId: requiredText(detail.id), orderNo: requiredText(detail.orderNo), orderDate: requiredText(detail.orderDate),
    currencyCode: requiredText(detail.currencyCode), supplierName: requiredText(detail.supplier.label), purchaserName: requiredText(detail.createdBy.displayName),
    shippingMarkText: requiredText(detail.shippingMarkText), purchaseTotalAmount: amount(detail.amounts.purchaseTotalAmount),
    depositDueAmount: amount(detail.amounts.depositDueAmount), balanceDueAmount: amount(detail.amounts.balanceDueAmount), remark: optionalText(detail.remark), lines, parts,
  }
}

export function hashPurchaseOrderImageSnapshot(snapshot: PurchaseOrderImageSnapshot): string {
  // PostgreSQL jsonb 会重排对象键；摘要不应因存取顺序改变而失效。
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    }
    return value
  }
  return createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex')
}
