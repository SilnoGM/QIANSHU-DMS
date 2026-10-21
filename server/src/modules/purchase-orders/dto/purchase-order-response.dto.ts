import { PaymentRecipientProfileDto } from '../../payment-recipients/payment-recipient.dto'
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
  @ApiProperty({ type: 'string', nullable: true }) readonly avatarUrl!: string | null
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
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly lineSubtotalAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly purchaseTotalAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly depositDueAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly balanceDueAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly paidAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly outstandingAmount!: string
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
  @ApiProperty({ type: 'string', description: '参考成本快照；历史记录可能保留四位小数' }) readonly referencePurchaseUnitPriceAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly actualPurchaseUnitPriceAmount!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly lineTotalAmount!: string
}

export class PurchaseOrderPaymentDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ enum: PurchaseOrderPaymentType })
  readonly paymentType!: PurchaseOrderPaymentType
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly amount!: string
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

export class PurchaseOrderReviewSummaryDto {
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly reviewedAt!: string
  @ApiProperty({ type: () => PurchaseOrderActorDto }) readonly reviewedBy!: PurchaseOrderActorDto
  @ApiProperty({ type: 'string', nullable: true }) readonly reason!: string | null
}

export class PurchaseOrderListItemDto {
  @ApiProperty({ type: () => PurchaseOrderReviewSummaryDto, nullable: true, description: '精确取自采购待审核到已确认的订单状态变更；无对应历史时为 null' })
  readonly reviewSummary!: PurchaseOrderReviewSummaryDto | null
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
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly purchaseTotalAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly depositDueAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly balanceDueAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly paidAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly outstandingAmount!: string
  @ApiProperty({ enum: PurchaseOrderStatus }) readonly orderStatus!: PurchaseOrderStatus
  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus })
  readonly fulfillmentStatus!: PurchaseOrderFulfillmentStatus
  @ApiProperty({ enum: PurchaseOrderPaymentStatus })
  readonly paymentStatus!: PurchaseOrderPaymentStatus
  @ApiProperty({ type: 'string', nullable: true }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: [String], description: '按货件顺序返回已派发的货件唛头；待审核新单和无货件历史订单为空数组' })
  readonly shippingMarks!: readonly string[]
  @ApiProperty({ type: 'integer', minimum: 0, description: '采购单货件总数，包含待审核及已取消货件' })
  readonly partCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly shippedPartCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly pendingPartCount!: number
  @ApiProperty({ type: 'integer', minimum: 0, description: '已确认入仓的有效货件数' }) readonly warehouseReceivedPartCount!: number
  @ApiProperty({ type: 'integer', minimum: 0, description: '已发货但尚未入仓的有效货件数' }) readonly pendingWarehousePartCount!: number
  @ApiProperty({ type: 'string', nullable: true }) readonly remark!: string | null
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly updatedAt!: string
}

export class PurchaseOrderPartItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly purchaseOrderLineId!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly lineNumber!: number
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
}

export class PurchaseOrderPartDto {
  @ApiProperty({ enum: ['PENDING_REVIEW', 'ACTIVE', 'CANCELLED'] }) readonly status!: 'PENDING_REVIEW' | 'ACTIVE' | 'CANCELLED'
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string', nullable: true, maxLength: 64, description: 'SHIPMENT_NO 派发的永久货件编号；未补号历史货件为空' }) readonly shipmentNo!: string | null
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly partNumber!: number
  @ApiProperty({ type: 'string', nullable: true, maxLength: 72, description: '审核前为空；单货件使用基础唛头，多货件追加货件序号' }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly shippedAt!: string | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly shippedById!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly shipmentRecordedAt!: string | null
  @ApiProperty({ type: 'string', maxLength: 500, nullable: true }) readonly shipmentRemark!: string | null
  @ApiProperty({ type: 'string', maxLength: 100, nullable: true, description: '货件物流单号；未填写或历史未记录时为空' }) readonly trackingNo!: string | null
  @ApiProperty({ type: 'string', maxLength: 64, nullable: true, description: 'mainland.warehouse 的稳定 value；历史未记录时为空' }) readonly destinationWarehouseValue!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true }) readonly shippedBy!: PurchaseOrderActorDto | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, description: '仓库实际收货时间，不代表库存记账' }) readonly warehouseReceivedAt!: string | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly warehouseReceivedById!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly warehouseRecordedAt!: string | null
  @ApiProperty({ type: 'string', maxLength: 500, nullable: true }) readonly warehouseRemark!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true }) readonly warehouseReceivedBy!: PurchaseOrderActorDto | null
  @ApiProperty({ type: () => [PurchaseOrderPartItemDto] }) readonly items!: readonly PurchaseOrderPartItemDto[]
}

export class PurchaseOrderDetailDto extends PurchaseOrderListItemDto {
  @ApiProperty({ type: () => PaymentRecipientProfileDto, nullable: true }) readonly paymentRecipientProfile!: PaymentRecipientProfileDto | null
  @ApiProperty({ type: () => [PurchaseOrderPartDto] }) readonly parts!: readonly PurchaseOrderPartDto[]
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
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly purchaseTotalAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly depositDueAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly balanceDueAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly paidAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly outstandingAmount!: string
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
  'PENDING_REVIEW',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'AWAITING_REVIEW',
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
  @ApiProperty({ type: 'string', nullable: true }) readonly categoryName!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly productHeadName!: string | null
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  readonly attributes!: readonly Record<string, unknown>[]
  @ApiProperty({ type: 'string' }) readonly supplierValue!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '产品成本按四舍五入转为两位采购参考价' }) readonly referencePurchaseUnitPriceAmount!: string
  @ApiProperty({ enum: ['CNY'] }) readonly currencyCode!: 'CNY'
  @ApiProperty({ type: () => PurchaseOrderProductImageDto, nullable: true })
  readonly mainImage!: PurchaseOrderProductImageDto | null
}

export class PurchaseOrderProductOptionHeadDto {
  @ApiProperty({ type: 'string' }) readonly name!: string
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
}

export class PurchaseOrderProductOptionCategoryDto {
  @ApiProperty({ type: 'string' }) readonly name!: string
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
  @ApiProperty({ type: () => [PurchaseOrderProductOptionHeadDto] })
  readonly productHeads!: readonly PurchaseOrderProductOptionHeadDto[]
}

export class PurchaseOrderProductOptionsDto {
  @ApiProperty({ type: () => [PurchaseOrderProductOptionDto] })
  readonly items!: readonly PurchaseOrderProductOptionDto[]
  @ApiProperty({ type: () => [PurchaseOrderProductOptionCategoryDto] })
  readonly categories!: readonly PurchaseOrderProductOptionCategoryDto[]
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly unclassifiedCount!: number
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
  @ApiProperty({ type: 'string', description: '参考成本快照；历史记录可能保留四位小数' }) readonly referencePurchaseUnitPriceAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly actualPurchaseUnitPriceAmount!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) readonly lineTotalAmount!: string
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
