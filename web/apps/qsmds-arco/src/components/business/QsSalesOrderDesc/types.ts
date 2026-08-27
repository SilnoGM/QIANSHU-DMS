import type { CurrencyDescriptor } from '@/components/base/currency'

export type QsSalesOrderDescLineType = 'CATALOG' | 'CUSTOM'
export type QsSalesOrderDescDocumentType
  = 'ORDER_ISSUANCE_VOUCHER' | 'PAYMENT_VOUCHER' | 'DELIVERY_RECEIPT'
export type QsSalesOrderDescMediaType = 'DOCUMENT' | 'IMAGE' | 'VIDEO'

export interface QsSalesOrderDescCustomerViewModel {
  readonly fullAddress: null | string
  readonly name: null | string
  readonly phone: null | string
  readonly regionNames: readonly string[]
}

export interface QsSalesOrderDescLineViewModel {
  readonly actualUnitPriceAmount: null | string
  readonly key: string
  readonly lineSubtotalAmount: null | string
  readonly lineType: QsSalesOrderDescLineType
  readonly productName: null | string
  readonly productNo: null | string
  readonly quantity: null | string
}

export interface QsSalesOrderDescAmountsViewModel {
  readonly agreedTotalAmount: null | string
  readonly balanceDueAmount: null | string
  readonly depositDueAmount: null | string
  readonly lineSubtotalAmount: null | string
}

export interface QsSalesOrderDescDocumentViewModel {
  readonly documentType: QsSalesOrderDescDocumentType
  readonly key: string
  readonly mediaType: QsSalesOrderDescMediaType
  readonly originalFilename: string
  readonly previewSrc: null | string
  readonly thumbnailSrc: null | string
  readonly title: null | string
}

/**
 * 销售订单详情的中立只读模型。
 *
 * 创建页和正式详情页都应在各自边界完成映射，组件不接收表单模型或 API DTO，
 * 也不在展示层重新计算金额。
 */
export interface QsSalesOrderDescViewModel {
  readonly amounts: Readonly<QsSalesOrderDescAmountsViewModel>
  readonly currencyCode: string
  readonly customer: Readonly<QsSalesOrderDescCustomerViewModel>
  readonly documents: readonly QsSalesOrderDescDocumentViewModel[]
  readonly issuerName: null | string
  readonly lines: readonly QsSalesOrderDescLineViewModel[]
  readonly orderDate: null | string
  readonly orderNo: null | string
}

export interface QsSalesOrderDescProps {
  readonly currencies: readonly CurrencyDescriptor[]
  readonly model: Readonly<QsSalesOrderDescViewModel>
}
