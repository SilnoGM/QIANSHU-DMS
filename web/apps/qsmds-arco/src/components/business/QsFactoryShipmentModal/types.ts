/**
 * 公共发货弹窗只声明展示和操作意图所需的最小结构。
 * 页面可以直接传入结构兼容的 API DTO，组件不反向依赖任何业务 API 模块。
 */
export type FactoryShipmentModalMode = 'PURCHASE_ORDER' | 'SALES_ORDER'
export type FactoryShipmentSelectionMode = 'SELECTED' | 'ALL_PENDING'
export type FactoryShipmentPurchaseStatus
  = | 'ORDERED'
    | 'PREPARING'
    | 'PARTIALLY_SHIPPED'
    | 'SHIPPED'
    | 'SIGNED'

export interface FactoryShipmentProductPreview {
  readonly lineId: string
  readonly productName: string
  readonly productNo?: string | null
  readonly description?: string | null
  readonly quantity?: number
  readonly mainImage: {
    readonly id: string
    readonly contentUrl: string
  } | null
}

export interface FactoryShipmentPart {
  readonly id: string
  readonly shipmentNo: string | null
  readonly partNumber: number
  readonly status: 'PENDING_REVIEW' | 'ACTIVE' | 'CANCELLED'
  readonly shippingMarkText: string | null
  readonly shippedAt: string | null
  readonly shippedById: string | null
  readonly shippedBy?: { readonly id: string, readonly displayName: string, readonly avatarUrl: string | null } | null
  readonly shipmentRecordedAt: string | null
  readonly shipmentRemark: string | null
  readonly trackingNo?: string | null
  readonly destinationWarehouseValue?: string | null
  readonly items: readonly { readonly purchaseOrderLineId: string, readonly lineNumber: number, readonly quantity: number }[]
}

export interface FactoryShipmentModalPurchaseOrder {
  readonly id: string
  readonly orderNo: string
  readonly orderDate: string
  readonly supplier: { readonly label: string }
  readonly fulfillmentStatus: FactoryShipmentPurchaseStatus
  readonly version: number
  readonly shippingMarkText: string | null
  readonly parts: readonly FactoryShipmentPart[]
  readonly lineSummary: {
    readonly lineCount: number
    readonly totalQuantity: number
    readonly previews: readonly FactoryShipmentProductPreview[]
  }
}

export interface FactoryShipmentModalSalesOrder {
  readonly id: string
  readonly orderNo: string
  readonly customerName: string
  readonly fulfillmentStatus: string
}

export interface FactoryShipmentModalContext {
  readonly salesOrder: FactoryShipmentModalSalesOrder | null
  readonly purchaseOrders: readonly FactoryShipmentModalPurchaseOrder[]
}

export interface FactoryShipmentIntent {
  readonly mode: FactoryShipmentSelectionMode
  readonly targets: readonly {
    readonly purchaseOrderId: string
    readonly expectedVersion: number
    readonly partIds: readonly string[]
    readonly destinationWarehouses: readonly { readonly partId: string, readonly warehouseValue: string }[]
    readonly trackingNumbers?: readonly { readonly partId: string, readonly trackingNo: string | null }[]
  }[]
  readonly reason: string | null
}

export interface FactoryShipmentImpact {
  readonly selectedCount: number
  readonly remainingCount: number
  readonly willAdvanceSalesOrder: boolean
}
