import type { CurrencyDescriptor } from '../../base/currency'
import type { OrderProductLineModel } from '../QsOrderProductLineEditor/types'
import type { ProductPageLoader, ProductSelectorCurrency } from '../QsProductSelector/types'

export interface SalesOrderAddOnModalOrder {
  readonly id: string
  readonly orderNo: string
  readonly customerName: string
  readonly currencyCode: Extract<ProductSelectorCurrency, 'MYR' | 'TWD'>
  readonly fulfillmentStatus: 'PENDING' | 'PREPARING' | 'LAND_TRANSIT' | 'WAREHOUSE_ARRIVED' | 'SEA_TRANSIT' | 'SIGNED'
  readonly paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'
  readonly version: number
}

export interface SalesOrderAddOnModalAmounts {
  readonly lineSubtotalAmount: string
  readonly agreedTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly paidAmount: string
  readonly outstandingAmount: string
}

export interface SalesOrderAddOnModalExistingLine {
  readonly id: string
  readonly lineNumber: number
  readonly lineType: 'CATALOG' | 'CUSTOM'
  readonly productNo: string | null
  readonly productName: string
  readonly actualUnitPriceAmount: string
  readonly quantity: number
  readonly lineTotalAmount: string
}

export interface SalesOrderAddOnModalContext {
  readonly salesOrder: SalesOrderAddOnModalOrder
  readonly amounts: SalesOrderAddOnModalAmounts
  readonly existingLines: readonly SalesOrderAddOnModalExistingLine[]
  readonly availableLineCapacity: number
}

export type SalesOrderAddOnIntentLine
  = | {
    readonly lineType: 'CATALOG'
    readonly productId: string
    readonly actualUnitPriceAmount: string
    readonly quantity: number
  }
  | {
    readonly lineType: 'CUSTOM'
    readonly name: string
    readonly description: string | null
    readonly actualUnitPriceAmount: string
    readonly quantity: number
  }

export interface SalesOrderAddOnIntent {
  readonly expectedVersion: number
  readonly reason: string
  readonly lines: readonly SalesOrderAddOnIntentLine[]
}

export interface SalesOrderAddOnPreview {
  readonly amountDelta: string
  readonly lineSubtotalAmount: string
  readonly agreedTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
}

export interface SalesOrderAddOnProductsModalProps {
  readonly modelValue: boolean
  readonly context: SalesOrderAddOnModalContext | null
  readonly lines?: readonly OrderProductLineModel[]
  readonly reason?: string
  readonly supplierValue: string
  readonly currencies: readonly CurrencyDescriptor[]
  readonly loadProducts: ProductPageLoader
  readonly loading?: boolean
  readonly error?: string | null
  readonly submitting?: boolean
}

export type SalesOrderAddOnFieldErrors = Readonly<Record<string, string>>
