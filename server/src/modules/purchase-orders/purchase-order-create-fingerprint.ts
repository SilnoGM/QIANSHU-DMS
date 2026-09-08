import { createHash } from 'node:crypto'

import { purchaseOrderValidationFailure } from './domain/purchase-order-errors'
import {
  isCanonicalPurchaseOrderActorId,
  type NormalizedPurchaseOrderCreateCommand,
} from './purchase-order-command.normalizer'

export const PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION =
  'purchase-order.create.v5' as const
export const PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION = 'purchase-order.create.v3' as const
export const PURCHASE_ORDER_PART_ISSUED_FINGERPRINT_VERSION = 'purchase-order.create.v4' as const
export const PURCHASE_ORDER_NUMBERING_RULE_CODE = 'PURCHASE_ORDER' as const
export const PURCHASE_ORDER_NUMBERING_CONSUMER_CODE =
  'PURCHASE_ORDER.CREATE' as const

function serializePurchaseOrderCreateFingerprint(
  actorUserId: string,
  payload: NormalizedPurchaseOrderCreateCommand,
  version: string,
): string {
  // 逐字段构造稳定序列，避免对象 key 顺序或未来非业务字段影响幂等语义。
  return JSON.stringify({
    version,
    ruleCode: PURCHASE_ORDER_NUMBERING_RULE_CODE,
    consumerCode: PURCHASE_ORDER_NUMBERING_CONSUMER_CODE,
    actorUserId,
    payload: {
      purchaseType: payload.purchaseType,
      productMode: payload.productMode,
      salesOrderId: payload.salesOrderId,
      supplierValue: payload.supplierValue,
      customSupplierName: payload.customSupplierName,
      orderDate: payload.orderDate,
      currencyCode: payload.currencyCode,
      expectedShippingMarkResolution: payload.expectedShippingMarkResolution,
      ...(version === PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION ? {} : {
        parts: payload.parts.map(part => ({ key: part.key, items: part.items.map(item => ({
          lineNumber: item.lineNumber, quantity: item.quantity,
        })) })),
      }),
      lines: payload.lines.map(line => line.lineType === 'CATALOG'
        ? {
            lineNumber: line.lineNumber,
            lineType: line.lineType,
            productId: line.productId,
            sourceSalesOrderLineId: line.sourceSalesOrderLineId,
            actualPurchaseUnitPriceAmount: line.actualPurchaseUnitPriceAmount,
            quantity: line.quantity,
            lineTotalAmount: line.lineTotalAmount,
          }
        : {
            lineNumber: line.lineNumber,
            lineType: line.lineType,
            sourceSalesOrderLineId: line.sourceSalesOrderLineId,
            name: line.name ?? null,
            description: line.description ?? null,
            referencePurchaseUnitPriceAmount:
              line.referencePurchaseUnitPriceAmount,
            actualPurchaseUnitPriceAmount: line.actualPurchaseUnitPriceAmount,
            quantity: line.quantity,
            lineTotalAmount: line.lineTotalAmount,
          }),
      lineSubtotalAmount: payload.lineSubtotalAmount,
      purchaseTotalAmount: payload.purchaseTotalAmount,
      depositDueAmount: payload.depositDueAmount,
      balanceDueAmount: payload.balanceDueAmount,
      remark: payload.remark,
    },
  })
}

export function calculatePurchaseOrderCreateFingerprint(
  actorUserId: unknown,
  payload: NormalizedPurchaseOrderCreateCommand,
  version: string = PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION,
): string {
  if (!isCanonicalPurchaseOrderActorId(actorUserId)) {
    return purchaseOrderValidationFailure(
      'actorUserId',
      '必须是规范的小写 UUID v4',
    )
  }
  return createHash('sha256')
    .update(Buffer.from(
      serializePurchaseOrderCreateFingerprint(actorUserId, payload, version),
      'utf8',
    ))
    .digest('hex')
}

export function hashPurchaseOrderIdempotencyKey(key: string): Buffer {
  return createHash('sha256').update(Buffer.from(key, 'utf8')).digest()
}
