import { createHash } from 'node:crypto'

import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import {
  isCanonicalProductActorId,
  type NormalizedProductCreateCommand,
} from './product-command.normalizer'

export const PRODUCT_CREATE_FINGERPRINT_VERSION = 'product.create.v2' as const
export const PRODUCT_NUMBERING_RULE_CODE = 'PRODUCT' as const
export const PRODUCT_NUMBERING_CONSUMER_CODE = 'PRODUCT.CREATE' as const

/**
 * serializer 逐字段重建对象，绝不依赖调用方 key 顺序、locale 排序，也不把仅供
 * minorUnit 校验的 inputFractionDigits 纳入等价业务 Payload。
 */
function serializeProductCreateFingerprint(
  actorUserId: string,
  payload: NormalizedProductCreateCommand,
): string {
  return JSON.stringify({
    version: PRODUCT_CREATE_FINGERPRINT_VERSION,
    ruleCode: PRODUCT_NUMBERING_RULE_CODE,
    consumerCode: PRODUCT_NUMBERING_CONSUMER_CODE,
    actorUserId,
    payload: {
      name: payload.name,
      categoryName: payload.categoryName,
      productHeadName: payload.productHeadName,
      status: payload.status,
      supplierValue: payload.supplierValue,
      twdSalePrice: {
        amount: payload.twdSalePrice.amount,
        currency: payload.twdSalePrice.currency,
      },
      myrSalePrice: {
        amount: payload.myrSalePrice.amount,
        currency: payload.myrSalePrice.currency,
      },
      purchaseCost: {
        amount: payload.purchaseCost.amount,
        currency: payload.purchaseCost.currency,
      },
      attributes: payload.attributes.map(attribute => ({
        title: attribute.title,
        value: attribute.value,
      })),
    },
  })
}

export function calculateProductCreateFingerprint(
  actorUserId: unknown,
  payload: NormalizedProductCreateCommand,
): string {
  if (!isCanonicalProductActorId(actorUserId)) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
      '请求参数校验失败',
      { actorUserId: ['必须是规范的小写 UUID v4'] },
    )
  }

  return createHash('sha256')
    .update(Buffer.from(
      serializeProductCreateFingerprint(actorUserId, payload),
      'utf8',
    ))
    .digest('hex')
}
