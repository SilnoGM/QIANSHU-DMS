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

  @ApiProperty({ type: () => SalesOrderDocumentDto })
  readonly voucher!: Readonly<Record<string, unknown>>
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

export class SalesOrderProductOptionDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly productNo!: string
  @ApiProperty({ type: 'string' }) readonly name!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly supplierValue!: string | null
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

export class SalesOrderProductOptionsDto {
  @ApiProperty({ type: () => [SalesOrderProductOptionDto] })
  readonly items!: readonly SalesOrderProductOptionDto[]
  @ApiProperty({ type: 'integer' }) readonly page!: number
  @ApiProperty({ type: 'integer' }) readonly pageSize!: number
  @ApiProperty({ type: 'integer' }) readonly total!: number
}
