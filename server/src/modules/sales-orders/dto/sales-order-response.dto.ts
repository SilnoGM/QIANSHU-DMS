import { ApiProperty } from '@nestjs/swagger'

import {
  MediaType,
  SalesOrderDocumentType,
  SalesOrderFulfillmentStatus,
  SalesOrderLineType,
  SalesOrderPaymentStatus,
  SalesOrderPaymentType,
  SalesOrderStatus,
  SalesOrderStatusDimension,
  UserStatus,
} from '../../../generated/prisma/enums'

export class SalesOrderActorDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string' })
  readonly displayName!: string
}

export class SalesOrderRegionSnapshotDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string' })
  readonly code!: string

  @ApiProperty({ type: 'string' })
  readonly name!: string
}

export class SalesOrderCustomerDto {
  @ApiProperty({ type: 'string' })
  readonly name!: string

  @ApiProperty({ type: 'string' })
  readonly phone!: string

  @ApiProperty({ type: () => SalesOrderRegionSnapshotDto })
  readonly countryRegion!: SalesOrderRegionSnapshotDto

  @ApiProperty({ type: () => SalesOrderRegionSnapshotDto })
  readonly provinceState!: SalesOrderRegionSnapshotDto

  @ApiProperty({ type: () => SalesOrderRegionSnapshotDto })
  readonly city!: SalesOrderRegionSnapshotDto

  @ApiProperty({ type: 'string' })
  readonly addressDetail!: string

  @ApiProperty({ type: 'string' })
  readonly fullAddress!: string
}

export class SalesOrderAmountsDto {
  @ApiProperty({ type: 'string' })
  readonly lineSubtotalAmount!: string

  @ApiProperty({ type: 'string' })
  readonly agreedTotalAmount!: string

  @ApiProperty({ type: 'string' })
  readonly depositDueAmount!: string

  @ApiProperty({ type: 'string' })
  readonly balanceDueAmount!: string

  @ApiProperty({ type: 'string' })
  readonly receivedAmount!: string

  @ApiProperty({ type: 'string' })
  readonly outstandingAmount!: string
}

export class SalesOrderLineDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'integer' })
  readonly lineNumber!: number

  @ApiProperty({ enum: SalesOrderLineType })
  readonly lineType!: SalesOrderLineType

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  readonly productId!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  readonly productNo!: string | null

  @ApiProperty({ type: 'string' })
  readonly productName!: string

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  readonly productAttributes!: readonly Record<string, unknown>[]

  @ApiProperty({ type: 'string', nullable: true })
  readonly description!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  readonly standardUnitPriceAmount!: string | null

  @ApiProperty({ type: 'string' })
  readonly actualUnitPriceAmount!: string

  @ApiProperty({ type: 'integer' })
  readonly quantity!: number

  @ApiProperty({ type: 'string' })
  readonly lineTotalAmount!: string
}

export class SalesOrderPaymentDto {
  @ApiProperty({ enum: ['LEGACY', 'REVIEWED', 'COD_SETTLEMENT'] }) readonly origin!: 'LEGACY' | 'REVIEWED' | 'COD_SETTLEMENT'
  @ApiProperty({ type: 'string', nullable: true, format: 'uuid' }) readonly fundPostingBatchId!: string | null
  @ApiProperty({ type: 'string', nullable: true, format: 'uuid' }) readonly fundReversalBatchId!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly foreignUnitsPerCnySnapshot!: string | null
  @ApiProperty({ type: 'string', nullable: true, format: 'date-time' }) readonly exchangeRateCapturedAt!: string | null

  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ enum: SalesOrderPaymentType })
  readonly paymentType!: SalesOrderPaymentType

  @ApiProperty({ type: 'string' })
  readonly amount!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  readonly receivedAt!: string

  @ApiProperty({ type: 'string', nullable: true })
  readonly paymentMethod!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  readonly remark!: string | null

  @ApiProperty({ type: () => SalesOrderActorDto })
  readonly createdBy!: SalesOrderActorDto

  @ApiProperty({ type: 'string', format: 'date-time' })
  readonly createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  readonly voidedAt!: string | null

  @ApiProperty({ type: () => SalesOrderActorDto, nullable: true })
  readonly voidedBy!: SalesOrderActorDto | null

  @ApiProperty({ type: 'string', nullable: true })
  readonly voidReason!: string | null

  /** 代收回填收款没有收款凭证文件（凭证即对应的结算记录），此时为 null。 */
  @ApiProperty({ type: () => SalesOrderDocumentDto, nullable: true })
  readonly voucher!: Readonly<Record<string, unknown>> | null
}

export class SalesOrderDocumentDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly mediaAssetId!: string

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  readonly paymentId!: string | null

  @ApiProperty({ enum: SalesOrderDocumentType })
  readonly documentType!: SalesOrderDocumentType

  @ApiProperty({ type: 'string', nullable: true })
  readonly title!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  readonly remark!: string | null

  @ApiProperty({ type: 'string' })
  readonly originalFilename!: string

  @ApiProperty({ type: 'string', nullable: true })
  readonly mimeType!: string | null

  @ApiProperty({ enum: MediaType })
  readonly mediaType!: MediaType

  @ApiProperty({ type: 'string', nullable: true })
  readonly sizeBytes!: string | null

  @ApiProperty({ type: 'string' })
  readonly contentUrl!: string

  @ApiProperty({ type: () => SalesOrderActorDto })
  readonly createdBy!: SalesOrderActorDto

  @ApiProperty({ type: 'string', format: 'date-time' })
  readonly createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  readonly detachedAt!: string | null

  @ApiProperty({ type: () => SalesOrderActorDto, nullable: true })
  readonly detachedBy!: SalesOrderActorDto | null
}

export class SalesOrderStatusHistoryDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ enum: SalesOrderStatusDimension })
  readonly dimension!: SalesOrderStatusDimension

  @ApiProperty({ type: 'string' })
  readonly fromStatus!: string

  @ApiProperty({ type: 'string' })
  readonly toStatus!: string

  @ApiProperty({ type: 'string', nullable: true })
  readonly reason!: string | null

  @ApiProperty({ type: () => SalesOrderActorDto })
  readonly changedBy!: SalesOrderActorDto

  @ApiProperty({ type: 'string', format: 'date-time' })
  readonly changedAt!: string
}

export class SalesOrderAmountRevisionDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string' }) readonly oldLineSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly oldAgreedTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly oldDepositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly oldBalanceDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly newLineSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly newAgreedTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly newDepositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly newBalanceDueAmount!: string

  @ApiProperty({ type: 'string' })
  readonly reason!: string

  @ApiProperty({ type: () => SalesOrderActorDto })
  readonly changedBy!: SalesOrderActorDto

  @ApiProperty({ type: 'string', format: 'date-time' })
  readonly changedAt!: string
}

export const SALES_ORDER_COMPLETION_HOLD_REASONS = [
  'PAYMENT_INCOMPLETE',
  'RECONCILIATION_IN_PROGRESS',
  'AWAITING_RECONCILIATION_COVERAGE',
] as const

/** 待对账订单停留在「待对账」的原因（完成判定见自动状态服务，口径 R3）。 */
export class SalesOrderCompletionHoldDto {
  @ApiProperty({ enum: SALES_ORDER_COMPLETION_HOLD_REASONS })
  readonly reason!: typeof SALES_ORDER_COMPLETION_HOLD_REASONS[number]

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly pendingBatchCount!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly unreconciledMemberCount!: number
}

export class SalesOrderDetailDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string', format: 'date' }) readonly orderDate!: string
  @ApiProperty({ type: () => SalesOrderActorDto }) readonly issuer!: SalesOrderActorDto
  @ApiProperty({ enum: ['TWD', 'MYR'] }) readonly currencyCode!: string
  @ApiProperty({ type: () => SalesOrderCustomerDto }) readonly customer!: SalesOrderCustomerDto
  @ApiProperty({ type: () => SalesOrderAmountsDto }) readonly amounts!: SalesOrderAmountsDto
  @ApiProperty({ enum: SalesOrderStatus }) readonly orderStatus!: SalesOrderStatus
  @ApiProperty({ enum: SalesOrderFulfillmentStatus }) readonly fulfillmentStatus!: SalesOrderFulfillmentStatus
  @ApiProperty({ enum: SalesOrderPaymentStatus }) readonly paymentStatus!: SalesOrderPaymentStatus
  @ApiProperty({ type: () => SalesOrderCompletionHoldDto, nullable: true })
  readonly completionHold!: SalesOrderCompletionHoldDto | null
  @ApiProperty({ type: 'string', nullable: true }) readonly remark!: string | null
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
  @ApiProperty({ type: () => [SalesOrderLineDto] }) readonly lines!: readonly SalesOrderLineDto[]
  @ApiProperty({ type: () => [SalesOrderPaymentDto] }) readonly payments!: readonly SalesOrderPaymentDto[]
  @ApiProperty({ type: () => [SalesOrderDocumentDto] }) readonly documents!: readonly SalesOrderDocumentDto[]
  @ApiProperty({ type: () => [SalesOrderStatusHistoryDto] }) readonly statusHistory!: readonly SalesOrderStatusHistoryDto[]
  @ApiProperty({ type: () => [SalesOrderAmountRevisionDto] }) readonly amountRevisions!: readonly SalesOrderAmountRevisionDto[]
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly updatedAt!: string
}

export class SalesOrderListImageDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly contentUrl!: string
}

export class SalesOrderLinePreviewDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly lineId!: string
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: () => SalesOrderListImageDto, nullable: true })
  readonly mainImage!: SalesOrderListImageDto | null
}

export class SalesOrderLineSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly lineCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly totalQuantity!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly catalogCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly customCount!: number
  @ApiProperty({ type: () => [SalesOrderLinePreviewDto] })
  readonly previews!: readonly SalesOrderLinePreviewDto[]
}

export class SalesOrderDocumentPreviewDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ enum: SalesOrderDocumentType })
  readonly documentType!: SalesOrderDocumentType
  @ApiProperty({ type: 'string', nullable: true }) readonly title!: string | null
  @ApiProperty({ enum: MediaType }) readonly mediaType!: MediaType
  @ApiProperty({ type: 'string' }) readonly contentUrl!: string
}

export class SalesOrderDocumentSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly imageCount!: number
  @ApiProperty({ type: () => [SalesOrderDocumentPreviewDto] })
  readonly previews!: readonly SalesOrderDocumentPreviewDto[]
}

export class SalesOrderCurrencySummaryDto {
  @ApiProperty({ enum: ['TWD', 'MYR'] }) readonly currencyCode!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly orderCount!: number
  @ApiProperty({ type: 'string' }) readonly standardSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly agreedTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly depositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly balanceDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly receivedAmount!: string
  @ApiProperty({ type: 'string' }) readonly outstandingAmount!: string
}

export class SalesOrderIssuerOptionDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly displayName!: string
  @ApiProperty({ enum: UserStatus }) readonly status!: UserStatus
}

export class SalesOrderIssuerOptionsDto {
  @ApiProperty({ type: () => [SalesOrderIssuerOptionDto] })
  readonly items!: readonly SalesOrderIssuerOptionDto[]
}

export class SalesOrderListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string', format: 'date' }) readonly orderDate!: string
  @ApiProperty({ type: () => SalesOrderActorDto }) readonly issuer!: SalesOrderActorDto
  @ApiProperty({ enum: ['TWD', 'MYR'] }) readonly currencyCode!: string
  @ApiProperty({ type: 'string' }) readonly customerName!: string
  @ApiProperty({ type: 'string' }) readonly customerPhone!: string
  @ApiProperty({ type: 'string' }) readonly customerProvinceStateName!: string
  @ApiProperty({ type: 'string' }) readonly customerCityName!: string
  @ApiProperty({ type: 'string' }) readonly customerFullAddress!: string
  @ApiProperty({ type: 'string' }) readonly standardSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly lineSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly agreedTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly depositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly balanceDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly receivedAmount!: string
  @ApiProperty({ type: 'string' }) readonly outstandingAmount!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly remark!: string | null
  @ApiProperty({ enum: SalesOrderStatus }) readonly orderStatus!: SalesOrderStatus
  @ApiProperty({ enum: SalesOrderFulfillmentStatus }) readonly fulfillmentStatus!: SalesOrderFulfillmentStatus
  @ApiProperty({ enum: SalesOrderPaymentStatus }) readonly paymentStatus!: SalesOrderPaymentStatus
  @ApiProperty({ type: () => SalesOrderCompletionHoldDto, nullable: true })
  readonly completionHold!: SalesOrderCompletionHoldDto | null
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly paymentRecordCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly statusChangeRecordCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly amountChangeRecordCount!: number
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
  @ApiProperty({ type: () => SalesOrderLineSummaryDto })
  readonly lineSummary!: SalesOrderLineSummaryDto
  @ApiProperty({ type: () => SalesOrderDocumentSummaryDto })
  readonly documentSummary!: SalesOrderDocumentSummaryDto
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly updatedAt!: string
}

export class SalesOrderPageDto {
  @ApiProperty({ type: () => [SalesOrderListItemDto] }) readonly items!: readonly SalesOrderListItemDto[]
  @ApiProperty({ type: () => [SalesOrderCurrencySummaryDto] })
  readonly summariesByCurrency!: readonly SalesOrderCurrencySummaryDto[]
  @ApiProperty({ type: 'integer' }) readonly page!: number
  @ApiProperty({ type: 'integer' }) readonly pageSize!: number
  @ApiProperty({ type: 'integer' }) readonly total!: number
}

export const SALES_ORDER_STATUS_COUNT_VALUES = [
  'ALL',
  'CONFIRMED',
  'PENDING_RECONCILIATION',
  'CANCELLED',
  'COMPLETED',
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
  'SEA_TRANSIT',
  'WAITING_PAYMENT',
] as const

export class SalesOrderStatusCountItemDto {
  @ApiProperty({ enum: SALES_ORDER_STATUS_COUNT_VALUES })
  readonly value!: typeof SALES_ORDER_STATUS_COUNT_VALUES[number]

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly count!: number
}

export class SalesOrderStatusCountsDto {
  @ApiProperty({ enum: ['all', 'pending'] })
  readonly view!: 'all' | 'pending'

  @ApiProperty({ type: () => [SalesOrderStatusCountItemDto] })
  readonly items!: readonly SalesOrderStatusCountItemDto[]
}

export class SalesOrderProductOptionDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly productNo!: string
  @ApiProperty({ type: 'string' }) readonly name!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly categoryName!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly productHeadName!: string | null
  @ApiProperty({ type: 'string' }) readonly supplierValue!: string
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) readonly attributes!: readonly Record<string, unknown>[]
  @ApiProperty({ type: 'string', nullable: true }) readonly standardUnitPriceAmount!: string | null
  @ApiProperty({ enum: ['TWD', 'MYR'] }) readonly currencyCode!: string
  @ApiProperty({
    nullable: true,
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      contentUrl: { type: 'string' },
    },
    required: ['id', 'contentUrl'],
  })
  readonly mainImage!: {
    readonly id: string
    readonly contentUrl: string
  } | null
}

export class SalesOrderProductOptionHeadDto {
  @ApiProperty({ type: 'string' }) readonly name!: string
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
}

export class SalesOrderProductOptionCategoryDto {
  @ApiProperty({ type: 'string' }) readonly name!: string
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
  @ApiProperty({ type: () => [SalesOrderProductOptionHeadDto] })
  readonly productHeads!: readonly SalesOrderProductOptionHeadDto[]
}

export class SalesOrderProductOptionsDto {
  @ApiProperty({ type: () => [SalesOrderProductOptionDto] })
  readonly items!: readonly SalesOrderProductOptionDto[]
  @ApiProperty({ type: () => [SalesOrderProductOptionCategoryDto] })
  readonly categories!: readonly SalesOrderProductOptionCategoryDto[]
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly unclassifiedCount!: number
  @ApiProperty({ type: 'integer' }) readonly page!: number
  @ApiProperty({ type: 'integer' }) readonly pageSize!: number
  @ApiProperty({ type: 'integer' }) readonly total!: number
}

export class SalesOrderProductEditContextOrderDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string' }) readonly customerName!: string
  @ApiProperty({ enum: ['TWD', 'MYR'] }) readonly currencyCode!: 'TWD' | 'MYR'
  @ApiProperty({ enum: SalesOrderStatus }) readonly orderStatus!: SalesOrderStatus
  @ApiProperty({ enum: SalesOrderFulfillmentStatus })
  readonly fulfillmentStatus!: SalesOrderFulfillmentStatus
  @ApiProperty({ enum: SalesOrderPaymentStatus })
  readonly paymentStatus!: SalesOrderPaymentStatus
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
}

export class SalesOrderProductEditAmountsDto {
  @ApiProperty({ type: 'string' }) readonly lineSubtotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly agreedTotalAmount!: string
  @ApiProperty({ type: 'string' }) readonly depositDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly balanceDueAmount!: string
  @ApiProperty({ type: 'string' }) readonly paidAmount!: string
  @ApiProperty({ type: 'string' }) readonly outstandingAmount!: string
}

export class SalesOrderProductEditExistingLineDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly lineNumber!: number
  @ApiProperty({ enum: SalesOrderLineType }) readonly lineType!: SalesOrderLineType
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  readonly productId!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly productNo!: string | null
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly supplierValue!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly description!: string | null
  @ApiProperty({ type: 'string', nullable: true })
  readonly standardUnitPriceAmount!: string | null
  @ApiProperty({ type: 'string' }) readonly actualUnitPriceAmount!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: 'string' }) readonly lineTotalAmount!: string
  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly activePurchasedQuantity!: number
  @ApiProperty({ type: 'boolean' }) readonly canDecrease!: boolean
  @ApiProperty({ type: () => SalesOrderListImageDto, nullable: true, required: true })
  readonly mainImage!: SalesOrderListImageDto | null
}

export class SalesOrderProductEditContextDto {
  @ApiProperty({ type: () => SalesOrderProductEditContextOrderDto })
  readonly salesOrder!: SalesOrderProductEditContextOrderDto
  @ApiProperty({ type: () => SalesOrderProductEditAmountsDto })
  readonly amounts!: SalesOrderProductEditAmountsDto
  @ApiProperty({ type: () => [SalesOrderProductEditExistingLineDto] })
  readonly existingLines!: readonly SalesOrderProductEditExistingLineDto[]
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 100 })
  readonly availableLineCapacity!: number
}

export class SalesOrderProductsUpdateResultDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly salesOrderId!: string

  @ApiProperty({ type: 'integer', minimum: 1 })
  readonly previousVersion!: number

  @ApiProperty({ type: 'integer', minimum: 2 })
  readonly version!: number

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'uuid' } })
  readonly addedLineIds!: readonly string[]

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'uuid' } })
  readonly updatedLineIds!: readonly string[]

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'uuid' } })
  readonly removedLineIds!: readonly string[]

  @ApiProperty({ type: 'string' })
  readonly amountDelta!: string

  @ApiProperty({ enum: SalesOrderFulfillmentStatus })
  readonly fulfillmentStatus!: SalesOrderFulfillmentStatus

  @ApiProperty({ enum: SalesOrderPaymentStatus })
  readonly paymentStatus!: SalesOrderPaymentStatus

  @ApiProperty({ type: 'boolean' }) readonly depositReduced!: boolean

  @ApiProperty({ type: () => SalesOrderProductEditAmountsDto })
  readonly amounts!: SalesOrderProductEditAmountsDto
}
