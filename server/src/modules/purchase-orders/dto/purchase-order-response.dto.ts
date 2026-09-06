import { ApiProperty } from '@nestjs/swagger'

import {
  MediaType,
  PurchaseOrderDocumentType,
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderLineType,
  PurchaseOrderPaymentStatus,
  PurchaseOrderPaymentType,
  PurchaseOrderProductMode,
  PurchaseOrderStatus,
  PurchaseOrderStatusDimension,
  PurchaseOrderType,
  SalesOrderFulfillmentStatus,
  SalesOrderLineType,
  SalesOrderPaymentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'
import {
  PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS,
  type PurchaseOrderSourceSalesOrderView,
} from '../domain/purchase-order-source-sales-order-view'
import { PurchaseOrderChangeSummaryDto, PurchaseOrderDocumentSummaryDto, PurchaseOrderPaymentRecordSummaryDto } from './purchase-order-record-summary.dto'

export class PurchaseOrderActorDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly displayName!: string
}

export class PurchaseOrderSupplierDto {
  @ApiProperty({ enum: ['DICTIONARY', 'CUSTOM_TEXT'] })
  readonly source!: 'DICTIONARY' | 'CUSTOM_TEXT'
  @ApiProperty({ type: 'string', nullable: true }) readonly value!: string | null
  @ApiProperty({ type: 'string' }) readonly label!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly tone!: string | null
  @ApiProperty({ type: 'boolean', nullable: true }) readonly known!: boolean | null
  @ApiProperty({ type: 'boolean', nullable: true })
  readonly effectiveEnabled!: boolean | null
}

export class PurchaseOrderAmountsDto {
  @ApiProperty({ type: 'string' }) readonly lineSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly purchaseTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly depositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly balanceDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly paidAmount!: string
  @ApiProperty({ type: 'string' }) readonly outstandingAmount!: string
}

export class PurchaseOrderSourceSalesOrderDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string' }) readonly customerName!: string
}

export class PurchaseOrderLineDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'integer' }) readonly lineNumber!: number
  @ApiProperty({ enum: PurchaseOrderLineType }) readonly lineType!: PurchaseOrderLineType
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly productId!: string | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  readonly sourceSalesOrderLineId!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly productNo!: string | null
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  readonly productAttributes!: readonly Record<string, unknown>[]
  @ApiProperty({ type: 'string', nullable: true }) readonly description!: string | null
  @ApiProperty({ type: 'string' }) readonly referencePurchaseUnitPriceAmount!: string
  @ApiProperty({ type: 'string' }) readonly actualPurchaseUnitPriceAmount!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: 'string' }) readonly lineTotalAmount!: string
}

export class PurchaseOrderPaymentDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ enum: PurchaseOrderPaymentType })
  readonly paymentType!: PurchaseOrderPaymentType
  @ApiProperty({ type: 'string' }) readonly amount!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly paidAt!: string
  @ApiProperty({ type: 'string' }) readonly paymentMethod!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly remark!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto }) readonly createdBy!: PurchaseOrderActorDto
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  readonly voidedAt!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true })
  readonly voidedBy!: PurchaseOrderActorDto | null
  @ApiProperty({ type: 'string', nullable: true }) readonly voidReason!: string | null
}

export class PurchaseOrderDocumentDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly mediaAssetId!: string
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly paymentId!: string | null
  @ApiProperty({ enum: PurchaseOrderDocumentType })
  readonly documentType!: PurchaseOrderDocumentType
  @ApiProperty({ type: 'string', nullable: true }) readonly title!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly remark!: string | null
  @ApiProperty({ type: 'string' }) readonly originalFilename!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly mimeType!: string | null
  @ApiProperty({ enum: MediaType }) readonly mediaType!: MediaType
  @ApiProperty({ type: 'string', nullable: true }) readonly sizeBytes!: string | null
  @ApiProperty({ type: 'string' }) readonly contentUrl!: string
  @ApiProperty({ type: () => PurchaseOrderActorDto }) readonly createdBy!: PurchaseOrderActorDto
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  readonly detachedAt!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true })
  readonly detachedBy!: PurchaseOrderActorDto | null
}

export class PurchaseOrderStatusHistoryDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ enum: PurchaseOrderStatusDimension })
  readonly dimension!: PurchaseOrderStatusDimension
  @ApiProperty({ type: 'string' }) readonly fromStatus!: string
  @ApiProperty({ type: 'string' }) readonly toStatus!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly reason!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto }) readonly changedBy!: PurchaseOrderActorDto
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly changedAt!: string
}

export class PurchaseOrderAmountRevisionDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly oldLineSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly oldPurchaseTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly oldDepositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly oldBalanceDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly newLineSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly newPurchaseTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly newDepositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly newBalanceDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly reason!: string
  @ApiProperty({ type: () => PurchaseOrderActorDto }) readonly changedBy!: PurchaseOrderActorDto
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly changedAt!: string
}

export class PurchaseOrderListImageDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly contentUrl!: string
}

export class PurchaseOrderLinePreviewDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly lineId!: string
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: () => PurchaseOrderListImageDto, nullable: true })
  readonly mainImage!: PurchaseOrderListImageDto | null
}

export class PurchaseOrderLineSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly lineCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly totalQuantity!: number
  @ApiProperty({ type: () => [PurchaseOrderLinePreviewDto] })
  readonly previews!: readonly PurchaseOrderLinePreviewDto[]
}

export class PurchaseOrderListItemDto {
  @ApiProperty({ type: () => PurchaseOrderPaymentRecordSummaryDto }) readonly paymentRecordSummary!: PurchaseOrderPaymentRecordSummaryDto
  @ApiProperty({ type: () => PurchaseOrderDocumentSummaryDto }) readonly documentSummary!: PurchaseOrderDocumentSummaryDto
  @ApiProperty({ type: () => PurchaseOrderChangeSummaryDto }) readonly changeSummary!: PurchaseOrderChangeSummaryDto
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ enum: PurchaseOrderType }) readonly purchaseType!: PurchaseOrderType
  @ApiProperty({ enum: PurchaseOrderProductMode })
  readonly productMode!: PurchaseOrderProductMode
  @ApiProperty({ type: 'string', nullable: true }) readonly salesOrderNo!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly customerName!: string | null
  @ApiProperty({ type: () => PurchaseOrderSupplierDto }) readonly supplier!: PurchaseOrderSupplierDto
  @ApiProperty({ type: () => PurchaseOrderActorDto }) readonly createdBy!: PurchaseOrderActorDto
  @ApiProperty({ type: () => PurchaseOrderLineSummaryDto })
  readonly lineSummary!: PurchaseOrderLineSummaryDto
  @ApiProperty({ type: 'string', format: 'date' }) readonly orderDate!: string
  @ApiProperty({ enum: ['CNY'] }) readonly currencyCode!: 'CNY'
  @ApiProperty({ type: 'string' }) readonly purchaseTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly depositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly balanceDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly paidAmount!: string
  @ApiProperty({ type: 'string' }) readonly outstandingAmount!: string
  @ApiProperty({ enum: PurchaseOrderStatus }) readonly orderStatus!: PurchaseOrderStatus
  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus })
  readonly fulfillmentStatus!: PurchaseOrderFulfillmentStatus
  @ApiProperty({ enum: PurchaseOrderPaymentStatus })
  readonly paymentStatus!: PurchaseOrderPaymentStatus
  @ApiProperty({ type: 'string', nullable: true }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly remark!: string | null
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly updatedAt!: string
}

export class PurchaseOrderDetailDto extends PurchaseOrderListItemDto {
  @ApiProperty({ type: () => PurchaseOrderSourceSalesOrderDto, nullable: true })
  readonly sourceSalesOrder!: PurchaseOrderSourceSalesOrderDto | null
  @ApiProperty({ type: () => PurchaseOrderAmountsDto }) readonly amounts!: PurchaseOrderAmountsDto
  @ApiProperty({ type: () => [PurchaseOrderLineDto] }) readonly lines!: readonly PurchaseOrderLineDto[]
  @ApiProperty({ type: () => [PurchaseOrderPaymentDto] })
  readonly payments!: readonly PurchaseOrderPaymentDto[]
  @ApiProperty({ type: () => [PurchaseOrderDocumentDto] })
  readonly documents!: readonly PurchaseOrderDocumentDto[]
  @ApiProperty({ type: () => [PurchaseOrderStatusHistoryDto] })
  readonly statusHistory!: readonly PurchaseOrderStatusHistoryDto[]
  @ApiProperty({ type: () => [PurchaseOrderAmountRevisionDto] })
  readonly amountRevisions!: readonly PurchaseOrderAmountRevisionDto[]
}

export class PurchaseOrderCurrencySummaryDto {
  @ApiProperty({ enum: ['CNY'] }) readonly currencyCode!: 'CNY'
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly orderCount!: number
  @ApiProperty({ type: 'string' }) readonly referenceSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly purchaseTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly depositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly balanceDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly paidAmount!: string
  @ApiProperty({ type: 'string' }) readonly outstandingAmount!: string
}

export class PurchaseOrderPageDto {
  @ApiProperty({ type: () => [PurchaseOrderListItemDto] })
  readonly items!: readonly PurchaseOrderListItemDto[]
  @ApiProperty({ type: () => [PurchaseOrderCurrencySummaryDto] })
  readonly summariesByCurrency!: readonly PurchaseOrderCurrencySummaryDto[]
  @ApiProperty({ type: 'integer' }) readonly page!: number
  @ApiProperty({ type: 'integer' }) readonly pageSize!: number
  @ApiProperty({ type: 'integer' }) readonly total!: number
}

export const PURCHASE_ORDER_STATUS_COUNT_VALUES = [
  'ALL',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'AWAITING_SHIPMENT',
  'AWAITING_WAREHOUSE',
  'AWAITING_PAYMENT',
] as const

export class PurchaseOrderStatusCountItemDto {
  @ApiProperty({ enum: PURCHASE_ORDER_STATUS_COUNT_VALUES })
  readonly value!: typeof PURCHASE_ORDER_STATUS_COUNT_VALUES[number]

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly count!: number
}

export class PurchaseOrderStatusCountsDto {
  @ApiProperty({ enum: ['all', 'pending'] })
  readonly view!: 'all' | 'pending'

  @ApiProperty({ type: () => [PurchaseOrderStatusCountItemDto] })
  readonly items!: readonly PurchaseOrderStatusCountItemDto[]
}

export class PurchaseOrderProductImageDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly contentUrl!: string
}

export class PurchaseOrderProductOptionDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly productNo!: string
  @ApiProperty({ type: 'string' }) readonly name!: string
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  readonly attributes!: readonly Record<string, unknown>[]
  @ApiProperty({ type: 'string' }) readonly supplierValue!: string
  @ApiProperty({ type: 'string' }) readonly referencePurchaseUnitPriceAmount!: string
  @ApiProperty({ enum: ['CNY'] }) readonly currencyCode!: 'CNY'
  @ApiProperty({ type: () => PurchaseOrderProductImageDto, nullable: true })
  readonly mainImage!: PurchaseOrderProductImageDto | null
}

export class PurchaseOrderProductOptionsDto {
  @ApiProperty({ type: () => [PurchaseOrderProductOptionDto] })
  readonly items!: readonly PurchaseOrderProductOptionDto[]
  @ApiProperty({ type: 'integer' }) readonly page!: number
  @ApiProperty({ type: 'integer' }) readonly pageSize!: number
  @ApiProperty({ type: 'integer' }) readonly total!: number
}

export class PurchaseOrderSourceSalesOrderListImageDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly contentUrl!: string
}

export class PurchaseOrderSourceSalesOrderLinePreviewDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly lineId!: string
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: () => PurchaseOrderSourceSalesOrderListImageDto, nullable: true })
  readonly mainImage!: PurchaseOrderSourceSalesOrderListImageDto | null
}

export class PurchaseOrderSourceSalesOrderLineSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly lineCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly totalQuantity!: number
  @ApiProperty({ type: () => [PurchaseOrderSourceSalesOrderLinePreviewDto] })
  readonly previews!: readonly PurchaseOrderSourceSalesOrderLinePreviewDto[]
}

export class PurchaseOrderSourceSalesOrderListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string', format: 'date' }) readonly orderDate!: string
  @ApiProperty({ type: () => PurchaseOrderActorDto }) readonly issuer!: PurchaseOrderActorDto
  @ApiProperty({ type: 'string' }) readonly customerName!: string
  @ApiProperty({ type: 'string' }) readonly salesTotalAmount!: string
  @ApiProperty({ enum: SalesOrderStatus }) readonly orderStatus!: SalesOrderStatus
  @ApiProperty({ enum: SalesOrderFulfillmentStatus })
  readonly fulfillmentStatus!: SalesOrderFulfillmentStatus
  @ApiProperty({ enum: SalesOrderPaymentStatus })
  readonly paymentStatus!: SalesOrderPaymentStatus
  @ApiProperty({ type: () => PurchaseOrderSourceSalesOrderLineSummaryDto })
  readonly lineSummary!: PurchaseOrderSourceSalesOrderLineSummaryDto
}

export class PurchaseOrderSourceSalesOrderViewCountItemDto {
  @ApiProperty({ enum: PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS })
  readonly value!: PurchaseOrderSourceSalesOrderView

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly count!: number
}

export class PurchaseOrderSourceSalesOrdersDto {
  @ApiProperty({ enum: PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS })
  readonly view!: PurchaseOrderSourceSalesOrderView
  @ApiProperty({ type: () => [PurchaseOrderSourceSalesOrderViewCountItemDto] })
  readonly counts!: readonly PurchaseOrderSourceSalesOrderViewCountItemDto[]
  @ApiProperty({ type: () => [PurchaseOrderSourceSalesOrderListItemDto] })
  readonly items!: readonly PurchaseOrderSourceSalesOrderListItemDto[]
  @ApiProperty({ type: 'integer' }) readonly page!: number
  @ApiProperty({ type: 'integer' }) readonly pageSize!: number
  @ApiProperty({ type: 'integer' }) readonly total!: number
}

/**
 * 销售来源中已经形成有效采购单的明细快照。
 *
 * 金额与备注必须读取采购明细保存时的事实，不能用当前产品成本或销售明细说明
 * 回填，否则历史采购核对会随主数据变化而漂移。
 */
export class PurchaseOrderSourcePurchasedLineDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly referencePurchaseUnitPriceAmount!: string
  @ApiProperty({ type: 'string' }) readonly actualPurchaseUnitPriceAmount!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: 'string' }) readonly lineTotalAmount!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly description!: string | null
}

export class PurchaseOrderSourceSalesOrderLineDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'integer' }) readonly lineNumber!: number
  @ApiProperty({ enum: SalesOrderLineType }) readonly lineType!: SalesOrderLineType
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly productId!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly productNo!: string | null
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  readonly productAttributes!: readonly Record<string, unknown>[]
  @ApiProperty({ type: 'string', nullable: true }) readonly description!: string | null
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly purchasedQuantity!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly remainingQuantity!: number
  @ApiProperty({ type: () => [PurchaseOrderSourcePurchasedLineDto] })
  readonly purchasedLines!: readonly PurchaseOrderSourcePurchasedLineDto[]
}

export class PurchaseOrderSourceSalesOrderLinesDto {
  @ApiProperty({ type: () => PurchaseOrderSourceSalesOrderDto })
  readonly salesOrder!: PurchaseOrderSourceSalesOrderDto
  @ApiProperty({ type: () => [PurchaseOrderSourceSalesOrderLineDto] })
  readonly items!: readonly PurchaseOrderSourceSalesOrderLineDto[]
}
