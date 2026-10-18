import type { CurrencyDescriptor } from '../../base/currency'
import type { OrderProductLineModel } from '../QsOrderProductLineEditor/types'
import type { ProductPageLoader, ProductSelectorCurrency } from '../QsProductSelector/types'

export interface SalesOrderProductEditModalOrder {
  readonly id: string
  readonly orderNo: string
  readonly customerName: string
  readonly currencyCode: Extract<ProductSelectorCurrency, 'MYR' | 'TWD'>
  readonly orderStatus: 'DRAFT' | 'CONFIRMED' | 'PENDING_RECONCILIATION' | 'COMPLETED' | 'CANCELLED'
  readonly fulfillmentStatus: 'PENDING' | 'PREPARING' | 'LAND_TRANSIT' | 'WAREHOUSE_ARRIVED' | 'SEA_TRANSIT' | 'SIGNED'
  readonly paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'
  readonly version: number
}

export interface SalesOrderProductEditModalAmounts {
  readonly lineSubtotalAmount: string
  readonly agreedTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly paidAmount: string
  readonly outstandingAmount: string
}

export interface SalesOrderProductEditModalExistingLine {
  readonly id: string
  readonly lineNumber: number
  readonly lineType: 'CATALOG' | 'CUSTOM'
  readonly productId: string | null
  readonly productNo: string | null
  readonly productName: string
  readonly supplierValue: string | null
  readonly description: string | null
  readonly standardUnitPriceAmount: string | null
  readonly actualUnitPriceAmount: string
  readonly quantity: number
  readonly lineTotalAmount: string
  readonly activePurchasedQuantity: number
  readonly canDecrease: boolean
  readonly mainImage: OrderProductLineModel['mainImage']
}

export interface SalesOrderProductEditModalContext {
  readonly salesOrder: SalesOrderProductEditModalOrder
  readonly amounts: SalesOrderProductEditModalAmounts
  readonly existingLines: readonly SalesOrderProductEditModalExistingLine[]
  readonly availableLineCapacity: number
}

export type SalesOrderProductEditIntentLine
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

export interface SalesOrderProductEditIntent {
  readonly expectedVersion: number
  readonly reason: string
  readonly confirmDepositReduction: boolean
  readonly existingLines: readonly {
    readonly lineId: string
    readonly name: string
    readonly description: string | null
    readonly actualUnitPriceAmount: string
    readonly desiredQuantity: number
  }[]
  readonly newLines: readonly SalesOrderProductEditIntentLine[]
}

export interface SalesOrderProductEditPreview {
  readonly amountDelta: string
  readonly standardAmountDelta: string | null
  readonly standardSubtotalAmount: string | null
  readonly lineSubtotalAmount: string
  readonly agreedTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly paidAmount: string
  readonly outstandingAmount: string
  readonly depositReductionAmount: string
  readonly requiresDepositReduction: boolean
  readonly addedLineCount: number
  readonly increasedLineCount: number
  readonly decreasedLineCount: number
  readonly removedLineCount: number
  readonly expectedFulfillmentStatus: SalesOrderProductEditModalOrder['fulfillmentStatus']
}

export interface SalesOrderProductsEditorModalProps {
  readonly modelValue: boolean
  readonly context: SalesOrderProductEditModalContext | null
  readonly lines?: readonly OrderProductLineModel[]
  readonly reason?: string
  readonly currencies: readonly CurrencyDescriptor[]
  readonly loadProducts: ProductPageLoader
  readonly loading?: boolean
  readonly error?: string | null
  readonly submitting?: boolean
}

export type SalesOrderProductEditFieldErrors = Readonly<Record<string, string>>
