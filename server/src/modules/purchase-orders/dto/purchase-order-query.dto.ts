import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator'

import {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPaymentStatus,
  PurchaseOrderStatus,
  PurchaseOrderType,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

function optionalInteger(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value
}

class PurchaseOrderPageQueryDto {
  @ApiProperty({ type: 'integer', minimum: 1, default: 1, required: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalInteger(value))
  @IsInt()
  @Min(1)
  page?: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100, default: 20, required: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}

export class PurchaseOrderListQueryDto extends PurchaseOrderPageQueryDto {
  @ApiProperty({ enum: ['all', 'pending'] })
  @IsIn(['all', 'pending'])
  view!: 'all' | 'pending'

  @ApiProperty({ type: 'string', maxLength: 128, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  keyword?: string

  @ApiProperty({ type: 'string', maxLength: 64, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  supplierValue?: string

  @ApiProperty({ enum: PurchaseOrderType, required: false })
  @IsOptional()
  @IsEnum(PurchaseOrderType)
  purchaseType?: PurchaseOrderType

  @ApiProperty({ enum: PurchaseOrderStatus, required: false })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  orderStatus?: PurchaseOrderStatus

  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus, required: false })
  @IsOptional()
  @IsEnum(PurchaseOrderFulfillmentStatus)
  fulfillmentStatus?: PurchaseOrderFulfillmentStatus

  @ApiProperty({ enum: PurchaseOrderPaymentStatus, required: false })
  @IsOptional()
  @IsEnum(PurchaseOrderPaymentStatus)
  paymentStatus?: PurchaseOrderPaymentStatus

  @ApiProperty({ type: 'string', format: 'date', required: false })
  @IsOptional()
  @Matches(DATE_PATTERN)
  orderDateFrom?: string

  @ApiProperty({ type: 'string', format: 'date', required: false })
  @IsOptional()
  @Matches(DATE_PATTERN)
  orderDateTo?: string
}

export class PurchaseOrderProductOptionsQueryDto extends PurchaseOrderPageQueryDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  supplierValue!: string

  @ApiProperty({ type: 'string', maxLength: 128, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  keyword?: string
}

export class PurchaseOrderSourceSalesOrdersQueryDto extends PurchaseOrderPageQueryDto {
  @ApiProperty({ type: 'string', maxLength: 128, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  keyword?: string
}

export class PurchaseOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  purchaseOrderId!: string
}

export class PurchaseOrderSourceSalesOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  salesOrderId!: string
}

export class PurchaseOrderPaymentIdParamDto extends PurchaseOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  paymentId!: string
}

export class PurchaseOrderDocumentIdParamDto extends PurchaseOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  documentId!: string
}
