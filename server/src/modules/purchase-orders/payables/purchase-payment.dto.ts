import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator'

import {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPaymentType,
  PurchaseOrderStatus,
  PurchaseOrderType,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { PurchaseOrderActorDto } from '../dto/purchase-order-response.dto'

export const PURCHASE_PAYMENT_RECORD_STATUSES = [
  'ALL',
  'ACTIVE',
  'VOIDED',
] as const

export type PurchasePaymentRecordStatus =
  (typeof PURCHASE_PAYMENT_RECORD_STATUSES)[number]

export class PurchasePaymentListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ default: 20, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  keyword?: string

  @ApiPropertyOptional({
    enum: PURCHASE_PAYMENT_RECORD_STATUSES,
    default: 'ALL',
    description: '全部、有效或已作废付款记录。',
  })
  @IsOptional()
  @IsIn(PURCHASE_PAYMENT_RECORD_STATUSES)
  status?: PurchasePaymentRecordStatus
}

export class PurchasePaymentRecordDto {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty({ format: 'uuid' })
  purchaseOrderId!: string

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: '历史付款可能未关联应付款。',
  })
  payableId!: string | null

  @ApiProperty()
  orderNo!: string

  @ApiProperty({ format: 'date' })
  orderDate!: string

  @ApiProperty()
  supplierName!: string

  @ApiProperty({ enum: PurchaseOrderType })
  purchaseType!: PurchaseOrderType

  @ApiProperty({ enum: PurchaseOrderStatus })
  orderStatus!: PurchaseOrderStatus

  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus })
  fulfillmentStatus!: PurchaseOrderFulfillmentStatus

  @ApiProperty({ type: 'string', nullable: true })
  salesOrderNo!: string | null

  @ApiProperty({ enum: PurchaseOrderPaymentType })
  paymentType!: PurchaseOrderPaymentType

  @ApiProperty({ description: 'CNY amount with two decimal places.' })
  amount!: string

  @ApiProperty({ format: 'date-time' })
  paidAt!: string

  @ApiProperty()
  paymentMethod!: string

  @ApiProperty({ type: 'string', nullable: true })
  remark!: string | null

  @ApiProperty({ type: () => PurchaseOrderActorDto })
  createdBy!: PurchaseOrderActorDto

  @ApiProperty({ format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  voidedAt!: string | null

  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true })
  voidedBy!: PurchaseOrderActorDto | null

  @ApiProperty({ type: 'string', nullable: true })
  voidReason!: string | null
}

export class PurchasePaymentRecordPageDto {
  @ApiProperty({ type: [PurchasePaymentRecordDto] })
  items!: PurchasePaymentRecordDto[]

  @ApiProperty({ description: 'Total payment records, not purchase orders.' })
  total!: number

  @ApiProperty()
  page!: number

  @ApiProperty()
  pageSize!: number
}
