/**
 * 销售订单选择弹窗只依赖列表展示所需的最小结构。
 * 业务页面可以直接传入结构兼容的接口 DTO，无需让公共组件反向依赖具体 API 模块。
 */
export type SalesOrderSelectorOrderStatus
  = | 'DRAFT'
    | 'CONFIRMED'
    | 'PENDING_RECONCILIATION'
    | 'COMPLETED'
    | 'CANCELLED'

export type SalesOrderSelectorFulfillmentStatus
  = | 'PENDING'
    | 'PREPARING'
    | 'LAND_TRANSIT'
    | 'WAREHOUSE_ARRIVED'
    | 'SEA_TRANSIT'
    | 'SIGNED'

export type SalesOrderSelectorPaymentStatus
  = | 'UNPAID'
    | 'PARTIALLY_PAID'
    | 'PAID'

export interface SalesOrderSelectorLinePreview {
  readonly lineId: string
  readonly productName: string
  readonly mainImage: {
    readonly id: string
    readonly contentUrl: string
  } | null
}

export interface SalesOrderSelectorItem {
  readonly id: string
  readonly orderNo: string
  readonly orderDate: string
  readonly issuer: {
    readonly id: string
    readonly displayName: string
  }
  readonly customerName: string
  readonly orderStatus: SalesOrderSelectorOrderStatus
  readonly fulfillmentStatus: SalesOrderSelectorFulfillmentStatus
  readonly paymentStatus: SalesOrderSelectorPaymentStatus
  readonly lineSummary: {
    readonly lineCount: number
    readonly previews: readonly SalesOrderSelectorLinePreview[]
    readonly totalQuantity: number
  }
}

export interface SalesOrderSelectorPageChange {
  readonly page: number
  readonly pageSize: number
}
