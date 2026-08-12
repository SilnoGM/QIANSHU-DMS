import type {
  CreateProductRequestDto,
  ProductListItemDto,
} from '@/api/generated/types.gen'

import { validateMoneyString } from '../../../../components/base/MoneyInput/logic'

export type ProductCreateStatus = CreateProductRequestDto['status']

export interface ProductCreateAttributeRow {
  key: string
  title: string
  value: string
}

export interface ProductCreateFormModel {
  attributes: ProductCreateAttributeRow[]
  myrSalePriceAmount: string | null
  name: string
  purchaseCostAmount: string | null
  purchaseCostCurrency: string
  status: ProductCreateStatus
  supplierValue: string | null
  twdSalePriceAmount: string | null
}

export interface ProductCreateMoneyPrecisions {
  myrSalePricePrecision: number
  purchaseCostPrecision: number
  twdSalePricePrecision: number
}

export type ProductCreateFieldErrors = Readonly<Record<string, string>>

export type BuildCreateProductRequestResult
  = | {
    readonly request: CreateProductRequestDto
    readonly valid: true
  }
  | {
    readonly fieldErrors: ProductCreateFieldErrors
    readonly valid: false
  }

export interface ProductCreateApiFailure {
  readonly code: string | undefined
  readonly fieldErrors: ProductCreateFieldErrors
  readonly hasUnmappedFieldErrors: boolean
  readonly message: string
  readonly requestId: string | undefined
  readonly unknownResult: boolean
}

interface ProductCreateSubmissionContext {
  readonly authEpoch: number
  readonly idempotencyKey: string
  readonly requestVersion: number
  readonly snapshot: Readonly<CreateProductRequestDto>
}

export interface ProductCreateEditingState {
  readonly failure?: ProductCreateApiFailure
  readonly phase: 'editing'
}

export interface ProductCreateSubmittingState extends ProductCreateSubmissionContext {
  readonly phase: 'submitting'
}

export interface ProductCreateUnknownState extends ProductCreateSubmissionContext {
  readonly failure: ProductCreateApiFailure
  readonly phase: 'unknown'
}

export interface ProductCreateSuccessState {
  readonly phase: 'success'
  readonly product: ProductListItemDto
}

export type ProductCreateSubmissionState
  = | ProductCreateEditingState
    | ProductCreateSubmittingState
    | ProductCreateSuccessState
    | ProductCreateUnknownState

export interface ProductCreateResponseGuardInput {
  readonly aborted: boolean
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly latestRequestVersion: number
  readonly requestVersion: number
}

const PRODUCT_STATUSES = new Set<ProductCreateStatus>([
  'DRAFT',
  'ACTIVE',
  'INACTIVE',
])
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u
const ATTRIBUTE_FIELD_PATTERN = /^attributes\.(?:\d|[1-4]\d)\.(?:title|value)$/u
const SIMPLE_FIELD_PATHS = new Set([
  'idempotencyKey',
  'myrSalePrice.amount',
  'myrSalePrice.currency',
  'name',
  'purchaseCost.amount',
  'purchaseCost.currency',
  'status',
  'supplierValue',
  'twdSalePrice.amount',
  'twdSalePrice.currency',
])
const MAXIMUM_AMOUNT_BY_PRECISION = Array.from({ length: 5 }, (_value, precision) =>
  `${'9'.repeat(26)}${precision === 0 ? '' : `.${'9'.repeat(precision)}`}`)
const DEFAULT_FAILURE_MESSAGE = '操作失败，请稍后重试'

function codePointLength(value: string): number {
  return [...value].length
}

function normalizeText(value: string): string {
  return value.trim().normalize('NFC')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAllowedFieldPath(value: string): boolean {
  return SIMPLE_FIELD_PATHS.has(value) || ATTRIBUTE_FIELD_PATTERN.test(value)
}

function readFirstMessage(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string'
    ? value[0]
    : undefined
}

function addTextError(
  errors: Record<string, string>,
  field: string,
  value: string,
  maximumCodePoints: number,
  label: string,
): string {
  const normalized = normalizeText(value)
  const length = codePointLength(normalized)
  if (length === 0) {
    errors[field] = `${label}不能为空`
  }
  else if (length > maximumCodePoints) {
    errors[field] = `${label}不能超过 ${maximumCodePoints} 个字符`
  }
  return normalized
}

function normalizeMoney(
  errors: Record<string, string>,
  field: string,
  amount: string | null,
  precision: number,
): string | null {
  const max = MAXIMUM_AMOUNT_BY_PRECISION[precision]
  // Currency minorUnit 来自服务端 Catalog，非法配置必须失败关闭。
  if (max === undefined) {
    errors[field] = '货币精度配置无效'
    return null
  }
  const result = validateMoneyString(amount, { max, precision })
  if (!result.valid) {
    errors[field] = result.message
    return null
  }
  return result.normalizedValue
}

function cloneAndFreezeRequest(
  request: CreateProductRequestDto,
): Readonly<CreateProductRequestDto> {
  const attributes = request.attributes.map(attribute =>
    Object.freeze({ title: attribute.title, value: attribute.value }))
  return Object.freeze({
    attributes: Object.freeze(attributes),
    myrSalePrice: Object.freeze({ ...request.myrSalePrice }),
    name: request.name,
    purchaseCost: Object.freeze({ ...request.purchaseCost }),
    status: request.status,
    supplierValue: request.supplierValue,
    twdSalePrice: Object.freeze({ ...request.twdSalePrice }),
  }) as Readonly<CreateProductRequestDto>
}

export function createProductCreateFormModel(): ProductCreateFormModel {
  return {
    attributes: [],
    myrSalePriceAmount: null,
    name: '',
    purchaseCostAmount: null,
    purchaseCostCurrency: 'CNY',
    status: 'DRAFT',
    supplierValue: null,
    twdSalePriceAmount: null,
  }
}

/** row key 只服务于 Vue 就地编辑，不参与 dirty 基线或 API DTO。 */
export function createProductAttributeRow(
  key: string,
  title = '',
  value = '',
): ProductCreateAttributeRow {
  return { key, title, value }
}

export function hasProductCreateChanges(model: ProductCreateFormModel): boolean {
  return model.name !== ''
    || model.status !== 'DRAFT'
    || model.supplierValue !== null
    || model.twdSalePriceAmount !== null
    || model.myrSalePriceAmount !== null
    || model.purchaseCostAmount !== null
    || model.purchaseCostCurrency !== 'CNY'
    || model.attributes.length > 0
}

/**
 * 表单转输契约的唯一边界。文本在这里 trim/NFC，金额直接消费
 * MoneyInput 纯校验结果；不使用 number，避免 DECIMAL 精度丢失。
 */
export function buildCreateProductRequest(
  model: ProductCreateFormModel,
  precisions: ProductCreateMoneyPrecisions,
): BuildCreateProductRequestResult {
  const fieldErrors: Record<string, string> = {}
  const name = addTextError(fieldErrors, 'name', model.name, 128, '产品名称')
  if (!PRODUCT_STATUSES.has(model.status)) {
    fieldErrors.status = '产品状态不在白名单内'
  }

  const supplierValue = model.supplierValue === null
    ? null
    : model.supplierValue.trim()
  if (supplierValue !== null) {
    const supplierLength = codePointLength(supplierValue)
    if (supplierLength === 0 || supplierLength > 64) {
      fieldErrors.supplierValue = '请选择有效供应商'
    }
  }
  if (model.status === 'ACTIVE' && supplierValue === null) {
    fieldErrors.supplierValue = '启用产品必须选择供应商'
  }

  const twdSalePriceAmount = normalizeMoney(
    fieldErrors,
    'twdSalePrice.amount',
    model.twdSalePriceAmount,
    precisions.twdSalePricePrecision,
  )
  const myrSalePriceAmount = normalizeMoney(
    fieldErrors,
    'myrSalePrice.amount',
    model.myrSalePriceAmount,
    precisions.myrSalePricePrecision,
  )
  const purchaseCostAmount = normalizeMoney(
    fieldErrors,
    'purchaseCost.amount',
    model.purchaseCostAmount,
    precisions.purchaseCostPrecision,
  )
  if (!CURRENCY_CODE_PATTERN.test(model.purchaseCostCurrency)) {
    fieldErrors['purchaseCost.currency'] = '请选择有效货币'
  }

  if (model.attributes.length > 50) {
    fieldErrors.attributes = '产品属性不能超过 50 项'
  }
  const attributes = model.attributes.map((attribute, index) => ({
    title: addTextError(
      fieldErrors,
      `attributes.${index}.title`,
      attribute.title,
      64,
      '属性标题',
    ),
    value: addTextError(
      fieldErrors,
      `attributes.${index}.value`,
      attribute.value,
      512,
      '属性值',
    ),
  }))

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors: Object.freeze(fieldErrors), valid: false }
  }

  return {
    request: {
      attributes,
      myrSalePrice: { amount: myrSalePriceAmount, currency: 'MYR' },
      name,
      purchaseCost: {
        amount: purchaseCostAmount,
        currency: model.purchaseCostCurrency,
      },
      status: model.status,
      supplierValue,
      twdSalePrice: { amount: twdSalePriceAmount, currency: 'TWD' },
    },
    valid: true,
  }
}

/** HTTP body 仍是不可信输入；未知字段路径只降级为表单级错误。 */
export function getProductCreateApiFailure(error: unknown): ProductCreateApiFailure {
  const fallback: ProductCreateApiFailure = {
    code: undefined,
    fieldErrors: {},
    hasUnmappedFieldErrors: false,
    message: DEFAULT_FAILURE_MESSAGE,
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

    const status = typeof error.status === 'number' ? error.status : undefined
    const body = isRecord(error.body) ? error.body : undefined
    const fieldErrors: Record<string, string> = {}
    let hasUnmappedFieldErrors = false
    if (isRecord(body?.fieldErrors)) {
      for (const [field, messages] of Object.entries(body.fieldErrors)) {
        const message = readFirstMessage(messages)
        if (message === undefined) {
          continue
        }
        if (isAllowedFieldPath(field)) {
          fieldErrors[field] = message
        }
        else {
          hasUnmappedFieldErrors = true
        }
      }
    }

    return {
      code: typeof body?.code === 'string' ? body.code : undefined,
      fieldErrors: Object.freeze(fieldErrors),
      hasUnmappedFieldErrors,
      message: typeof body?.message === 'string'
        ? body.message
        : typeof error.message === 'string'
          ? error.message
          : DEFAULT_FAILURE_MESSAGE,
      requestId: typeof body?.requestId === 'string'
        ? body.requestId
        : typeof error.requestId === 'string'
          ? error.requestId
          : undefined,
      unknownResult: status === undefined || status >= 500,
    }
  }
  catch {
    return fallback
  }
}

export function createProductCreateSubmissionState(): ProductCreateEditingState {
  return Object.freeze({ phase: 'editing' })
}

export function beginProductCreateSubmission(
  state: ProductCreateEditingState,
  request: CreateProductRequestDto,
  context: { readonly authEpoch: number, readonly requestVersion: number },
  keyFactory: () => string = () => crypto.randomUUID().toLowerCase(),
): ProductCreateSubmittingState {
  if (state.phase !== 'editing') {
    throw new TypeError('只有编辑状态可以开始新提交')
  }
  return Object.freeze({
    authEpoch: context.authEpoch,
    idempotencyKey: keyFactory(),
    phase: 'submitting',
    requestVersion: context.requestVersion,
    snapshot: cloneAndFreezeRequest(request),
  })
}

export function resolveProductCreateFailure(
  state: ProductCreateSubmittingState,
  failure: ProductCreateApiFailure,
): ProductCreateEditingState | ProductCreateUnknownState {
  if (!failure.unknownResult) {
    // 明确 4xx 结果不保留 Key/snapshot，下次有效提交必须生成新 Key。
    return Object.freeze({ failure, phase: 'editing' })
  }
  return Object.freeze({
    authEpoch: state.authEpoch,
    failure,
    idempotencyKey: state.idempotencyKey,
    phase: 'unknown',
    requestVersion: state.requestVersion,
    snapshot: state.snapshot,
  })
}

export function replayUnknownProductCreate(
  state: ProductCreateUnknownState,
  context: { readonly authEpoch: number, readonly requestVersion: number },
): ProductCreateSubmittingState {
  if (state.phase !== 'unknown' || context.authEpoch !== state.authEpoch) {
    throw new TypeError('身份域变化后不能重放旧的产品创建请求')
  }
  return Object.freeze({
    authEpoch: state.authEpoch,
    idempotencyKey: state.idempotencyKey,
    phase: 'submitting',
    requestVersion: context.requestVersion,
    snapshot: state.snapshot,
  })
}

export function abandonUnknownProductCreate(
  state: ProductCreateUnknownState,
): ProductCreateEditingState {
  if (state.phase !== 'unknown') {
    throw new TypeError('只有结果未知的请求可以显式放弃')
  }
  return createProductCreateSubmissionState()
}

export function resolveProductCreateSuccess(
  state: ProductCreateSubmittingState,
  product: ProductListItemDto,
): ProductCreateSuccessState {
  if (state.phase !== 'submitting') {
    throw new TypeError('只有提交中状态可以进入成功')
  }
  return Object.freeze({ phase: 'success', product })
}

export function canApplyProductCreateResponse(
  input: ProductCreateResponseGuardInput,
): boolean {
  return !input.aborted
    && input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}
