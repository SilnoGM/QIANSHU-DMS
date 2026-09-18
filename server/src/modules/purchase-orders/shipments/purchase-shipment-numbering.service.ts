import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { NumberingGeneratorService } from '../../numbering/numbering-generator.service'
import { NumberingGenerationError } from '../../numbering/numbering.errors'

export const SHIPMENT_NUMBERING_RULE = 'SHIPMENT_NO'
export const SHIPMENT_NUMBERING_CONSUMER = 'SHIPMENT_NO.CREATE'

export interface NumberablePurchaseShipment {
  readonly id: string
  readonly purchaseOrderId: string
  readonly key: string
}

/** 指纹仅绑定不可变身份；创建与历史补号共用，不能受操作者、状态或当前规则版本影响。 */
export function shipmentNumberFingerprint(part: NumberablePurchaseShipment): string {
  return createHash('sha256')
    .update(`purchase-shipment.number.v1:${part.id}:${part.purchaseOrderId}:${part.key}`, 'utf8')
    .digest('hex')
}

function unavailable(): ApiException {
  return new ApiException(409, 'PURCHASE_SHIPMENT_NUMBERING_UNAVAILABLE', '货件编号规则 SHIPMENT_NO 当前不可用，请检查业务编号规则及剩余容量')
}

@Injectable()
export class PurchaseShipmentNumberingService {
  constructor(private readonly numbering: NumberingGeneratorService) {}

  async issue(transaction: Prisma.TransactionClient, parts: readonly NumberablePurchaseShipment[]) {
    try {
      // 持有共享锁直到货件写入提交，避免 purpose 校验与派发之间发生配置切换。
      const rules = await transaction.$queryRaw<{ purpose: string }[]>`
        SELECT purpose::text AS purpose FROM numbering_rules WHERE rule_code = ${SHIPMENT_NUMBERING_RULE} FOR SHARE
      `
      if (rules[0]?.purpose !== 'BUSINESS') throw unavailable()
      const results = await this.numbering.generateScopedBatchInTransaction(transaction, parts.map(part => ({
        ruleCode: SHIPMENT_NUMBERING_RULE, consumerCode: SHIPMENT_NUMBERING_CONSUMER,
        idempotencyKey: part.id, requestFingerprint: shipmentNumberFingerprint(part),
      })))
      return results.map(result => ({ shipmentNo: result.number, numberingIssuanceId: result.issuanceId, issuedAt: result.issuedAt }))
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      if (!(error instanceof NumberingGenerationError)) throw error
      if (error.code === 'NUMBERING_RULE_STATE_CHANGED' || error.code === 'NUMBERING_GENERATION_RETRY_EXHAUSTED') {
        throw new ApiException(409, 'PURCHASE_ORDER_STATE_CHANGED', '货件编号派发状态已变化，请使用原提交请求重试')
      }
      if (error.code === 'NUMBERING_OUTPUT_CONFLICT' || error.code === 'NUMBERING_IDEMPOTENCY_CONFLICT') {
        throw new ApiException(409, 'PURCHASE_SHIPMENT_NUMBER_CONFLICT', '货件编号或派发身份发生冲突')
      }
      if (error.code === 'INTERNAL_ERROR' || error.code === 'VALIDATION_FAILED') {
        throw new ApiException(500, 'INTERNAL_ERROR', '服务器内部错误')
      }
      throw unavailable()
    }
  }
}
