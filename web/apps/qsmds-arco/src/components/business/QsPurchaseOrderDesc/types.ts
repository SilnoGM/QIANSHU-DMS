import type { CurrencyDescriptor } from '@/components/base/currency'
import type { QsStatusTagTone } from '@/utils/status-tag-tone'

export type QsPurchaseOrderDescLineType = 'CATALOG' | 'CUSTOM'
export type QsPurchaseOrderDescStatusKey = 'FULFILLMENT' | 'ORDER' | 'PAYMENT'
/** 状态色调沿用共享色板，采购详情与对账详情不各自维护一套。 */
export type QsPurchaseOrderDescStatusTone = QsStatusTagTone

export interface QsPurchaseOrderDescAmountsViewModel {
  readonly balanceDueAmount: null | string
  readonly depositDueAmount: null | string
  readonly lineSubtotalAmount: null | string
  readonly outstandingAmount: null | string
  readonly paidAmount: null | string
  readonly purchaseTotalAmount: null | string
}

export interface QsPurchaseOrderDescImageViewModel {
  readonly alt: string
  readonly src: string
}

export interface QsPurchaseOrderDescLineViewModel {
  readonly actualPurchaseUnitPriceAmount: null | string
  readonly description: null | string
  readonly key: string
  readonly lineSubtotalAmount: null | string
  readonly lineType: QsPurchaseOrderDescLineType
  readonly mainImage: null | Readonly<QsPurchaseOrderDescImageViewModel>
  readonly productName: null | string
  readonly productNo: null | string
  readonly quantity: null | string
  readonly referencePurchaseUnitPriceAmount: null | string
}

export interface QsPurchaseOrderDescSourceViewModel {
  readonly customerName: null | string
  readonly salesOrderNo: null | string
}

export interface QsPurchaseOrderDescStatusViewModel {
  readonly key: QsPurchaseOrderDescStatusKey
  readonly label: string
  readonly tone: QsPurchaseOrderDescStatusTone
  readonly value: string
}

/**
 * 采购订单详情的中立只读模型。
 *
 * 创建页与正式详情页分别负责将表单状态或 API DTO 映射到此模型；组件只展示
 * 已准备好的文本、金额和图片地址，不重新计算金额，也不持有业务操作状态。
 */
export interface QsPurchaseOrderDescViewModel {
  readonly amounts: Readonly<QsPurchaseOrderDescAmountsViewModel>
  readonly createdAt: null | string
  readonly currencyCode: string
  readonly issuerName: null | string
  readonly lines: readonly QsPurchaseOrderDescLineViewModel[]
  readonly orderDate: null | string
  readonly orderNo: null | string
  readonly purchaseTypeLabel: null | string
  readonly remark: null | string
  readonly shippingMarkText: null | string
  readonly source: Readonly<QsPurchaseOrderDescSourceViewModel>
  readonly statuses: readonly QsPurchaseOrderDescStatusViewModel[]
  readonly supplierLabel: null | string
  readonly updatedAt: null | string
}

export interface QsPurchaseOrderDescProps {
  readonly currencies: readonly CurrencyDescriptor[]
  readonly model: Readonly<QsPurchaseOrderDescViewModel>
}
