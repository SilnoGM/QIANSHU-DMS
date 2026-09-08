import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import { NumberingGenerationError } from '../numbering/numbering.errors'
import type { PurchaseOrderShippingMarkResolutionDto } from '../purchase-shipping-marks/purchase-shipping-mark-resolution.dto'

export const PURCHASE_SHIPPING_MARK_CONSUMER = 'PURCHASE_ORDER.REVIEW_SHIPPING_MARK'

/** 摘要仅用于发现配置变化，实际 ruleCode 必须取自事务内的可信解析结果。 */
export function requirePurchaseShippingMark(
  resolution: PurchaseOrderShippingMarkResolutionDto,
  expectedResolution?: string,
): string {
  if (resolution.availability !== 'AVAILABLE') {
    throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE', resolution.message)
  }
  if (expectedResolution !== undefined && resolution.resolutionToken !== expectedResolution) {
    throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED', '唛头规则已变化，请刷新核对后重新确认提交')
  }
  if (resolution.ruleCode === null) {
    throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', '服务器内部错误')
  }
  return resolution.ruleCode
}

export function mapShippingMarkGenerationError(error: NumberingGenerationError): ApiException {
  if (error.code === 'INTERNAL_ERROR' || error.code === 'VALIDATION_FAILED') {
    return new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', '服务器内部错误')
  }
  if (error.code === 'NUMBERING_IDEMPOTENCY_CONFLICT') {
    return new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '采购唛头派发身份已变化，请刷新核对')
  }
  if (error.retryable) {
    return new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '采购订单依赖状态已变化，请重试')
  }
  return new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE',
    error.code === 'NUMBERING_CAPACITY_EXHAUSTED' ? '唛头编号容量已耗尽，请联系管理员' : '唛头编号规则当前无法派发，请联系管理员检查规则')
}
