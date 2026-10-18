import type {
  ProductAttributeRow,
  ProductFieldErrors,
  ProductFormModel,
  ProductFormStatus,
  ProductMoneyPrecisions,
} from '../form/product-form.logic'
import type {
  CreateProductRequestDto,
  ProductListItemDto,
} from '@/api/generated/types.gen'

import {
  appendProductAttribute,
  buildProductFormRequest,
  createProductAttributeRow,
  createProductFormModel,
  hasProductFormChanges,
  MAX_PRODUCT_ATTRIBUTES,
  moveProductAttribute,
  removeProductAttribute,
  updateProductAttribute,
} from '../form/product-form.logic'

export type ProductCreateStatus = ProductFormStatus
export type ProductCreateAttributeRow = ProductAttributeRow
export type ProductCreateFormModel = ProductFormModel
export type ProductCreateMoneyPrecisions = ProductMoneyPrecisions
export type ProductCreateFieldErrors = ProductFieldErrors
export {
  appendProductAttribute,
  createProductAttributeRow,
  MAX_PRODUCT_ATTRIBUTES,
  moveProductAttribute,
  removeProductAttribute,
  updateProductAttribute,
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

const ATTRIBUTE_FIELD_PATTERN = /^attributes\.(?:\d|[1-4]\d)\.(?:title|value)$/u
const SIMPLE_FIELD_PATHS = new Set([
  'idempotencyKey',
  'categoryName',
  'myrSalePrice.amount',
  'myrSalePrice.currency',
  'name',
  'productHeadName',
  'purchaseCost.amount',
  'purchaseCost.currency',
  'status',
  'supplierValue',
  'twdSalePrice.amount',
  'twdSalePrice.currency',
])
const DEFAULT_FAILURE_MESSAGE = '操作失败，请稍后重试'

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

function cloneAndFreezeRequest(
  request: CreateProductRequestDto,
): Readonly<CreateProductRequestDto> {
  const attributes = request.attributes.map(attribute =>
    Object.freeze({ title: attribute.title, value: attribute.value }))
  return Object.freeze({
    attributes: Object.freeze(attributes),
    categoryName: request.categoryName,
    myrSalePrice: Object.freeze({ ...request.myrSalePrice }),
    name: request.name,
    productHeadName: request.productHeadName,
    purchaseCost: Object.freeze({ ...request.purchaseCost }),
    status: request.status,
    supplierValue: request.supplierValue,
    twdSalePrice: Object.freeze({ ...request.twdSalePrice }),
  }) as Readonly<CreateProductRequestDto>
}

export function createProductCreateFormModel(): ProductCreateFormModel {
  return createProductFormModel()
}

export function hasProductCreateChanges(model: ProductCreateFormModel): boolean {
  return hasProductFormChanges(model)
}

/**
 * 表单转输契约的唯一边界。文本在这里 trim/NFC，金额直接消费
 * MoneyInput 纯校验结果；不使用 number，避免 DECIMAL 精度丢失。
 */
export function buildCreateProductRequest(
  model: ProductCreateFormModel,
  precisions: ProductCreateMoneyPrecisions,
) {
  const result = buildProductFormRequest(model, precisions, {
    requireTaxonomy: true,
  })
  if (!result.valid) {
    return result
  }
  // requireTaxonomy 已在表单边界保证非空；这里把内部可空形状收窄为创建契约。
  return {
    request: {
      ...result.request,
      categoryName: result.request.categoryName as string,
      productHeadName: result.request.productHeadName as string,
    },
    valid: true as const,
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

export function isProductCreateAbortError(error: unknown): boolean {
  try {
    return (
      error instanceof DOMException
      && error.name === 'AbortError'
    ) || (
      isRecord(error)
      && (
        error.code === 'ERR_CANCELED'
        || error.name === 'CanceledError'
      )
    )
  }
  catch {
    return false
  }
}
