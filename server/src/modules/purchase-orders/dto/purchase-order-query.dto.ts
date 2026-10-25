import { ApiProperty, OmitType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

import {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPaymentStatus,
  type PurchaseOrderProductMode,
  PurchaseOrderStatus,
  PurchaseOrderType,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import {
  PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS,
  type PurchaseOrderSourceSalesOrderView,
} from '../domain/purchase-order-source-sales-order-view'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export const PURCHASE_ORDER_PENDING_TASKS = [
  'AWAITING_REVIEW',
  'AWAITING_SHIPMENT',
  'AWAITING_WAREHOUSE',
  'AWAITING_PAYMENT',
] as const

export const PURCHASE_ORDER_REVIEW_VIEWS = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'] as const
export type PurchaseOrderReviewView = typeof PURCHASE_ORDER_REVIEW_VIEWS[number]

export type PurchaseOrderPendingTask = typeof PURCHASE_ORDER_PENDING_TASKS[number]

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

  @ApiProperty({
    type: 'string',
    description: '按采购单号、销售单号、客户名或采购唛头模糊搜索',
    maxLength: 128,
    required: false,
  })
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

  @ApiProperty({ enum: PURCHASE_ORDER_REVIEW_VIEWS, required: false })
  @IsOptional()
  @IsIn(PURCHASE_ORDER_REVIEW_VIEWS)
  reviewView?: PurchaseOrderReviewView

  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus, required: false })
  @IsOptional()
  @IsEnum(PurchaseOrderFulfillmentStatus)
  fulfillmentStatus?: PurchaseOrderFulfillmentStatus

  @ApiProperty({ enum: PurchaseOrderPaymentStatus, required: false })
  @IsOptional()
  @IsEnum(PurchaseOrderPaymentStatus)
  paymentStatus?: PurchaseOrderPaymentStatus

  @ApiProperty({ enum: PURCHASE_ORDER_PENDING_TASKS, required: false })
  @IsOptional()
  @IsIn(PURCHASE_ORDER_PENDING_TASKS)
  pendingTask?: PurchaseOrderPendingTask

  @ApiProperty({ type: 'string', format: 'date', required: false })
  @IsOptional()
  @Matches(DATE_PATTERN)
  orderDateFrom?: string

  @ApiProperty({ type: 'string', format: 'date', required: false })
  @IsOptional()
  @Matches(DATE_PATTERN)
  orderDateTo?: string
}

export class PurchaseOrderStatusCountsQueryDto extends OmitType(
  PurchaseOrderListQueryDto,
  ['page', 'pageSize', 'orderStatus', 'pendingTask', 'reviewView'] as const,
) {}

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

  @ApiProperty({ type: 'string', maxLength: 64, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  @Matches(/\S/u)
  categoryName?: string

  @ApiProperty({ type: 'string', maxLength: 64, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  @Matches(/\S/u)
  productHeadName?: string

  @ApiProperty({
    type: 'boolean',
    required: false,
    description: '只看未分类产品；与 categoryName、productHeadName 互斥',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true
    if (value === 'false') return false
    return value
  })
  @IsBoolean()
  unclassified?: boolean
}

export const PURCHASE_ORDER_SOURCE_PRODUCT_MODES = [
  'CATALOG',
  'CUSTOM',
] as const

export type PurchaseOrderSourceProductMode = Exclude<
  PurchaseOrderProductMode,
  'MIXED'
>

class PurchaseOrderSourceProductFilterQueryDto {
  @ApiProperty({ enum: PURCHASE_ORDER_SOURCE_PRODUCT_MODES })
  @IsIn(PURCHASE_ORDER_SOURCE_PRODUCT_MODES)
  productMode!: PurchaseOrderSourceProductMode

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64, required: false })
  @ValidateIf((query: PurchaseOrderSourceProductFilterQueryDto) => (
    query.productMode === 'CATALOG'
  ))
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  supplierValue?: string
}

export class PurchaseOrderSourceSalesOrdersQueryDto
  extends PurchaseOrderSourceProductFilterQueryDto {
  @ApiProperty({ enum: PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS })
  @IsIn(PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS)
  view!: PurchaseOrderSourceSalesOrderView

  @ApiProperty({ type: 'string', maxLength: 128, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  keyword?: string

  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  @IsOptional()
  @Matches(UUID_V4_PATTERN)
  salesOrderId?: string

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

export class PurchaseOrderSourceSalesOrderLinesQueryDto
  extends PurchaseOrderSourceProductFilterQueryDto {}

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

export class PurchaseOrderSourceSalesOrderLineImageParamDto
  extends PurchaseOrderSourceSalesOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  lineId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  productMediaId!: string
}

export class PurchaseOrderLineProductImageParamDto extends PurchaseOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  lineId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  productMediaId!: string
}

export class PurchaseOrderProductImageParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  productId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_V4_PATTERN)
  productMediaId!: string
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
