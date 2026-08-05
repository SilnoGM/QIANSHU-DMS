import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import { mapExceptionToApiError } from '../../infrastructure/http/api-error.mapper'
import {
  createSupplierApiException,
  SUPPLIER_ERROR_CODES,
  SUPPLIER_ERROR_DEFINITIONS,
  type SupplierErrorCode,
} from './supplier.errors'

const ERROR_CONTRACT = [
  ['SUPPLIER_NOT_FOUND', HttpStatus.NOT_FOUND, '供应商不存在'],
  ['SUPPLIER_IDEMPOTENCY_CONFLICT', HttpStatus.CONFLICT, '幂等键已用于不同的供应商创建请求'],
  ['SUPPLIER_REGISTRATION_ALREADY_EXISTS', HttpStatus.CONFLICT, '该国家或地区下的供应商登记号已存在'],
  ['SUPPLIER_STATE_CHANGED', HttpStatus.CONFLICT, '供应商状态已变化，请刷新后重试'],
  ['SUPPLIER_REGION_INVALID', HttpStatus.UNPROCESSABLE_ENTITY, '供应商地区层级或父子关系无效'],
  ['SUPPLIER_REGION_UNAVAILABLE', HttpStatus.UNPROCESSABLE_ENTITY, '所选供应商地区当前不可用'],
  ['SUPPLIER_ENABLE_REQUIREMENTS_NOT_MET', HttpStatus.UNPROCESSABLE_ENTITY, '启用供应商需要联系人姓名以及电话或微信号'],
  ['SUPPLIER_NUMBERING_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE, '供应商编号暂时不可用，请稍后重试'],
  ['VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY, '请求参数校验失败'],
  ['INTERNAL_ERROR', HttpStatus.INTERNAL_SERVER_ERROR, '服务器内部错误'],
] as const satisfies ReadonlyArray<readonly [SupplierErrorCode, HttpStatus, string]>

describe('supplier stable errors', () => {
  it('publishes exactly eight domain codes and two boundary codes', () => {
    expect(Object.values(SUPPLIER_ERROR_CODES).sort()).toEqual(
      ERROR_CONTRACT.map(([code]) => code).sort(),
    )
  })

  it.each(ERROR_CONTRACT)('creates fixed %s contract', (code, status, publicMessage) => {
    expect(SUPPLIER_ERROR_DEFINITIONS[code]).toEqual({ status, publicMessage })
    expect(createSupplierApiException(code)).toMatchObject({
      code,
      publicMessage,
    })
    expect(createSupplierApiException(code).getStatus()).toBe(status)
  })

  it('cannot leak untrusted supplier data through extra arguments', () => {
    const secret = 'registration=SECRET phone=13800000000 key=raw-key'
    const unsafe = createSupplierApiException as unknown as (
      code: SupplierErrorCode,
      unsafe: string,
    ) => ApiException
    const mapped = mapExceptionToApiError(
      unsafe(SUPPLIER_ERROR_CODES.INTERNAL_ERROR, secret),
      'request-id',
    )

    expect(JSON.stringify(mapped.body)).not.toContain(secret)
    expect(mapped.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
      requestId: 'request-id',
    })
  })
})
