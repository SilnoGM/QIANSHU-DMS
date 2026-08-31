import { ApiProperty, OmitType } from '@nestjs/swagger'
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
  SalesOrderFulfillmentStatus,
  SalesOrderPaymentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

function optionalInteger(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value
}

export class SalesOrderListQueryDto {
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

  @ApiProperty({ type: 'string', maxLength: 128, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  keyword?: string

  @ApiProperty({ enum: ['TWD', 'MYR'], required: false })
  @IsOptional()
  @IsIn(['TWD', 'MYR'])
  currencyCode?: 'TWD' | 'MYR'

  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  issuerUserId?: string

  @ApiProperty({ enum: SalesOrderStatus, required: false })
  @IsOptional()
  @IsEnum(SalesOrderStatus)
  orderStatus?: SalesOrderStatus

  @ApiProperty({ enum: SalesOrderFulfillmentStatus, required: false })
  @IsOptional()
  @IsEnum(SalesOrderFulfillmentStatus)
  fulfillmentStatus?: SalesOrderFulfillmentStatus

  @ApiProperty({ enum: SalesOrderPaymentStatus, required: false })
  @IsOptional()
  @IsEnum(SalesOrderPaymentStatus)
  paymentStatus?: SalesOrderPaymentStatus

  @ApiProperty({ type: 'string', format: 'date', required: false })
  @IsOptional()
  @Matches(DATE_PATTERN)
  orderDateFrom?: string

  @ApiProperty({ type: 'string', format: 'date', required: false })
  @IsOptional()
  @Matches(DATE_PATTERN)
  orderDateTo?: string
}

export class SalesOrderStatusCountsQueryDto extends OmitType(
  SalesOrderListQueryDto,
  ['page', 'pageSize', 'orderStatus', 'fulfillmentStatus'] as const,
) {
  @ApiProperty({ enum: ['all', 'pending'] })
  @IsIn(['all', 'pending'])
  view!: 'all' | 'pending'
}

export class SalesOrderProductOptionsQueryDto {
  @ApiProperty({ enum: ['TWD', 'MYR'] })
  @IsIn(['TWD', 'MYR'])
  currencyCode!: 'TWD' | 'MYR'

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

  @ApiProperty({ type: 'integer', minimum: 1, default: 1, required: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalInteger(value))
  @IsInt()
  @Min(1)
  page?: number

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 50,
    default: 20,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalInteger(value))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number
}

export class SalesOrderProductImageQueryDto {
  @ApiProperty({ enum: ['TWD', 'MYR'] })
  @IsIn(['TWD', 'MYR'])
  currencyCode!: 'TWD' | 'MYR'
}

export class SalesOrderProductImageParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  productId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  productMediaId!: string
}

export class SalesOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  salesOrderId!: string
}

export class SalesOrderLineProductImageParamDto extends SalesOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  lineId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  productMediaId!: string
}

export class SalesOrderPaymentIdParamDto extends SalesOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  paymentId!: string
}
