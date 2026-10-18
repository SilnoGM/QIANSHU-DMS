export type ProductSelectorCurrency = 'CNY' | 'MYR' | 'TWD'

export interface ProductSelectorQuery {
  readonly currencyCode: ProductSelectorCurrency
  readonly keyword?: string
  readonly supplierValue?: string
  readonly categoryName?: string
  readonly unclassified?: boolean
  readonly page: number
  readonly pageSize: number
}

export interface ProductSelectorItem {
  readonly id: string
  readonly productNo: string
  readonly name: string
  readonly categoryName: string | null
  readonly productHeadName: string | null
  readonly supplierValue: string | null
  readonly attributes: readonly Record<string, unknown>[]
  readonly standardUnitPriceAmount: string | null
  readonly currencyCode: ProductSelectorCurrency
  readonly mainImage: null | {
    readonly id: string
    readonly contentUrl: string
  }
}

export interface ProductSelectorCategoryFacet {
  readonly name: string
  readonly count: number
}

export interface ProductSelectorPage {
  readonly items: readonly ProductSelectorItem[]
  readonly categories: readonly ProductSelectorCategoryFacet[]
  readonly unclassifiedCount: number
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export type ProductSelectorCategoryFilter
  = | { readonly kind: 'all' }
    | { readonly kind: 'unclassified' }
    | { readonly kind: 'category', readonly name: string }

export interface ProductSelectorGroup {
  readonly key: string
  readonly categoryName: string | null
  readonly productHeadName: string | null
  readonly items: readonly ProductSelectorItem[]
}

export interface ExistingCatalogLine {
  readonly key: string
  readonly productId: string
  readonly productNo: string
  readonly name: string
  readonly quantity: string
  readonly supplierValue?: string | null
}

export type ProductIncrementCandidate
  = | {
    readonly kind: 'ADD'
    readonly lineKey: null
    readonly productId: string
  }
  | {
    readonly kind: 'EXISTING'
    readonly lineKey: string
    readonly productId: string
  }

export interface SelectedProductItem {
  readonly origin: 'ADDED' | 'EXISTING'
  readonly productId: string
  readonly productNo: string
  readonly name: string
  readonly quantity: string
  readonly supplierValue: string | null
}

export interface SelectedProductGroup {
  readonly key: string
  readonly supplierValue: string | null
  readonly items: readonly SelectedProductItem[]
}

export type ProductSelectionChange
  = | {
    readonly kind: 'ADD'
    readonly product: ProductSelectorItem
    readonly quantity: number
  }
  | {
    readonly kind: 'INCREMENT'
    readonly lineKey: string
    readonly productId: string
    readonly delta: number
  }
  | {
    readonly kind: 'REMOVE'
    readonly lineKey: string
    readonly productId: string
  }

export type ProductPageLoader = (
  query: ProductSelectorQuery,
  signal: AbortSignal,
) => Promise<ProductSelectorPage>
