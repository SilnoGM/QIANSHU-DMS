import type {
  ProductActorDto,
  ProductAttributeDto,
  ProductListItemDto,
  ProductMediaDto,
  ProductMediaItemDto,
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
import { resolveProductMediaContentUrl } from '../../../../api/modules/product-media'

type ProductListQuery = NonNullable<ProductsListData['query']>
type ProductListStatus = NonNullable<ProductListQuery['status']>

const PRODUCT_LIST_STATUSES = new Set<unknown>(['ACTIVE', 'INACTIVE'])

/**
 * generated OpenAPI 3 nullable enum 当前不会把 null 写进 TS union；页面 view model
 * 显式恢复 Server 契约的运行时事实，但仍复用 generated DTO 的其余字段。
 */
export type ProductSupplierViewModel = Omit<ProductSupplierDto, 'tone'> & {
  readonly tone: DictionaryCatalogTone | null
}

export type ProductListItemViewModel = Omit<
  ProductListItemDto,
  'attributes' | 'createdBy' | 'media' | 'supplier' | 'updatedBy'
> & {
  readonly attributes: readonly ProductAttributeDto[]
  readonly createdBy: ProductActorDto | null
  readonly media: ProductMediaViewModel
  readonly supplier: ProductSupplierViewModel | null
  readonly updatedBy: ProductActorDto | null
}

export type ProductMediaItemViewModel = Readonly<ProductMediaItemDto>

export type ProductMediaViewModel = Omit<
  ProductMediaDto,
  'images' | 'mainImage' | 'videos'
> & {
  readonly images: readonly ProductMediaItemViewModel[]
  readonly mainImage: ProductMediaItemViewModel | null
  readonly videos: readonly ProductMediaItemViewModel[]
}

export { resolveProductMediaContentUrl }

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
  readonly code: string | undefined
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
    : { displayName: value.displayName, id: value.id, avatarUrl: value.avatarUrl }
}

function cloneMediaItem(
  value: ProductMediaItemDto,
): ProductMediaItemViewModel {
  return { ...value }
}

/**
 * DTO 中的 mainImage 是 images 主图项的投影，二者在 JSON 中仍是独立对象。
 * Adapter 逐项复制，避免页面状态意外改写 Axios response 或共享数组。
 */
function cloneMedia(value: ProductMediaDto): ProductMediaViewModel {
  return {
    images: value.images.map(cloneMediaItem),
    mainImage: value.mainImage === null
      ? null
      : cloneMediaItem(value.mainImage),
    videos: value.videos.map(cloneMediaItem),
  }
}

export function adaptProductListItemDto(
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
    media: cloneMedia(value.media),
    myrSalePrice: cloneMoney(value.myrSalePrice),
    purchaseCost: cloneMoney(value.purchaseCost),
    supplier,
    twdSalePrice: cloneMoney(value.twdSalePrice),
    updatedBy: cloneActor(value.updatedBy),
  }
}

/** 只读 adapter 不把 decimal 交给 number，也不排序媒体、属性或列表。 */
export function adaptProductPageDto(
  value: ProductPageDto,
): ProductPageViewModel {
  return {
    items: value.items.map(adaptProductListItemDto),
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
  }
}

export function buildProductListQuery(input: {
  readonly filters: QsGenericTableFilterValues
  readonly page: number
  readonly pageSize: number
  readonly search: string
  readonly unclassified?: boolean
}): ProductListQuery {
  const keyword = input.search.trim()
  const status = PRODUCT_LIST_STATUSES.has(input.filters.status)
    ? input.filters.status as ProductListStatus
    : undefined
  const supplierValue = typeof input.filters.supplierValue === 'string'
    && input.filters.supplierValue.trim() !== ''
    ? input.filters.supplierValue
    : undefined
  const categoryId = input.unclassified === true
    ? undefined
    : typeof input.filters.categoryId === 'string'
      && input.filters.categoryId.trim() !== ''
      ? input.filters.categoryId
      : undefined
  const productHeadId = input.unclassified === true
    ? undefined
    : typeof input.filters.productHeadId === 'string'
      && input.filters.productHeadId.trim() !== ''
      ? input.filters.productHeadId
      : undefined

  return {
    page: Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1,
    pageSize: ALLOWED_PAGE_SIZES.has(input.pageSize) ? input.pageSize : 20,
    ...(keyword === '' ? {} : { keyword }),
    ...(status === undefined ? {} : { status }),
    ...(supplierValue === undefined ? {} : { supplierValue }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(productHeadId === undefined ? {} : { productHeadId }),
    ...(input.unclassified === true ? { unclassified: true } : {}),
  }
}

/** 应用或清空产品状态条件都回到第一页；DRAFT 已从状态域退役。 */
export function applyProductStatusFilter(
  current: QsGenericTableFilterValues,
  status: ProductListStatus | undefined,
): { readonly filters: QsGenericTableFilterValues, readonly page: 1 } {
  const filters = { ...current }
  if (status === undefined) {
    delete filters.status
  }
  else {
    filters.status = status
  }
  return { filters, page: 1 }
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
  media: ProductMediaItemViewModel,
  kind: 'image' | 'main',
  sourceIndex: number,
  contentReadable: boolean,
): ImageGroupItem | null {
  if (!contentReadable) {
    return null
  }
  const src = resolveProductMediaContentUrl(product.id, media)
  if (src === null) {
    return null
  }
  const label = kind === 'main'
    ? `${product.name}主图`
    : `${product.name}图片 ${sourceIndex + 1}`
  return {
    alt: label,
    key: media.id,
    src,
    tooltip: label,
  }
}

export function buildProductMainImageItems(
  product: ProductListItemViewModel,
  contentReadable: boolean,
): readonly ImageGroupItem[] {
  if (product.media.mainImage === null) {
    return []
  }
  const item = buildImageItem(
    product,
    product.media.mainImage,
    'main',
    0,
    contentReadable,
  )
  return item === null ? [] : [item]
}

export function buildProductImageItems(
  product: ProductListItemViewModel,
  contentReadable: boolean,
): readonly ImageGroupItem[] {
  return product.media.images.flatMap((media, sourceIndex) => {
    const item = buildImageItem(
      product,
      media,
      'image',
      sourceIndex,
      contentReadable,
    )
    return item === null ? [] : [item]
  })
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
    return {
      code: undefined,
      message: '请求失败，请稍后重试',
      requestId: undefined,
    }
  }
  const body = isRecord(error.body) ? error.body : undefined
  return {
    code: typeof body?.code === 'string' ? body.code : undefined,
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
