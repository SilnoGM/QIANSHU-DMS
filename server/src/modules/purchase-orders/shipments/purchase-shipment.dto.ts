import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

import { PurchaseOrderLineType, PurchaseOrderPartStatus, PurchaseOrderProductMode, PurchaseOrderStatus, PurchaseOrderType } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { PurchaseOrderActorDto, PurchaseOrderListImageDto, PurchaseOrderSourceSalesOrderDto, PurchaseOrderSupplierDto } from '../dto/purchase-order-response.dto'

export const PURCHASE_SHIPMENT_VIEWS = ['ALL', 'PENDING_REVIEW', 'AWAITING_SHIPMENT', 'SHIPPED', 'WAREHOUSE_RECEIVED', 'CANCELLED'] as const
export type PurchaseShipmentView = typeof PURCHASE_SHIPMENT_VIEWS[number]
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class PurchaseShipmentFilterDto {
  @ApiProperty({ type: 'string', maxLength: 128, required: false, description: '货件编号、采购单号、基础唛头、货件唛头、销售单号、客户、产品名称或自定义供应商名称' })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128)
  keyword?: string

  @ApiProperty({ type: 'string', format: 'date', required: false })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  orderDateFrom?: string

  @ApiProperty({ type: 'string', format: 'date', required: false })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  orderDateTo?: string

  @ApiProperty({ type: 'string', maxLength: 64, required: false })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 64)
  supplierValue?: string

  @ApiProperty({ enum: ['DICTIONARY', 'CUSTOM_TEXT'], required: false })
  @IsOptional() @IsIn(['DICTIONARY', 'CUSTOM_TEXT'])
  supplierSource?: 'DICTIONARY' | 'CUSTOM_TEXT'

  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  @IsOptional() @Matches(UUID_PATTERN)
  createdByUserId?: string

  @ApiProperty({ enum: PurchaseOrderType, required: false })
  @IsOptional() @IsEnum(PurchaseOrderType)
  purchaseType?: PurchaseOrderType
}

export class PurchaseShipmentListQueryDto extends PurchaseShipmentFilterDto {
  @ApiProperty({ enum: PURCHASE_SHIPMENT_VIEWS, required: false, default: 'AWAITING_SHIPMENT' })
  @IsOptional() @IsIn(PURCHASE_SHIPMENT_VIEWS)
  view?: PurchaseShipmentView

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1000000, default: 1, required: false })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value)
  @IsOptional() @IsInt() @Min(1) @Max(1000000)
  page?: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100, default: 20, required: false })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value)
  @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize?: number
}

export class PurchaseShipmentIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_PATTERN)
  partId!: string
}

export class PurchaseShipmentOrderDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string', format: 'date' }) readonly orderDate!: string
  @ApiProperty({ enum: PurchaseOrderType }) readonly purchaseType!: PurchaseOrderType
  @ApiProperty({ enum: PurchaseOrderProductMode }) readonly productMode!: PurchaseOrderProductMode
  @ApiProperty({ enum: PurchaseOrderStatus }) readonly orderStatus!: PurchaseOrderStatus
  @ApiProperty({ type: 'string', nullable: true }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto }) readonly createdBy!: PurchaseOrderActorDto
}

export class PurchaseShipmentLinePreviewDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly lineId!: string
  @ApiProperty({ type: 'integer' }) readonly lineNumber!: number
  @ApiProperty({ type: 'string', nullable: true }) readonly productNo!: string | null
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: () => PurchaseOrderListImageDto, nullable: true }) readonly mainImage!: PurchaseOrderListImageDto | null
}

export class PurchaseShipmentLineSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly lineCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly totalQuantity!: number
  @ApiProperty({ type: () => [PurchaseShipmentLinePreviewDto] }) readonly previews!: readonly PurchaseShipmentLinePreviewDto[]
}

export class PurchaseShipmentListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string', nullable: true, maxLength: 64, description: 'SHIPMENT_NO 派发的永久货件编号；未补号历史货件为空' }) readonly shipmentNo!: string | null
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly partNumber!: number
  @ApiProperty({ enum: PurchaseOrderPartStatus }) readonly status!: PurchaseOrderPartStatus
  @ApiProperty({ enum: PURCHASE_SHIPMENT_VIEWS.filter(value => value !== 'ALL') }) readonly viewStatus!: Exclude<PurchaseShipmentView, 'ALL'>
  @ApiProperty({ type: 'string', nullable: true }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly shippedAt!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true }) readonly shippedBy!: PurchaseOrderActorDto | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly shipmentRecordedAt!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly shipmentRemark!: string | null
  @ApiProperty({ type: 'string', maxLength: 100, nullable: true, description: '货件物流单号；未填写或历史未记录时为空' }) readonly trackingNo!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, description: '仓库实际收货时间，不代表库存记账' }) readonly warehouseReceivedAt!: string | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly warehouseReceivedById!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly warehouseRecordedAt!: string | null
  @ApiProperty({ type: 'string', maxLength: 500, nullable: true }) readonly warehouseRemark!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true }) readonly warehouseReceivedBy!: PurchaseOrderActorDto | null
  @ApiProperty({ type: () => PurchaseShipmentOrderDto }) readonly purchaseOrder!: PurchaseShipmentOrderDto
  @ApiProperty({ type: () => PurchaseOrderSupplierDto }) readonly supplier!: PurchaseOrderSupplierDto
  @ApiProperty({ type: () => PurchaseOrderSourceSalesOrderDto, nullable: true }) readonly salesSource!: PurchaseOrderSourceSalesOrderDto | null
  @ApiProperty({ type: () => PurchaseShipmentLineSummaryDto }) readonly lineSummary!: PurchaseShipmentLineSummaryDto
}

export class PurchaseShipmentItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly purchaseOrderLineId!: string
  @ApiProperty({ type: 'integer' }) readonly lineNumber!: number
  @ApiProperty({ enum: PurchaseOrderLineType }) readonly lineType!: PurchaseOrderLineType
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly productId!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly productNo!: string | null
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) readonly productAttributes!: readonly Record<string, unknown>[]
  @ApiProperty({ type: 'string', nullable: true }) readonly description!: string | null
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: () => PurchaseOrderListImageDto, nullable: true }) readonly mainImage!: PurchaseOrderListImageDto | null
}

export class PurchaseShipmentDetailDto extends PurchaseShipmentListItemDto {
  @ApiProperty({ type: () => [PurchaseShipmentItemDto] }) readonly items!: readonly PurchaseShipmentItemDto[]
}

export class PurchaseShipmentPageDto {
  @ApiProperty({ type: () => [PurchaseShipmentListItemDto] }) readonly items!: readonly PurchaseShipmentListItemDto[]
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly page!: number
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly pageSize!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly total!: number
}

export class PurchaseShipmentStatusCountDto {
  @ApiProperty({ enum: PURCHASE_SHIPMENT_VIEWS }) readonly value!: PurchaseShipmentView
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
}

export class PurchaseShipmentStatusCountsDto {
  @ApiProperty({ type: () => [PurchaseShipmentStatusCountDto] }) readonly items!: readonly PurchaseShipmentStatusCountDto[]
  @ApiProperty({ type: () => [PurchaseOrderActorDto], description: '有货件的采购单采购人，不受当前筛选影响' }) readonly buyerOptions!: readonly PurchaseOrderActorDto[]
}
