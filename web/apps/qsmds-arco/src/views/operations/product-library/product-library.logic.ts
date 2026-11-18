import type { ProductsListData, ProductTaxonomyTreeDto } from '../../../api/generated/types.gen'
import type { DictionaryCatalog } from '../../../dictionary-catalog/types'
import type { ProductListItemViewModel } from '../../admin/product-management/list/product-list.logic'
import { resolveProductMediaContentUrl } from '../../../api/modules/product-media'

export const PRODUCT_LIBRARY_PAGE_SIZES = [24, 48, 96] as const
export const PRODUCT_LIBRARY_DEFAULT_PAGE_SIZE = 24
export const PRODUCT_LIBRARY_ALIAS_MAX_CODE_POINTS = 36

export type ProductLibraryStatusFilter = 'ACTIVE' | 'ALL' | 'INACTIVE'

export interface ProductLibraryFilters {
  readonly keyword: string
  readonly status: ProductLibraryStatusFilter
  readonly supplierValue?: string
  readonly categoryId?: string
  readonly productHeadId?: string
}

export interface ProductLibrarySelectOption {
  readonly value: string
  readonly label: string
}

type ProductListQuery = NonNullable<ProductsListData['query']>

export function buildProductLibraryQuery(
  filters: ProductLibraryFilters,
  page: number,
  pageSize: number,
): ProductListQuery {
  const keyword = filters.keyword.trim()
  return {
    page,
    pageSize,
    ...(keyword ? { keyword } : {}),
    ...(filters.status === 'ALL' ? {} : { status: filters.status }),
    ...(filters.supplierValue ? { supplierValue: filters.supplierValue } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.productHeadId ? { productHeadId: filters.productHeadId } : {}),
  }
}

export function buildSupplierOptions(
  catalog: DictionaryCatalog | null,
): readonly ProductLibrarySelectOption[] {
  return catalog?.items.map(item => ({ value: item.value, label: item.label })) ?? []
}

export function buildCategoryOptions(
  tree: ProductTaxonomyTreeDto | null,
  supplierValue: string | undefined,
  supplierLabelByValue: ReadonlyMap<string, string>,
): readonly ProductLibrarySelectOption[] {
  return tree?.suppliers.flatMap(supplier => (
    supplierValue && supplier.supplierValue !== supplierValue
      ? []
      : supplier.categories.map(category => ({
          value: category.id,
          label: `${supplierLabelByValue.get(supplier.supplierValue) ?? supplier.supplierValue} · ${category.name}`,
        }))
  )) ?? []
}

export function buildProductHeadOptions(
  tree: ProductTaxonomyTreeDto | null,
  categoryId: string | undefined,
): readonly ProductLibrarySelectOption[] {
  if (!categoryId) {
    return []
  }
  const category = tree?.suppliers
    .flatMap(supplier => supplier.categories)
    .find(item => item.id === categoryId)
  return category?.productHeads.map(head => ({ value: head.id, label: head.name })) ?? []
}

/** 卡片只加载缩略图；原图在详情抽屉中读取。 */
export function buildProductLibraryThumbnailUrl(product: ProductListItemViewModel): string | null {
  const mainImage = product.media.mainImage
  if (mainImage === null) {
    return null
  }
  const url = resolveProductMediaContentUrl(product.id, mainImage)
  return url === null ? null : `${url}?variant=thumb`
}

export function normalizeProductLibraryAlias(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function validateProductLibraryAlias(value: string): string | null {
  // 控制字符和 × 必须在归一化前拒绝，否则换行会被折叠成空格而静默通过。
  if (/[\p{Cc}×]/u.test(value)) {
    return '别名不能包含换行、控制字符或 ×'
  }
  const normalized = normalizeProductLibraryAlias(value)
  if (!normalized) {
    return '请输入别名，或使用“清除别名”回退产品名'
  }
  if (Array.from(normalized).length > PRODUCT_LIBRARY_ALIAS_MAX_CODE_POINTS) {
    return `别名最多 ${PRODUCT_LIBRARY_ALIAS_MAX_CODE_POINTS} 个字符`
  }
  return null
}

export function productLibraryAliasLabel(alias: string | null | undefined): string {
  const normalized = alias?.trim()
  return normalized || '使用产品名'
}

export function productLibraryStatusLabel(status: ProductListItemViewModel['status']): string {
  return status === 'ACTIVE' ? '启用' : '停用'
}
