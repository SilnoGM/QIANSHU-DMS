import { isISO8601 } from 'class-validator'

import { purchaseOrderValidationFailure } from '../domain/purchase-order-errors'
import { requireFactoryShipmentUuid } from '../factory-shipments/purchase-order-factory-shipment.normalizer'

export interface WarehouseReceiptInput {
  readonly expectedVersion: number
  readonly partIds: readonly string[]
  readonly receivedAt: string | null
  readonly remark: string | null
}

export function normalizeWarehouseRemark(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return purchaseOrderValidationFailure('remark')
  const result = value.trim().normalize('NFKC')
  if ([...result].length > 500) return purchaseOrderValidationFailure('remark', '不得超过 500 个字符')
  return result || null
}

export function normalizeWarehouseReceiptRequest(value: unknown): WarehouseReceiptInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return purchaseOrderValidationFailure('body')
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !['expectedVersion', 'partIds', 'receivedAt', 'remark'].includes(key))) return purchaseOrderValidationFailure('body')
  if (typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) return purchaseOrderValidationFailure('expectedVersion')
  if (!Array.isArray(body.partIds) || body.partIds.length < 1 || body.partIds.length > 1000) return purchaseOrderValidationFailure('partIds')
  const partIds = body.partIds.map(id => requireFactoryShipmentUuid(id, 'partIds')).sort()
  if (new Set(partIds).size !== partIds.length) return purchaseOrderValidationFailure('partIds', '货件不得重复')
  let receivedAt: string | null = null
  if (body.receivedAt !== undefined) {
    if (typeof body.receivedAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u.test(body.receivedAt)
      || !isISO8601(body.receivedAt, { strict: true, strictSeparator: true })
      || !Number.isFinite(Date.parse(body.receivedAt))) return purchaseOrderValidationFailure('receivedAt', '必须是带时区的有效 ISO 日期时间')
    receivedAt = new Date(body.receivedAt).toISOString()
  }
  return { expectedVersion: body.expectedVersion, partIds, receivedAt, remark: normalizeWarehouseRemark(body.remark) }
}
