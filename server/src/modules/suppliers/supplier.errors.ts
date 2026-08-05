import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'

export const SUPPLIER_ERROR_CODES = {
  NOT_FOUND: 'SUPPLIER_NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'SUPPLIER_IDEMPOTENCY_CONFLICT',
  REGISTRATION_ALREADY_EXISTS: 'SUPPLIER_REGISTRATION_ALREADY_EXISTS',
  STATE_CHANGED: 'SUPPLIER_STATE_CHANGED',
  REGION_INVALID: 'SUPPLIER_REGION_INVALID',
  REGION_UNAVAILABLE: 'SUPPLIER_REGION_UNAVAILABLE',
  ENABLE_REQUIREMENTS_NOT_MET: 'SUPPLIER_ENABLE_REQUIREMENTS_NOT_MET',
  NUMBERING_UNAVAILABLE: 'SUPPLIER_NUMBERING_UNAVAILABLE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type SupplierErrorCode =
  (typeof SUPPLIER_ERROR_CODES)[keyof typeof SUPPLIER_ERROR_CODES]

export interface SupplierErrorDefinition {
  readonly status: HttpStatus
  readonly publicMessage: string
}

/**
 * Supplier 公开错误只使用固定文案，禁止携带登记、联系人、地址、幂等键或底层异常。
 */
export const SUPPLIER_ERROR_DEFINITIONS: Readonly<
  Record<SupplierErrorCode, SupplierErrorDefinition>
> = {
  SUPPLIER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    publicMessage: '供应商不存在',
  },
  SUPPLIER_IDEMPOTENCY_CONFLICT: {
    status: HttpStatus.CONFLICT,
    publicMessage: '幂等键已用于不同的供应商创建请求',
  },
  SUPPLIER_REGISTRATION_ALREADY_EXISTS: {
    status: HttpStatus.CONFLICT,
    publicMessage: '该国家或地区下的供应商登记号已存在',
  },
  SUPPLIER_STATE_CHANGED: {
    status: HttpStatus.CONFLICT,
    publicMessage: '供应商状态已变化，请刷新后重试',
  },
  SUPPLIER_REGION_INVALID: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    publicMessage: '供应商地区层级或父子关系无效',
  },
  SUPPLIER_REGION_UNAVAILABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    publicMessage: '所选供应商地区当前不可用',
  },
  SUPPLIER_ENABLE_REQUIREMENTS_NOT_MET: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    publicMessage: '启用供应商需要联系人姓名以及电话或微信号',
  },
  SUPPLIER_NUMBERING_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    publicMessage: '供应商编号暂时不可用，请稍后重试',
  },
  VALIDATION_FAILED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    publicMessage: '请求参数校验失败',
  },
  INTERNAL_ERROR: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    publicMessage: '服务器内部错误',
  },
}

export function createSupplierApiException(
  code: SupplierErrorCode,
): ApiException {
  const definition = SUPPLIER_ERROR_DEFINITIONS[code]
  return new ApiException(definition.status, code, definition.publicMessage)
}
