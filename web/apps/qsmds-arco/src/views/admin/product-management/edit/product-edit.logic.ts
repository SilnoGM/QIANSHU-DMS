import type {
  ProductFieldErrors,
  ProductFormModel,
  ProductMoneyPrecisions,
} from '../form/product-form.logic'
import type {
  ProductListItemDto,
  UpdateProductRequestDto,
} from '@/api/generated/types.gen'

import { getProductCreateApiFailure } from '../create/product-create.logic'
import {
  buildProductFormRequest,
  createProductAttributeRow,
} from '../form/product-form.logic'

export type BuildProductUpdateRequestResult
  = | {
    readonly fieldErrors: ProductFieldErrors
    readonly valid: false
  }
  | {
    readonly request: UpdateProductRequestDto
    readonly valid: true
  }
  | {
    readonly unchanged: true
    readonly valid: true
  }

export interface ProductUpdateFailure {
  readonly code: string | undefined
  readonly fieldErrors: ProductFieldErrors
  readonly message: string
  readonly phase: 'conflict' | 'editing' | 'reconciling'
  readonly requestId: string | undefined
}

export function createProductEditFormModel(
  product: ProductListItemDto,
  keyFactory: () => string = () => crypto.randomUUID(),
): ProductFormModel {
  return {
    attributes: product.attributes.map(attribute => createProductAttributeRow(
      keyFactory(),
      attribute.title,
      attribute.value,
    )),
    myrSalePriceAmount: product.myrSalePrice.amount,
    name: product.name,
    purchaseCostAmount: product.purchaseCost.amount,
    purchaseCostCurrency: product.purchaseCost.currency,
    status: product.status,
    // 详情 DTO 的 supplier.value 是稳定身份；未知/停用历史值也必须原样回填。
    supplierValue: product.supplier?.value ?? null,
    twdSalePriceAmount: product.twdSalePrice.amount,
  }
}

function businessSnapshot(
  model: ProductFormModel,
  precisions: ProductMoneyPrecisions,
) {
  return buildProductFormRequest(model, precisions)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * 编辑只发送规范化后真实变化的业务字段；`expectedVersion` 始终来自本次 GET
 * 快照。空差异不会制造 PATCH，也不会依赖 Server no-op 作为日常控制流。
 */
export function buildProductUpdateRequest(
  model: ProductFormModel,
  source: ProductListItemDto,
  precisions: ProductMoneyPrecisions,
): BuildProductUpdateRequestResult {
  const current = businessSnapshot(model, precisions)
  if (!current.valid) {
    return current
  }

  const baseline = businessSnapshot(
    createProductEditFormModel(source),
    precisions,
  )
  if (!baseline.valid) {
    // Server 返回的详情无法通过同一字段契约时，页面必须失败关闭而不是提交猜测值。
    return {
      fieldErrors: { form: '产品详情与当前表单规则不兼容，请刷新后重试' },
      valid: false,
    }
  }

  const request: UpdateProductRequestDto = {
    expectedVersion: source.version,
  }
  const currentBody = current.request
  const baselineBody = baseline.request
  if (currentBody.name !== baselineBody.name) {
    request.name = currentBody.name
  }
  if (currentBody.status !== baselineBody.status) {
    request.status = currentBody.status
  }
  if (currentBody.supplierValue !== baselineBody.supplierValue) {
    request.supplierValue = currentBody.supplierValue
  }
  if (!sameValue(currentBody.twdSalePrice, baselineBody.twdSalePrice)) {
    request.twdSalePrice = currentBody.twdSalePrice
  }
  if (!sameValue(currentBody.myrSalePrice, baselineBody.myrSalePrice)) {
    request.myrSalePrice = currentBody.myrSalePrice
  }
  if (!sameValue(currentBody.purchaseCost, baselineBody.purchaseCost)) {
    request.purchaseCost = currentBody.purchaseCost
  }
  if (!sameValue(currentBody.attributes, baselineBody.attributes)) {
    request.attributes = currentBody.attributes
  }

  return Object.keys(request).length === 1
    ? { unchanged: true, valid: true }
    : { request, valid: true }
}

export function hasProductEditChanges(
  model: ProductFormModel,
  source: ProductListItemDto,
  precisions: ProductMoneyPrecisions,
): boolean {
  const result = buildProductUpdateRequest(model, source, precisions)
  return !result.valid || !('unchanged' in result)
}

/** PATCH 错误复用字段白名单解析，再按并发与结果未知语义分流。 */
export function getProductUpdateFailure(error: unknown): ProductUpdateFailure {
  const failure = getProductCreateApiFailure(error)
  return {
    code: failure.code,
    fieldErrors: failure.fieldErrors,
    message: failure.message,
    phase: failure.code === 'PRODUCT_STATE_CHANGED'
      ? 'conflict'
      : failure.unknownResult
        ? 'reconciling'
        : 'editing',
    requestId: failure.requestId,
  }
}

function canonicalDecimal(value: string | null): string | null {
  if (value === null) {
    return null
  }
  const [integer = '', fraction = ''] = value.split('.')
  const trimmed = fraction.replace(/0+$/u, '')
  return trimmed === '' ? integer : `${integer}.${trimmed}`
}

function moneyMatches(
  actual: ProductListItemDto['purchaseCost'],
  expected: NonNullable<UpdateProductRequestDto['purchaseCost']>,
): boolean {
  return actual.currency === expected.currency
    && canonicalDecimal(actual.amount) === canonicalDecimal(expected.amount)
}

/**
 * PATCH 网络/5xx 后只读 GET 对账。仅 version 精确前进一次且每个已提交字段匹配
 * 才可宣告成功；任何他人后续写入或内容差异都保持 unknown，绝不自动重放 PATCH。
 */
export function reconcileProductUpdateResult(
  request: Readonly<UpdateProductRequestDto>,
  actual: ProductListItemDto,
): 'success' | 'unknown' {
  if (actual.version !== request.expectedVersion + 1) {
    return 'unknown'
  }
  if (request.name !== undefined && actual.name !== request.name) {
    return 'unknown'
  }
  if (request.status !== undefined && actual.status !== request.status) {
    return 'unknown'
  }
  if (
    request.supplierValue !== undefined
    && (actual.supplier?.value ?? null) !== request.supplierValue
  ) {
    return 'unknown'
  }
  if (
    request.twdSalePrice !== undefined
    && !moneyMatches(actual.twdSalePrice, request.twdSalePrice)
  ) {
    return 'unknown'
  }
  if (
    request.myrSalePrice !== undefined
    && !moneyMatches(actual.myrSalePrice, request.myrSalePrice)
  ) {
    return 'unknown'
  }
  if (
    request.purchaseCost !== undefined
    && !moneyMatches(actual.purchaseCost, request.purchaseCost)
  ) {
    return 'unknown'
  }
  if (
    request.attributes !== undefined
    && !sameValue(actual.attributes, request.attributes)
  ) {
    return 'unknown'
  }
  return 'success'
}
