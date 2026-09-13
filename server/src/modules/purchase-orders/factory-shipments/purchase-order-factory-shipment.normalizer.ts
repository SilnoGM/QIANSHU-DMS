import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../../infrastructure/http/api.exception'
import { purchaseOrderValidationFailure } from '../domain/purchase-order-errors'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MAX_TARGET_COUNT = 100

export type FactoryShipmentMode = 'SELECTED' | 'ALL_PENDING'

export interface FactoryShipmentTarget {
  readonly purchaseOrderId: string
  readonly partIds: readonly string[]
  readonly expectedVersion: number
}

export interface PurchaseOrderFactoryShipmentInput {
  readonly partIds: readonly string[]
  readonly expectedVersion: number
  readonly reason: string | null
}

export interface SalesOrderFactoryShipmentInput {
  readonly mode: FactoryShipmentMode
  readonly targets: readonly FactoryShipmentTarget[]
  readonly reason: string | null
}

export interface FactoryShipmentMutationContext {
  readonly actorUserId: string
  readonly requestId: string
}

function requireRecord(
  value: unknown,
  field = 'body',
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return purchaseOrderValidationFailure(field)
  }
  return value as Readonly<Record<string, unknown>>
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  field = 'body',
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
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) {
    return purchaseOrderValidationFailure(field, '必须包含 1 至 1000 个货件')
  }
  const ids = value.map((id, index) => requireFactoryShipmentUuid(id, `${field}.${index}`))
  if (new Set(ids).size !== ids.length) return purchaseOrderValidationFailure(field, '货件不得重复')
  return ids
}

function normalizeReason(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return purchaseOrderValidationFailure('reason')
  const normalized = value.trim().normalize('NFKC')
  if (normalized.length === 0) return null
  if ([...normalized].length > 500) {
    return purchaseOrderValidationFailure('reason', '不得超过 500 个字符')
  }
  return normalized
}

export function requireFactoryShipmentUuid(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return purchaseOrderValidationFailure(field, '必须是规范的小写 UUID v4')
  }
  return value
}

export function normalizeFactoryShipmentContext(
  context: FactoryShipmentMutationContext,
): FactoryShipmentMutationContext {
  if (
    !UUID_V4_PATTERN.test(context.actorUserId)
    || typeof context.requestId !== 'string'
    || context.requestId.length < 1
    || [...context.requestId].length > 64
  ) {
    throw new ApiException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      '服务器内部错误',
    )
  }
  return context
}

export function normalizePurchaseOrderFactoryShipmentRequest(
  input: unknown,
): PurchaseOrderFactoryShipmentInput {
  const body = requireRecord(input)
  rejectUnknownKeys(body, ['expectedVersion', 'partIds', 'reason'])
  return {
    partIds: requirePartIds(body.partIds, 'partIds'),
    expectedVersion: requireExpectedVersion(body.expectedVersion, 'expectedVersion'),
    reason: normalizeReason(body.reason),
  }
}

export function normalizeSalesOrderFactoryShipmentRequest(
  input: unknown,
): SalesOrderFactoryShipmentInput {
  const body = requireRecord(input)
  rejectUnknownKeys(body, ['mode', 'targets', 'reason'])
  if (body.mode !== 'SELECTED' && body.mode !== 'ALL_PENDING') {
    return purchaseOrderValidationFailure('mode')
  }
  if (
    !Array.isArray(body.targets)
    || body.targets.length < 1
    || body.targets.length > MAX_TARGET_COUNT
  ) {
    return purchaseOrderValidationFailure(
      'targets',
      `必须包含 1 至 ${MAX_TARGET_COUNT} 个目标`,
    )
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
  return { mode: body.mode, targets, reason: normalizeReason(body.reason) }
}
