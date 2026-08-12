import type {
  ProductActorDto,
  ProductAttributeDto,
  ProductListItemDto,
  ProductMoneyDto,
  ProductPageDto,
  ProductsListData,
  ProductSupplierDto,
} from '@/api/generated/types.gen'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import type {
  QsGenericTableFilterOption,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'
import type {
  DictionaryCatalog,
  DictionaryCatalogTone,
} from '@/dictionary-catalog/types'

type ProductListQuery = NonNullable<ProductsListData['query']>

/**
 * generated OpenAPI 3 nullable enum 当前不会把 null 写进 TS union；页面 view model
 * 显式恢复 Server 契约的运行时事实，但仍复用 generated DTO 的其余字段。
 */
export type ProductSupplierViewModel = Omit<ProductSupplierDto, 'tone'> & {
  readonly tone: DictionaryCatalogTone | null
}

export type ProductListItemViewModel = Omit<
  ProductListItemDto,
  'attributes' | 'createdBy' | 'images' | 'supplier' | 'updatedBy' | 'videos'
> & {
  readonly attributes: readonly ProductAttributeDto[]
  readonly createdBy: ProductActorDto | null
  readonly images: readonly string[]
  readonly supplier: ProductSupplierViewModel | null
  readonly updatedBy: ProductActorDto | null
  readonly videos: readonly string[]
}

export type ProductPageViewModel = Omit<ProductPageDto, 'items'> & {
  readonly items: readonly ProductListItemViewModel[]
}

export interface ProductListResponseGuardInput {
  readonly aborted: boolean
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly latestRequestVersion: number
  readonly requestVersion: number
}

export interface ProductListApiFailure {
  readonly message: string
  readonly requestId: string | undefined
}

const ALLOWED_PAGE_SIZES = new Set([20, 50, 100])

function cloneMoney(value: ProductMoneyDto): ProductMoneyDto {
  return { amount: value.amount, currency: value.currency }
}

function cloneActor(value: ProductActorDto | null): ProductActorDto | null {
  return value === null
    ? null
    : { displayName: value.displayName, id: value.id }
}

function adaptProductListItem(
  value: ProductListItemDto,
): ProductListItemViewModel {
  const supplier = value.supplier === null
    ? null
    : {
        label: value.supplier.label,
        state: value.supplier.state,
        // `?? null` 同时兼容 generated 类型与 Server UNKNOWN 的真实 null。
        tone: value.supplier.tone ?? null,
        value: value.supplier.value,
      }

  return {
    ...value,
    attributes: value.attributes.map(attribute => ({ ...attribute })),
    createdBy: cloneActor(value.createdBy),
    images: [...value.images],
    myrSalePrice: cloneMoney(value.myrSalePrice),
    purchaseCost: cloneMoney(value.purchaseCost),
    supplier,
    twdSalePrice: cloneMoney(value.twdSalePrice),
    updatedBy: cloneActor(value.updatedBy),
    videos: [...value.videos],
  }
}

/** 只读 adapter 不把 decimal 交给 number，也不排序媒体、属性或列表。 */
export function adaptProductPageDto(
  value: ProductPageDto,
): ProductPageViewModel {
  return {
    items: value.items.map(adaptProductListItem),
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
  }
}

export function buildProductListQuery(input: {
  readonly filters: QsGenericTableFilterValues
  readonly page: number
  readonly pageSize: number
}): ProductListQuery {
  const supplierValue = typeof input.filters.supplierValue === 'string'
    && input.filters.supplierValue.trim() !== ''
    ? input.filters.supplierValue
    : undefined

  return {
    page: Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1,
    pageSize: ALLOWED_PAGE_SIZES.has(input.pageSize) ? input.pageSize : 20,
    ...(supplierValue === undefined ? {} : { supplierValue }),
  }
}

/** 应用或清空供应商条件都回到第一页；stable value 不做 trim。 */
export function applyProductSupplierFilter(
  current: QsGenericTableFilterValues,
  supplierValue: string | undefined,
): { readonly filters: QsGenericTableFilterValues, readonly page: 1 } {
  const filters = { ...current }
  if (supplierValue === undefined || supplierValue.trim() === '') {
    delete filters.supplierValue
  }
  else {
    filters.supplierValue = supplierValue
  }
  return { filters, page: 1 }
}

/** 筛选既能选择当前有效值，也能解释并筛选已停用的历史已知值。 */
export function buildSupplierFilterOptions(
  catalog: DictionaryCatalog | null,
): readonly QsGenericTableFilterOption[] {
  if (catalog === null) {
    return []
  }
  return catalog.items.map(item => ({
    label: item.effectiveEnabled ? item.label : `${item.label}（已停用）`,
    value: item.value,
  }))
}

function buildImageItem(
  product: ProductListItemViewModel,
  src: string,
  kind: 'image' | 'main',
  sourceIndex: number,
): ImageGroupItem {
  const label = kind === 'main'
    ? `${product.name}主图`
    : `${product.name}图片 ${sourceIndex + 1}`
  return {
    alt: label,
    key: kind === 'main'
      ? `${product.id}-main`
      : `${product.id}-image-${sourceIndex}`,
    src,
    tooltip: label,
  }
}

export function buildProductMainImageItems(
  product: ProductListItemViewModel,
): readonly ImageGroupItem[] {
  return product.mainImage === null || product.mainImage.trim() === ''
    ? []
    : [buildImageItem(product, product.mainImage, 'main', 0)]
}

export function buildProductImageItems(
  product: ProductListItemViewModel,
): readonly ImageGroupItem[] {
  return product.images.flatMap((src, sourceIndex) =>
    src.trim() === ''
      ? []
      : [buildImageItem(product, src, 'image', sourceIndex)])
}

export function canApplyProductListResponse(
  input: ProductListResponseGuardInput,
): boolean {
  return !input.aborted
    && input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isProductListAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    isRecord(error) && (
      error.code === 'ERR_CANCELED'
      || error.name === 'CanceledError'
    )
  )
}

/** Axios 失败仍是不可信输入；列表页只提取允许公开的 message/requestId。 */
export function getProductListApiFailure(
  error: unknown,
): ProductListApiFailure {
  if (!isRecord(error)) {
    return { message: '请求失败，请稍后重试', requestId: undefined }
  }
  const body = isRecord(error.body) ? error.body : undefined
  return {
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
  }
}
