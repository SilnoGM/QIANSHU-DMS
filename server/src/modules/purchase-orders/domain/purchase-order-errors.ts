import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../../infrastructure/http/api.exception'

export function purchaseOrderValidationFailure(
  field: string,
  message = '字段校验失败',
): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    { [field]: [message] },
  )
}

export function purchaseOrderRuleFailure(
  code: string,
  publicMessage: string,
  field?: string,
): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    code,
    publicMessage,
    field === undefined ? undefined : { [field]: [publicMessage] },
  )
}
