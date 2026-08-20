import { createHash } from 'node:crypto'

import {
  salesOrderValidationFailure,
} from './domain/sales-order-errors'
import {
  isCanonicalSalesOrderActorId,
  type NormalizedSalesOrderCreateCommand,
} from './sales-order-command.normalizer'

export const SALES_ORDER_CREATE_FINGERPRINT_VERSION =
  'sales-order.create.v1' as const
export const SALES_ORDER_NUMBERING_RULE_CODE = 'SALES_ORDER' as const
export const SALES_ORDER_NUMBERING_CONSUMER_CODE = 'SALES_ORDER.CREATE' as const

function serializeSalesOrderCreateFingerprint(
  actorUserId: string,
  payload: NormalizedSalesOrderCreateCommand,
): string {
  // 逐字段重建可审计序列，不依赖调用方对象 key 顺序或 locale 排序。
  return JSON.stringify({
    version: SALES_ORDER_CREATE_FINGERPRINT_VERSION,
    ruleCode: SALES_ORDER_NUMBERING_RULE_CODE,
    consumerCode: SALES_ORDER_NUMBERING_CONSUMER_CODE,
    actorUserId,
    payload: {
      orderDate: payload.orderDate,
      currencyCode: payload.currencyCode,
      customer: {
        name: payload.customer.name,
        phone: payload.customer.phone,
        countryRegionId: payload.customer.countryRegionId,
        provinceStateId: payload.customer.provinceStateId,
        cityId: payload.customer.cityId,
        addressDetail: payload.customer.addressDetail,
      },
      lines: payload.lines.map(line => line.lineType === 'CATALOG'
        ? {
            lineNumber: line.lineNumber,
            lineType: line.lineType,
            productId: line.productId,
            actualUnitPriceAmount: line.actualUnitPriceAmount,
            quantity: line.quantity,
            lineTotalAmount: line.lineTotalAmount,
          }
        : {
            lineNumber: line.lineNumber,
            lineType: line.lineType,
            name: line.name,
            description: line.description,
            actualUnitPriceAmount: line.actualUnitPriceAmount,
            quantity: line.quantity,
            lineTotalAmount: line.lineTotalAmount,
          }),
      lineSubtotalAmount: payload.lineSubtotalAmount,
      agreedTotalAmount: payload.agreedTotalAmount,
      depositDueAmount: payload.depositDueAmount,
      balanceDueAmount: payload.balanceDueAmount,
      documents: payload.documents.map(document => ({
        mediaAssetId: document.mediaAssetId,
        documentType: document.documentType,
        title: document.title,
        remark: document.remark,
      })),
      remark: payload.remark,
    },
  })
}

export function calculateSalesOrderCreateFingerprint(
  actorUserId: unknown,
  payload: NormalizedSalesOrderCreateCommand,
): string {
  if (!isCanonicalSalesOrderActorId(actorUserId)) {
    return salesOrderValidationFailure(
      'actorUserId',
      '必须是规范的小写 UUID v4',
    )
  }
  return createHash('sha256')
    .update(Buffer.from(
      serializeSalesOrderCreateFingerprint(actorUserId, payload),
      'utf8',
    ))
    .digest('hex')
}

export function hashSalesOrderIdempotencyKey(key: string): Buffer {
  return createHash('sha256').update(Buffer.from(key, 'utf8')).digest()
}
