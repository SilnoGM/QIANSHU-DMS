import type {
  CreateExchangeRateRequestDto,
  ExchangeRateManagementItemDto,
  ExchangeRatesListData,
  UpdateExchangeRateRequestDto,
} from '@/api/generated/types.gen'
import type { QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'

import Decimal from 'decimal.js'

export type ExchangeRateStatus = 'CONFIGURED' | 'UNCONFIGURED'
type ExchangeRateListQuery = NonNullable<ExchangeRatesListData['query']>

export interface ExchangeRateFormContext {
  readonly currencyId: string
  readonly exchangeRateId: null | string
  readonly foreignUnitsPerCny: string
  readonly version: null | number
}

export type ExchangeRateFormSubmission
  = | {
    readonly mode: 'create'
    readonly value: CreateExchangeRateRequestDto
  }
  | {
    readonly exchangeRateId: string
    readonly mode: 'edit'
    readonly value: UpdateExchangeRateRequestDto
  }

export interface ExchangeRateApiFailure {
  readonly code: string | undefined
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly message: string
  readonly requestId: string | undefined
  readonly unknownResult: boolean
}

export interface ExchangeRateResponseGuardInput {
  readonly aborted: boolean
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly latestRequestVersion: number
  readonly requestVersion: number
}

const ALLOWED_PAGE_SIZES = new Set([20, 50, 100])
const DECIMAL_INPUT_PATTERN = /^\d+(?:\.\d+)?$/u

export function buildExchangeRateListQuery(input: {
  readonly filters: QsGenericTableFilterValues
  readonly page: number
  readonly pageSize: number
  readonly search: string
}): ExchangeRateListQuery {
  const query = input.search.normalize('NFC').trim()
  const status = input.filters.status === 'CONFIGURED'
    || input.filters.status === 'UNCONFIGURED'
    ? input.filters.status
    : undefined

  return {
    page: Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1,
    pageSize: ALLOWED_PAGE_SIZES.has(input.pageSize) ? input.pageSize : 20,
    ...(query === '' ? {} : { query }),
    ...(status === undefined ? {} : { status }),
  }
}

/**
 * 表单允许用户输入前导零，但提交前会在纯字符串边界归一化；全程不经过 number，
 * 避免 DECIMAL(30,4) 的大整数部分或小数部分发生精度损失。
 */
export function normalizeForeignUnitsPerCny(value: string): string {
  const trimmed = value.trim()
  const [rawInteger = '', fraction] = trimmed.split('.')
  const integer = rawInteger.replace(/^0+(?=\d)/u, '')
  return fraction === undefined ? integer : `${integer}.${fraction}`
}

export function validateForeignUnitsPerCny(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    return '请输入换算比例'
  }
  if (!DECIMAL_INPUT_PATTERN.test(trimmed)) {
    return '换算比例只能使用普通十进制数字'
  }

  const normalized = normalizeForeignUnitsPerCny(trimmed)
  const [integer = '', fraction = ''] = normalized.split('.')
  if (integer.length > 18) {
    return '换算比例整数部分最多支持 18 位'
  }
  if (fraction.length > 4) {
    return '换算比例最多支持 4 位小数'
  }
  if (!/[1-9]/u.test(normalized)) {
    return '换算比例必须大于 0'
  }
  return ''
}

export function buildExchangeRateSubmission(
  context: ExchangeRateFormContext,
): ExchangeRateFormSubmission {
  const validationMessage = validateForeignUnitsPerCny(
    context.foreignUnitsPerCny,
  )
  if (validationMessage !== '') {
    throw new RangeError(validationMessage)
  }
  const foreignUnitsPerCny = normalizeForeignUnitsPerCny(
    context.foreignUnitsPerCny,
  )

  if (context.exchangeRateId === null) {
    return {
      mode: 'create',
      value: {
        currencyId: context.currencyId,
        foreignUnitsPerCny,
      },
    }
  }
  if (context.version === null || !Number.isSafeInteger(context.version)) {
    throw new RangeError('汇率版本无效，请关闭弹窗后重试')
  }
  return {
    exchangeRateId: context.exchangeRateId,
    mode: 'edit',
    value: {
      expectedVersion: context.version,
      foreignUnitsPerCny,
    },
  }
}

export function formatConversionExample(
  currencyCode: string,
  foreignUnitsPerCny: string,
): string {
  if (validateForeignUnitsPerCny(foreignUnitsPerCny) !== '') {
    return '填写比例后显示换算示例'
  }
  const normalized = normalizeForeignUnitsPerCny(foreignUnitsPerCny)
  const converted = new Decimal(100)
    .div(normalized)
    .toDecimalPlaces(2)
    .toFixed(2)
  return `例如：100 ${currencyCode} ÷ ${normalized} = ${converted} CNY`
}

export function exchangeRateStatusLabel(
  item: ExchangeRateManagementItemDto,
): '已配置' | '未配置' {
  return item.currentRate === null ? '未配置' : '已配置'
}

export function canApplyExchangeRateResponse(
  input: ExchangeRateResponseGuardInput,
): boolean {
  return !input.aborted
    && input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isExchangeRateAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    isRecord(error) && (
      error.code === 'ERR_CANCELED'
      || error.name === 'CanceledError'
    )
  )
}

/**
 * Axios 失败仍是不可信输入。只有网络失败存在“服务端可能已提交、客户端未收到响应”
 * 的未知结果；4xx/5xx 明确响应可以安全留在弹窗内呈现。
 */
export function getExchangeRateApiFailure(
  error: unknown,
): ExchangeRateApiFailure {
  if (!isRecord(error)) {
    return {
      code: undefined,
      fieldErrors: {},
      message: '请求失败，请稍后重试',
      requestId: undefined,
      unknownResult: false,
    }
  }

  const body = isRecord(error.body) ? error.body : undefined
  const fieldErrors: Record<string, string> = {}
  if (isRecord(body?.fieldErrors)) {
    for (const [field, messages] of Object.entries(body.fieldErrors)) {
      if (
        Array.isArray(messages)
        && typeof messages[0] === 'string'
      ) {
        fieldErrors[field] = messages[0]
      }
    }
  }

  return {
    code: typeof body?.code === 'string' ? body.code : undefined,
    fieldErrors,
    message: typeof body?.message === 'string'
      ? body.message
      : typeof error.message === 'string'
        ? error.message
        : '请求失败，请稍后重试',
    requestId: typeof body?.requestId === 'string'
      ? body.requestId
      : typeof error.requestId === 'string'
        ? error.requestId
        : undefined,
    unknownResult: error.kind === 'network',
  }
}
