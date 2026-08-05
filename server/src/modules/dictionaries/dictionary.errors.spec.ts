import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import { mapExceptionToApiError } from '../../infrastructure/http/api-error.mapper'
import {
  createDictionaryApiException,
  DICTIONARY_ERROR_CODES,
  DICTIONARY_ERROR_DEFINITIONS,
  type DictionaryErrorCode,
} from './dictionary.errors'

const ERROR_CONTRACT = [
  [
    'DICTIONARY_TYPE_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    '字典类型不存在',
  ],
  [
    'DICTIONARY_ITEM_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    '字典条目不存在',
  ],
  [
    'DICTIONARY_TYPE_CODE_ALREADY_EXISTS',
    HttpStatus.CONFLICT,
    '字典类型编码已存在',
  ],
  [
    'DICTIONARY_ITEM_VALUE_ALREADY_EXISTS',
    HttpStatus.CONFLICT,
    '字典条目值已存在',
  ],
  [
    'DICTIONARY_TYPE_STATE_CHANGED',
    HttpStatus.CONFLICT,
    '字典类型状态已变化，请刷新后重试',
  ],
  [
    'DICTIONARY_ITEM_STATE_CHANGED',
    HttpStatus.CONFLICT,
    '字典条目状态已变化，请刷新后重试',
  ],
  [
    'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    '启用的字典类型必须至少保留一个启用条目',
  ],
  [
    'VALIDATION_FAILED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    '请求参数校验失败',
  ],
  [
    'INTERNAL_ERROR',
    HttpStatus.INTERNAL_SERVER_ERROR,
    '服务器内部错误',
  ],
] as const satisfies ReadonlyArray<
  readonly [DictionaryErrorCode, HttpStatus, string]
>

describe('dictionary stable errors', () => {
  it('publishes exactly the seven domain codes and two boundary codes', () => {
    expect(Object.values(DICTIONARY_ERROR_CODES).sort()).toEqual(
      ERROR_CONTRACT.map(([code]) => code).sort(),
    )
  })

  it.each(ERROR_CONTRACT)(
    'creates fixed %s contract',
    (code, status, publicMessage) => {
      expect(DICTIONARY_ERROR_DEFINITIONS[code]).toEqual({
        status,
        publicMessage,
      })

      const exception = createDictionaryApiException(code)

      expect(exception).toBeInstanceOf(ApiException)
      expect(exception).toMatchObject({ code, publicMessage })
      expect(exception.getStatus()).toBe(status)
      expect(exception.fieldErrors).toBeUndefined()
    },
  )

  it('ignores untrusted extra arguments and exposes no database details', () => {
    const mustNotLeak =
      'must-not-leak sql=SELECT secret connection=postgres://user:pass input=value'
    const unsafeCaller = createDictionaryApiException as unknown as (
      code: DictionaryErrorCode,
      message: string,
      options: { cause: Error; stack: string },
    ) => ApiException

    const exception = unsafeCaller(
      DICTIONARY_ERROR_CODES.INTERNAL_ERROR,
      mustNotLeak,
      {
        cause: new Error(mustNotLeak),
        stack: mustNotLeak,
      },
    )
    const mapped = mapExceptionToApiError(exception, 'request-id')
    const serializedBody = JSON.stringify(mapped.body)

    expect(mapped).toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误',
        requestId: 'request-id',
      },
      unexpected: false,
    })
    expect(mapped.body).not.toHaveProperty('stack')
    expect(mapped.body).not.toHaveProperty('cause')
    expect(serializedBody).not.toContain(mustNotLeak)
    expect(exception).not.toHaveProperty('cause')
  })
})
