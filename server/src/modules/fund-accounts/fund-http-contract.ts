import { applyDecorators } from '@nestjs/common'
import { ApiHeader } from '@nestjs/swagger'

export const FUND_READ_FORBIDDEN = {
  status: 403,
  codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const

export const FUND_WRITE_FORBIDDEN = {
  status: 403,
  codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const

export const FUND_VALIDATION_ERRORS = {
  status: 422,
  codes: [
    'FUND_VALIDATION_FAILED',
    'VALIDATION_FAILED',
  ],
} as const

export const FUND_IDEMPOTENCY_HEADER_NAME = 'Idempotency-Key'

/** 原始幂等键只通过 Header 进入 Controller，不加入响应、日志或 DTO body。 */
export function ApiFundIdempotencyKey(): MethodDecorator {
  return applyDecorators(ApiHeader({
    name: FUND_IDEMPOTENCY_HEADER_NAME,
    required: true,
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
    },
  }))
}
