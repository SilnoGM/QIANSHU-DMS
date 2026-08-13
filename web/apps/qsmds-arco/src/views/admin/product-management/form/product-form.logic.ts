import type { CreateProductRequestDto } from '@/api/generated/types.gen'

import { validateMoneyString } from '../../../../components/base/MoneyInput/logic'

export type ProductFormStatus = CreateProductRequestDto['status']
export const MAX_PRODUCT_ATTRIBUTES = 50

export interface ProductAttributeRow {
  key: string
  title: string
  value: string
}

export interface ProductFormModel {
  attributes: ProductAttributeRow[]
  myrSalePriceAmount: string | null
  name: string
  purchaseCostAmount: string | null
  purchaseCostCurrency: string
  status: ProductFormStatus
  supplierValue: string | null
  twdSalePriceAmount: string | null
}

export interface ProductMoneyPrecisions {
  myrSalePricePrecision: number
  purchaseCostPrecision: number
  twdSalePricePrecision: number
}

export type ProductFieldErrors = Readonly<Record<string, string>>

export type BuildProductFormRequestResult
  = | {
    readonly request: CreateProductRequestDto
    readonly valid: true
  }
  | {
    readonly fieldErrors: ProductFieldErrors
    readonly valid: false
  }

const PRODUCT_STATUSES = new Set<ProductFormStatus>([
  'DRAFT',
  'ACTIVE',
  'INACTIVE',
])
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u
const MAXIMUM_AMOUNT_BY_PRECISION = Array.from({ length: 5 }, (_value, precision) =>
  `${'9'.repeat(26)}${precision === 0 ? '' : `.${'9'.repeat(precision)}`}`)

function codePointLength(value: string): number {
  return [...value].length
}

function normalizeText(value: string): string {
  return value.trim().normalize('NFC')
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

export function createProductFormModel(): ProductFormModel {
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
): ProductAttributeRow {
  return { key, title, value }
}

export function appendProductAttribute(
  rows: readonly ProductAttributeRow[],
  keyFactory: () => string = () => crypto.randomUUID(),
): ProductAttributeRow[] | readonly ProductAttributeRow[] {
  if (rows.length >= MAX_PRODUCT_ATTRIBUTES) {
    return rows
  }
  return [...rows, createProductAttributeRow(keyFactory())]
}

export function updateProductAttribute(
  rows: readonly ProductAttributeRow[],
  index: number,
  field: 'title' | 'value',
  value: string,
): ProductAttributeRow[] | readonly ProductAttributeRow[] {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
    return rows
  }
  return rows.map((row, rowIndex) => rowIndex === index
    ? { ...row, [field]: value }
    : row)
}

export function moveProductAttribute(
  rows: readonly ProductAttributeRow[],
  index: number,
  direction: 'down' | 'up',
): ProductAttributeRow[] | readonly ProductAttributeRow[] {
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (
    !Number.isInteger(index)
    || index < 0
    || index >= rows.length
    || targetIndex < 0
    || targetIndex >= rows.length
  ) {
    return rows
  }
  const next = [...rows]
  const source = next[index]
  const target = next[targetIndex]
  if (source === undefined || target === undefined) {
    return rows
  }
  next[index] = target
  next[targetIndex] = source
  return next
}

export function removeProductAttribute(
  rows: readonly ProductAttributeRow[],
  index: number,
): ProductAttributeRow[] | readonly ProductAttributeRow[] {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
    return rows
  }
  return rows.filter((_row, rowIndex) => rowIndex !== index)
}

export function hasProductFormChanges(model: ProductFormModel): boolean {
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
 * 表单到传输契约的唯一边界。文本在这里 trim/NFC，金额直接消费
 * MoneyInput 纯校验结果；不使用 number，避免 DECIMAL 精度丢失。
 */
export function buildProductFormRequest(
  model: ProductFormModel,
  precisions: ProductMoneyPrecisions,
): BuildProductFormRequestResult {
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

  if (model.attributes.length > MAX_PRODUCT_ATTRIBUTES) {
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
