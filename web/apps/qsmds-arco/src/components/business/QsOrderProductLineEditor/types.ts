import type { CurrencyDescriptor } from '../../base/currency'
import type {
  ProductPageLoader,
  ProductSelectorCurrency,
} from '../QsProductSelector/types'

export interface OrderProductLineModel {
  readonly key: string
  readonly lineType: 'CATALOG' | 'CUSTOM'
  readonly productId: string | null
  readonly productNo: string | null
  readonly name: string
  readonly description: string
  readonly standardUnitPriceAmount: string | null
  readonly actualUnitPriceAmount: string | null
  readonly quantity: string
  readonly mainImage: null | {
    readonly id: string
    readonly contentUrl: string
  }
}

/**
 * 仅用于展示来源订单中已经处理过的产品快照。
 *
 * 只读行与 `modelValue` 分离，组件不会将其计入金额、产品选择器状态或
 * `update:modelValue` 事件，避免历史业务数据被本次订单再次提交。
 */
export interface OrderProductLineReadOnlyModel {
  readonly key: string
  readonly lineType: 'CATALOG' | 'CUSTOM'
  readonly productNo: string | null
  readonly name: string
  readonly description: string
  readonly standardUnitPriceAmount: string
  readonly actualUnitPriceAmount: string
  readonly actualSubtotalAmount: string
  readonly quantity: string
  readonly statusLabel: string
  readonly statusDescription: string
  readonly mainImage: null | {
    readonly id: string
    readonly contentUrl: string
  }
}

export interface OrderProductLineLabels {
  readonly referenceUnitPrice: string
  readonly actualUnitPrice: string
  readonly actualSubtotal: string
  readonly referenceTotal: string
  readonly actualTotal: string
  readonly catalogProduct: string
  readonly temporaryProduct: string
  readonly temporaryProductNo: string
}

export interface OrderProductLineEditorProps {
  readonly catalogLineInitialActualUnitPriceAmount?: string | null
  readonly catalogProductAddable?: boolean
  readonly currency: ProductSelectorCurrency
  readonly currencies: readonly CurrencyDescriptor[]
  readonly customProductAddable?: boolean
  readonly loadProducts: ProductPageLoader
  readonly labels: OrderProductLineLabels
  readonly modelValue: readonly OrderProductLineModel[]
  readonly readOnlyLines?: readonly OrderProductLineReadOnlyModel[]
  readonly customReferenceUnitPriceEditable?: boolean
  readonly disabled?: boolean
  readonly fieldErrors?: Readonly<Record<string, string | undefined>>
  readonly fixedProductSupplierValue?: string
  readonly maximumLines?: number
  readonly maximumQuantityByKey?: Readonly<Record<string, number | undefined>>
  readonly minimumQuantityByKey?: Readonly<Record<string, number | undefined>>
  readonly removalDisabledByKey?: Readonly<Record<string, boolean | undefined>>
  readonly nameEditableByKey?: Readonly<Record<string, boolean | undefined>>
  readonly lineConstraintDescriptionByKey?: Readonly<Record<string, string | undefined>>
  readonly productSelectionDescription?: string
  readonly showDiscountRate?: boolean
  readonly temporaryLineInitialActualUnitPriceAmount?: string | null
}
