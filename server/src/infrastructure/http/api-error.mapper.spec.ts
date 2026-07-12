import { HttpException } from '@nestjs/common'

import { ApiException } from './api.exception'
import { mapExceptionToApiError } from './api-error.mapper'

const REQUEST_ID = 'req_550e8400-e29b-41d4-a716-446655440000'
const SENSITIVE_CANARY = 'mapper-sensitive-canary'

describe('mapExceptionToApiError', () => {
  const expectedByStatus = new Map<number, readonly [string, string]>([
    [400, ['BAD_REQUEST', '请求格式错误']],
    [401, ['UNAUTHORIZED', '未登录或登录已失效']],
    [403, ['FORBIDDEN', '没有权限执行此操作']],
    [404, ['NOT_FOUND', '请求的资源不存在']],
    [409, ['CONFLICT', '请求与当前资源状态冲突']],
    [422, ['VALIDATION_FAILED', '请求参数校验失败']],
    [500, ['INTERNAL_ERROR', '服务器内部错误']],
  ])

  it.each([...expectedByStatus])(
    'maps standard HttpException status %i without exposing its original message',
    (status, [code, message]) => {
      const result = mapExceptionToApiError(
        new HttpException(SENSITIVE_CANARY, status),
        REQUEST_ID,
      )

      expect(result).toEqual({
        status,
        body: { code, message, requestId: REQUEST_ID },
        unexpected: false,
      })
      expect(JSON.stringify(result)).not.toContain(SENSITIVE_CANARY)
    },
  )

  it.each([
    [418, 'REQUEST_REJECTED', '请求无法处理'],
    [502, 'INTERNAL_ERROR', '服务器内部错误'],
  ] as const)(
    'uses the safe fallback contract for standard HttpException status %i',
    (status, code, message) => {
      const result = mapExceptionToApiError(
        new HttpException(
          { message: SENSITIVE_CANARY, detail: SENSITIVE_CANARY },
          status,
        ),
        REQUEST_ID,
      )

      expect(result).toEqual({
        status,
        body: { code, message, requestId: REQUEST_ID },
        unexpected: false,
      })
      expect(JSON.stringify(result)).not.toContain(SENSITIVE_CANARY)
    },
  )

  it('preserves the explicit safe contract carried by ApiException', () => {
    const fieldErrors = {
      'items.0.name': ['必须是字符串'],
    }
    const exception = new ApiException(
      422,
      'ITEM_NAME_INVALID',
      '商品名称无效',
      fieldErrors,
    )

    expect(mapExceptionToApiError(exception, REQUEST_ID)).toEqual({
      status: 422,
      body: {
        code: 'ITEM_NAME_INVALID',
        message: '商品名称无效',
        fieldErrors,
        requestId: REQUEST_ID,
      },
      unexpected: false,
    })
  })

  it('sanitizes unknown exceptions as unexpected internal errors', () => {
    const result = mapExceptionToApiError(
      new Error(SENSITIVE_CANARY),
      REQUEST_ID,
    )

    expect(result).toEqual({
      status: 500,
      body: {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误',
        requestId: REQUEST_ID,
      },
      unexpected: true,
    })
    expect(JSON.stringify(result)).not.toContain(SENSITIVE_CANARY)
  })
})
