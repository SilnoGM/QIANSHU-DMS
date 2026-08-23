export type ProductSelectorCurrency = 'MYR' | 'TWD'

export interface ProductSelectorQuery {
  readonly currencyCode: ProductSelectorCurrency
  readonly keyword?: string
  readonly supplierValue?: string
  readonly page: number
  readonly pageSize: number
}

export interface ProductSelectorItem {
  readonly id: string
  readonly productNo: string
  readonly name: string
  readonly supplierValue: string | null
  readonly attributes: readonly Record<string, unknown>[]
  readonly standardUnitPriceAmount: string
  readonly currencyCode: ProductSelectorCurrency
  readonly mainImage: null | {
    readonly id: string
    readonly contentUrl: string
  }
}

export interface ProductSelectorPage {
  readonly items: readonly ProductSelectorItem[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface ExistingCatalogLine {
  readonly key: string
  readonly productId: string
  readonly productNo: string
  readonly name: string
  readonly quantity: string
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
