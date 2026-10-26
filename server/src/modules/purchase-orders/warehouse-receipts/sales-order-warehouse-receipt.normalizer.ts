import { isISO8601 } from 'class-validator'

import { purchaseOrderValidationFailure } from '../domain/purchase-order-errors'
import { requireFactoryShipmentUuid } from '../factory-shipments/purchase-order-factory-shipment.normalizer'
import { normalizeWarehouseRemark } from './purchase-order-warehouse-receipt.normalizer'

const MAX_TARGET_COUNT = 100
const MAX_PART_COUNT = 1000
const RECEIVED_AT_PATTERN
  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u

export interface SalesOrderWarehouseReceiptTarget {
  readonly purchaseOrderId: string
  readonly expectedVersion: number
  readonly partIds: readonly string[]
}

export interface SalesOrderWarehouseReceiptInput {
  readonly targets: readonly SalesOrderWarehouseReceiptTarget[]
  readonly receivedAt: string | null
  readonly remark: string | null
}

function requireRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return purchaseOrderValidationFailure(field)
  }
  return value as Readonly<Record<string, unknown>>
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  field: string,
): void {
  const allowed = new Set(allowedKeys)
  if (Object.keys(value).some(key => !allowed.has(key))) {
    return purchaseOrderValidationFailure(field)
  }
}

function requireExpectedVersion(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return purchaseOrderValidationFailure(field, '必须是大于等于 1 的安全整数')
  }
  return value as number
}

function requirePartIds(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PART_COUNT) {
    return purchaseOrderValidationFailure(field, `必须包含 1 至 ${MAX_PART_COUNT} 个货件`)
  }
  const ids = value.map((id, index) => requireFactoryShipmentUuid(id, `${field}.${index}`))
  if (new Set(ids).size !== ids.length) return purchaseOrderValidationFailure(field, '货件不得重复')
  // 与单采购单入口保持同一指纹口径：排序后再参与幂等判定和写入。
  return [...ids].sort()
}

/**
 * 销售级批量入仓按采购单分组提交。货件 ID 必须在整个请求内唯一，
 * 防止同一货件通过不同采购单绕过逐单校验。
 */
export function normalizeSalesOrderWarehouseReceiptRequest(
  input: unknown,
): SalesOrderWarehouseReceiptInput {
  const body = requireRecord(input, 'body')
  rejectUnknownKeys(body, ['targets', 'receivedAt', 'remark'], 'body')
  if (
    !Array.isArray(body.targets)
    || body.targets.length < 1
    || body.targets.length > MAX_TARGET_COUNT
  ) {
    return purchaseOrderValidationFailure('targets', `必须包含 1 至 ${MAX_TARGET_COUNT} 个目标`)
  }
  const targets = body.targets.map((value, index) => {
    const target = requireRecord(value, `targets.${index}`)
    rejectUnknownKeys(
      target,
      ['purchaseOrderId', 'expectedVersion', 'partIds'],
      `targets.${index}`,
    )
    return {
      partIds: requirePartIds(target.partIds, `targets.${index}.partIds`),
      purchaseOrderId: requireFactoryShipmentUuid(
        target.purchaseOrderId,
        `targets.${index}.purchaseOrderId`,
      ),
      expectedVersion: requireExpectedVersion(
        target.expectedVersion,
        `targets.${index}.expectedVersion`,
      ),
    }
  })
  if (new Set(targets.map(target => target.purchaseOrderId)).size !== targets.length) {
    return purchaseOrderValidationFailure('targets', '采购订单不得重复')
  }
  const partIds = targets.flatMap(target => target.partIds)
  if (new Set(partIds).size !== partIds.length) {
    return purchaseOrderValidationFailure('targets', '同一货件不得出现在多个采购单中')
  }
  if (partIds.length > MAX_PART_COUNT) {
    return purchaseOrderValidationFailure('targets', `一次最多确认 ${MAX_PART_COUNT} 个货件入仓`)
  }
  let receivedAt: string | null = null
  if (body.receivedAt !== undefined) {
    if (
      typeof body.receivedAt !== 'string'
      || !RECEIVED_AT_PATTERN.test(body.receivedAt)
      || !isISO8601(body.receivedAt, { strict: true, strictSeparator: true })
      || !Number.isFinite(Date.parse(body.receivedAt))
    ) {
      return purchaseOrderValidationFailure('receivedAt', '必须是带时区的有效 ISO 日期时间')
    }
    receivedAt = new Date(body.receivedAt).toISOString()
  }
  return { targets, receivedAt, remark: normalizeWarehouseRemark(body.remark) }
}
