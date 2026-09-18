import { createHash } from 'node:crypto'
import { normalizeDictionaryItemValue } from '../../dictionaries/dictionary.normalizer'
import { purchaseOrderValidationFailure } from '../domain/purchase-order-errors'
import type { PurchasePayableBatchPayDto } from './purchase-payable.dto'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest()
function record(value: unknown, allowed: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) return purchaseOrderValidationFailure(field)
  return value as Record<string, unknown>
}
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !uuid.test(value)) return purchaseOrderValidationFailure(field)
  return value
}
function version(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return purchaseOrderValidationFailure(field)
  return value
}
export function normalizeBatchSupplier(value: unknown): string {
  try { return normalizeDictionaryItemValue(value) }
  catch { return purchaseOrderValidationFailure('supplierValue') }
}
export function normalizeBatchPayment(input: unknown): PurchasePayableBatchPayDto {
  const body = record(input, ['supplierValue', 'recipientAccountId', 'recipientProfileVersion', 'paymentMethod', 'items'], 'body')
  if (!Array.isArray(body.items) || !body.items.length) return purchaseOrderValidationFailure('items')
  let paymentMethod: string
  try { paymentMethod = normalizeDictionaryItemValue(body.paymentMethod) }
  catch { return purchaseOrderValidationFailure('paymentMethod') }
  const items = body.items.map((raw, index) => {
    const item = record(raw, ['payableId', 'expectedVersion', 'voucher'], `items.${index}`)
    const voucher = record(item.voucher, ['mediaAssetId'], `items.${index}.voucher`)
    return { payableId: id(item.payableId, `items.${index}.payableId`), expectedVersion: version(item.expectedVersion, `items.${index}.expectedVersion`),
      voucher: { mediaAssetId: id(voucher.mediaAssetId, `items.${index}.voucher.mediaAssetId`) } }
  }).sort((a, b) => a.payableId.localeCompare(b.payableId))
  if (new Set(items.map(item => item.payableId)).size !== items.length || new Set(items.map(item => item.voucher.mediaAssetId)).size !== items.length) return purchaseOrderValidationFailure('items')
  return { supplierValue: normalizeBatchSupplier(body.supplierValue), recipientAccountId: id(body.recipientAccountId, 'recipientAccountId'),
    recipientProfileVersion: version(body.recipientProfileVersion, 'recipientProfileVersion'), paymentMethod, items }
}
export function batchPaymentIdentity(actorUserId: string, key: string, input: PurchasePayableBatchPayDto) {
  // 根身份不包含集合；同一个请求标识增删采购单时必须冲突，而不能变成另一笔付款。
  return { rootKeyHash: hash(['purchase-payables-batch', actorUserId, key]), fingerprint: hash(input) }
}
export function batchItemKey(actorUserId: string, key: string, payableId: string) {
  return hash(['purchase-payables-batch-item', actorUserId, key, payableId])
}
