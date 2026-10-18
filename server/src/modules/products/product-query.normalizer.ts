import { ApiException } from '../../infrastructure/http/api.exception'
import { ProductStatus } from '../../generated/prisma/enums'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAXIMUM_PAGE_SIZE = 100
const MAXIMUM_KEYWORD_LENGTH = 128
const MAXIMUM_SUPPLIER_VALUE_LENGTH = 64
const PRODUCT_STATUS_VALUES = new Set<unknown>(Object.values(ProductStatus))

export interface NormalizedProductListQuery {
  readonly page: number
  readonly pageSize: number
  readonly skip: number
  readonly categoryName?: string
  readonly keyword?: string
  readonly productHeadName?: string
  readonly status?: ProductStatus
  readonly supplierValue?: string
}

/**
 * HTTP DTO 已提供第一层校验，但 Service 的导出方法仍可能被测试或内部调用。
 * 这里保留第二层 fail-closed 边界，并且绝不 trim 历史供应商 raw value。
 */
export function normalizeProductListQuery(
  input: unknown,
): NormalizedProductListQuery {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throwValidationError()
  }

  const query = input as Readonly<Record<string, unknown>>
  const page = query.page ?? DEFAULT_PAGE
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
  const rawKeyword = query.keyword
  const status = query.status
  const supplierValue = query.supplierValue
  const categoryName = query.categoryName
  const productHeadName = query.productHeadName
  const keyword = typeof rawKeyword === 'string'
    ? rawKeyword.trim()
    : rawKeyword

  if (
    !Number.isSafeInteger(page)
    || (page as number) < 1
    || !Number.isSafeInteger(pageSize)
    || (pageSize as number) < 1
    || (pageSize as number) > MAXIMUM_PAGE_SIZE
    || (
      keyword !== undefined
      && (
        typeof keyword !== 'string'
        || keyword.length === 0
        || Array.from(keyword).length > MAXIMUM_KEYWORD_LENGTH
      )
    )
    || (
      status !== undefined
      && !PRODUCT_STATUS_VALUES.has(status)
    )
    || (
      supplierValue !== undefined
      && (
        typeof supplierValue !== 'string'
        || supplierValue.trim().length === 0
        || Array.from(supplierValue).length > MAXIMUM_SUPPLIER_VALUE_LENGTH
      )
    )
    || (
      categoryName !== undefined
      && (
        typeof categoryName !== 'string'
        || categoryName.trim().length === 0
        || Array.from(categoryName).length > MAXIMUM_SUPPLIER_VALUE_LENGTH
      )
    )
    || (
      productHeadName !== undefined
      && (
        typeof productHeadName !== 'string'
        || productHeadName.trim().length === 0
        || Array.from(productHeadName).length > MAXIMUM_SUPPLIER_VALUE_LENGTH
      )
    )
  ) {
    throwValidationError()
  }

  const normalizedPage = page as number
  const normalizedPageSize = pageSize as number
  const skip = (normalizedPage - 1) * normalizedPageSize
  if (!Number.isSafeInteger(skip)) throwValidationError()

  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    skip,
    ...(keyword === undefined ? {} : { keyword }),
    ...(status === undefined ? {} : { status: status as ProductStatus }),
    ...(supplierValue === undefined ? {} : { supplierValue }),
    ...(categoryName === undefined ? {} : { categoryName }),
    ...(productHeadName === undefined ? {} : { productHeadName }),
  }
}

function throwValidationError(): never {
  throw new ApiException(
    422,
    'VALIDATION_FAILED',
    '请求参数校验失败',
  )
}
