import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'

export const DICTIONARY_ERROR_CODES = {
  TYPE_NOT_FOUND: 'DICTIONARY_TYPE_NOT_FOUND',
  ITEM_NOT_FOUND: 'DICTIONARY_ITEM_NOT_FOUND',
  TYPE_CODE_ALREADY_EXISTS: 'DICTIONARY_TYPE_CODE_ALREADY_EXISTS',
  ITEM_VALUE_ALREADY_EXISTS: 'DICTIONARY_ITEM_VALUE_ALREADY_EXISTS',
  TYPE_STATE_CHANGED: 'DICTIONARY_TYPE_STATE_CHANGED',
  ITEM_STATE_CHANGED: 'DICTIONARY_ITEM_STATE_CHANGED',
  TYPE_ENABLED_ITEM_REQUIRED: 'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type DictionaryErrorCode =
  (typeof DICTIONARY_ERROR_CODES)[keyof typeof DICTIONARY_ERROR_CODES]

export interface DictionaryErrorDefinition {
  readonly status: HttpStatus
  readonly publicMessage: string
}

/**
 * 字典领域允许公开的完整错误矩阵。文案不得拼接输入值、SQL、连接信息或底层异常，
 * 以便 Query、Command 与 Persistence 后续只通过稳定 code 选择安全响应。
 */
export const DICTIONARY_ERROR_DEFINITIONS: Readonly<
  Record<DictionaryErrorCode, DictionaryErrorDefinition>
> = {
  DICTIONARY_TYPE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    publicMessage: '字典类型不存在',
  },
  DICTIONARY_ITEM_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    publicMessage: '字典条目不存在',
  },
  DICTIONARY_TYPE_CODE_ALREADY_EXISTS: {
    status: HttpStatus.CONFLICT,
    publicMessage: '字典类型编码已存在',
  },
  DICTIONARY_ITEM_VALUE_ALREADY_EXISTS: {
    status: HttpStatus.CONFLICT,
    publicMessage: '字典条目值已存在',
  },
  DICTIONARY_TYPE_STATE_CHANGED: {
    status: HttpStatus.CONFLICT,
    publicMessage: '字典类型状态已变化，请刷新后重试',
  },
  DICTIONARY_ITEM_STATE_CHANGED: {
    status: HttpStatus.CONFLICT,
    publicMessage: '字典条目状态已变化，请刷新后重试',
  },
  DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    publicMessage: '启用的字典类型必须至少保留一个启用条目',
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

/**
 * 只接收稳定 code，调用者无法把数据库 message、cause 或用户输入带入公开异常。
 */
export function createDictionaryApiException(
  code: DictionaryErrorCode,
): ApiException {
  const definition = DICTIONARY_ERROR_DEFINITIONS[code]

  return new ApiException(
    definition.status,
    code,
    definition.publicMessage,
  )
}
