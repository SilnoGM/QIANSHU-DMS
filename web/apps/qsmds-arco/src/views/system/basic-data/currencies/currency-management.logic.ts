import type {
  CreateCurrencyRequestDto,
  CurrenciesListData,
  CurrencyDto,
  UpdateCurrencyRequestDto,
} from '@/api/generated/types.gen'

export type CurrencyStatusFilter = 'DISABLED' | 'ENABLED'
export type CurrencyFormMode = 'create' | 'edit'

export interface CurrencyFormModel {
  code: string
  englishName: string
  minorUnit: string
  name: string
  sortOrder: string
  symbol: string
}

export type CurrencyFormField = keyof CurrencyFormModel
export type CurrencyFormErrors = Partial<Record<CurrencyFormField, string>>

export interface BuildCurrencyListQueryInput {
  readonly page: number
  readonly pageSize: number
  readonly search: string
  readonly status: unknown
}

export interface CurrencyMutationFailure {
  readonly code: string | undefined
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly message: string
  readonly requestId: string | undefined
  readonly unknownResult: boolean
}

export interface CurrencyActionPermissions {
  readonly canDisable: boolean
  readonly canEnable: boolean
  readonly canUpdate: boolean
}

export interface CurrencyActions {
  readonly canDisable: boolean
  readonly canEdit: boolean
  readonly canEnable: boolean
  readonly hasAny: boolean
  readonly readonlyReason: '基准币只读' | '仅查看'
}

type CurrencyListQuery = NonNullable<CurrenciesListData['query']>

const PAGE_SIZES = new Set([20, 50, 100])
const MAX_INT32 = 2_147_483_647
const MUTATION_FIELDS = new Set<CurrencyFormField>([
  'code',
  'englishName',
  'minorUnit',
  'name',
  'sortOrder',
  'symbol',
])

function normalizeText(value: string): string {
  return value.normalize('NFC').trim()
}

function codePointLength(value: string): number {
  // Server 使用 Unicode 码点校验字段长度，Web 保持同一计算口径。
  return Array.from(value).length
}

function toInteger(value: string): number | undefined {
  const normalized = value.trim()
  if (!/^\d+$/u.test(normalized)) {
    return undefined
  }
  const integer = Number(normalized)
  return Number.isSafeInteger(integer) ? integer : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildCurrencyListQuery(
  input: BuildCurrencyListQueryInput,
): CurrencyListQuery {
  const page = Number.isSafeInteger(input.page) && input.page > 0
    ? input.page
    : 1
  const pageSize = PAGE_SIZES.has(input.pageSize) ? input.pageSize : 20
  const query = input.search.trim()
  const status = input.status === 'ENABLED' || input.status === 'DISABLED'
    ? input.status
    : undefined

  return {
    page,
    pageSize,
    ...(query === '' ? {} : { query }),
    ...(status === undefined ? {} : { status }),
  }
}

export function createCurrencyFormModel(
  mode: CurrencyFormMode,
  currency: CurrencyDto | null,
): CurrencyFormModel {
  if (mode === 'edit' && currency !== null) {
    return {
      code: currency.code,
      englishName: currency.englishName ?? '',
      minorUnit: String(currency.minorUnit),
      name: currency.name,
      sortOrder: String(currency.sortOrder),
      symbol: currency.symbol ?? '',
    }
  }

  return {
    code: '',
    englishName: '',
    minorUnit: '2',
    name: '',
    sortOrder: '0',
    symbol: '',
  }
}

export function validateCurrencyForm(
  model: CurrencyFormModel,
  mode: CurrencyFormMode,
): CurrencyFormErrors {
  const errors: CurrencyFormErrors = {}
  const code = normalizeText(model.code)
  const name = normalizeText(model.name)
  const englishName = normalizeText(model.englishName)
  const symbol = normalizeText(model.symbol)
  const minorUnit = toInteger(model.minorUnit)
  const sortOrder = toInteger(model.sortOrder)

  if (mode === 'create' && !/^[A-Za-z]{3}$/u.test(code)) {
    errors.code = '货币代码必须是三位英文字母'
  }
  if (name === '' || codePointLength(name) > 128) {
    errors.name = '货币名称应为 1 到 128 个字符且不能全为空白'
  }
  if (codePointLength(englishName) > 128) {
    errors.englishName = '英文名称不能超过 128 个字符'
  }
  if (codePointLength(symbol) > 16) {
    errors.symbol = '货币符号不能超过 16 个字符'
  }
  if (minorUnit === undefined || minorUnit < 0 || minorUnit > 4) {
    errors.minorUnit = '系统金额小数位必须是 0 到 4 的整数'
  }
  if (sortOrder === undefined || sortOrder < 0 || sortOrder > MAX_INT32) {
    errors.sortOrder = '排序必须是 0 到 2147483647 的整数'
  }

  return errors
}

export function buildCreateCurrencyRequest(
  model: CurrencyFormModel,
): CreateCurrencyRequestDto {
  const englishName = normalizeText(model.englishName)
  const symbol = normalizeText(model.symbol)

  return {
    code: normalizeText(model.code).toUpperCase(),
    name: normalizeText(model.name),
    ...(englishName === '' ? {} : { englishName }),
    ...(symbol === '' ? {} : { symbol }),
    minorUnit: toInteger(model.minorUnit)!,
    sortOrder: toInteger(model.sortOrder)!,
  }
}

export function buildUpdateCurrencyRequest(
  model: CurrencyFormModel,
  currency: CurrencyDto,
): UpdateCurrencyRequestDto {
  const englishName = normalizeText(model.englishName)
  const symbol = normalizeText(model.symbol)

  return {
    name: normalizeText(model.name),
    englishName: englishName === '' ? null : englishName,
    symbol: symbol === '' ? null : symbol,
    sortOrder: toInteger(model.sortOrder)!,
    expectedVersion: currency.version,
  }
}

export function hasCurrencyFormChanges(
  model: CurrencyFormModel,
  currency: CurrencyDto,
): boolean {
  const request = buildUpdateCurrencyRequest(model, currency)
  return request.name !== currency.name
    || request.englishName !== currency.englishName
    || request.symbol !== currency.symbol
    || request.sortOrder !== currency.sortOrder
}

export function resolveCurrencyActions(
  currency: CurrencyDto,
  permissions: CurrencyActionPermissions,
): CurrencyActions {
  if (currency.isBase) {
    // CNY 的 code、minorUnit 和启用状态固定，但名称、符号与排序仍是可维护展示字段。
    const canEdit = permissions.canUpdate
    return {
      canDisable: false,
      canEdit,
      canEnable: false,
      hasAny: canEdit,
      readonlyReason: '基准币只读',
    }
  }

  const canEdit = permissions.canUpdate
  const canEnable = !currency.enabled && permissions.canEnable
  const canDisable = currency.enabled && permissions.canDisable
  return {
    canDisable,
    canEdit,
    canEnable,
    hasAny: canEdit || canEnable || canDisable,
    readonlyReason: '仅查看',
  }
}

/**
 * Mutation 错误只读取标准化 API client 的公开字段。网络错误可能发生在 Server
 * 提交之后，页面需将其标记为结果未知，并通过重新加载而不是自动重试来对账。
 */
export function getCurrencyMutationFailure(error: unknown): CurrencyMutationFailure {
  const fallback: CurrencyMutationFailure = {
    code: undefined,
    fieldErrors: {},
    message: '操作失败，请稍后重试',
    requestId: undefined,
    unknownResult: false,
  }

  try {
    if (!isRecord(error)) {
      return fallback
    }
    if (error.kind === 'network') {
      return {
        ...fallback,
        message: typeof error.message === 'string'
          ? error.message
          : '网络连接失败，请稍后重试',
        unknownResult: true,
      }
    }
    if (error.kind !== 'http' || !isRecord(error.body)) {
      return {
        ...fallback,
        message: typeof error.message === 'string'
          ? error.message
          : '服务器返回了无法识别的错误响应',
        requestId: typeof error.requestId === 'string' ? error.requestId : undefined,
      }
    }

    const body = error.body
    const code = typeof body.code === 'string' ? body.code : undefined
    const message = typeof body.message === 'string' ? body.message : fallback.message
    const fieldErrors: Record<string, string> = {}
    if (isRecord(body.fieldErrors)) {
      for (const [field, messages] of Object.entries(body.fieldErrors)) {
        if (
          MUTATION_FIELDS.has(field as CurrencyFormField)
          && Array.isArray(messages)
          && typeof messages[0] === 'string'
        ) {
          fieldErrors[field] = messages[0]
        }
      }
    }
    if (code === 'CURRENCY_CODE_ALREADY_EXISTS' && fieldErrors.code === undefined) {
      fieldErrors.code = message
    }

    return {
      code,
      fieldErrors,
      message,
      requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
      unknownResult: false,
    }
  }
  catch {
    return fallback
  }
}

export function getCurrencyApiFailure(error: unknown): {
  message: string
  requestId: string | undefined
} {
  const failure = getCurrencyMutationFailure(error)
  return {
    message: failure.message === '操作失败，请稍后重试'
      ? '货币列表加载失败，请稍后重试'
      : failure.message,
    requestId: failure.requestId,
  }
}

export function isCurrencyAbortError(error: unknown): boolean {
  try {
    return (
      error instanceof DOMException
      && error.name === 'AbortError'
    ) || (
      isRecord(error)
      && error.code === 'ERR_CANCELED'
    )
  }
  catch {
    return false
  }
}
