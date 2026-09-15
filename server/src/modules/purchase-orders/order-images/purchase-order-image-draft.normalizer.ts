import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../../infrastructure/http/api.exception'
import { purchaseOrderValidationFailure } from '../domain/purchase-order-errors'
import { isCanonicalPurchaseOrderActorId } from '../purchase-order-command.normalizer'
import type { PurchaseOrderMutationContext } from '../purchase-order-mutation.service'

export function requirePurchaseOrderImageUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    return purchaseOrderValidationFailure(field, '必须是规范的小写 UUID v4')
  }
  return value
}

export function requirePurchaseOrderImageContext(context: PurchaseOrderMutationContext): void {
  if (!isCanonicalPurchaseOrderActorId(context.actorUserId) || typeof context.requestId !== 'string' || context.requestId.length < 1 || [...context.requestId].length > 64) {
    throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', '服务器内部错误')
  }
}

export function normalizePurchaseOrderImageDraftInput(input: unknown): { expectedVersion: number, regenerate: boolean } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return purchaseOrderValidationFailure('body')
  const body = input as Record<string, unknown>
  if (Object.keys(body).some(key => !['expectedVersion', 'regenerate'].includes(key))) return purchaseOrderValidationFailure('body')
  if (typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) return purchaseOrderValidationFailure('expectedVersion')
  if (body.regenerate !== undefined && typeof body.regenerate !== 'boolean') return purchaseOrderValidationFailure('regenerate')
  return { expectedVersion: body.expectedVersion, regenerate: body.regenerate === true }
}
