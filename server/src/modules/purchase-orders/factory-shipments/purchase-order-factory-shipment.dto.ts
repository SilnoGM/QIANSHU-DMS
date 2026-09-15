import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderProductMode,
  SalesOrderFulfillmentStatus,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import {
  PurchaseOrderListImageDto,
  PurchaseOrderPartDto,
  PurchaseOrderSupplierDto,
} from '../dto/purchase-order-response.dto'

export class FactoryShipmentTrackingNumberDto {
  @ApiProperty({ type: 'string', format: 'uuid', description: '本次已选中的货件 ID，同一请求不得重复' })
  @IsUUID('4')
  partId!: string

  @ApiProperty({ type: 'string', maxLength: 100, nullable: true, description: '物流单号；空白或 null 表示未填写，不改写已有单号' })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @IsUnicodeCodePointLength(0, 100)
  @Matches(/^[^\p{Cc}]*$/u)
  trackingNo!: string | null
}

export class PurchaseOrderFactoryShipmentRequestDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 1000, uniqueItems: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  partIds!: string[]

  @ApiProperty({ type: () => [FactoryShipmentTrackingNumberDto], required: false, maxItems: 1000 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => FactoryShipmentTrackingNumberDto)
  trackingNumbers?: FactoryShipmentTrackingNumberDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(0, 500)
  reason?: string | null
}

export class SalesOrderFactoryShipmentTargetDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 1000, uniqueItems: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  partIds!: string[]

  @ApiProperty({ type: () => [FactoryShipmentTrackingNumberDto], required: false, maxItems: 1000 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => FactoryShipmentTrackingNumberDto)
  trackingNumbers?: FactoryShipmentTrackingNumberDto[]

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  purchaseOrderId!: string

  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number
}

export class SalesOrderFactoryShipmentRequestDto {
  @ApiProperty({ enum: ['SELECTED', 'ALL_PENDING'] })
  @IsIn(['SELECTED', 'ALL_PENDING'])
  mode!: 'SELECTED' | 'ALL_PENDING'

  @ApiProperty({ type: () => [SalesOrderFactoryShipmentTargetDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderFactoryShipmentTargetDto)
  targets!: SalesOrderFactoryShipmentTargetDto[]

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(0, 500)
  reason?: string | null
}

export class FactoryShipmentPurchaseOrderResultDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ enum: ['PARTIALLY_SHIPPED', 'SHIPPED', 'SIGNED'] })
  readonly fulfillmentStatus!: 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'SIGNED'
  @ApiProperty({ type: 'boolean' }) readonly changed!: boolean
}

export class FactoryShipmentSalesOrderResultDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ enum: SalesOrderFulfillmentStatus })
  readonly fulfillmentStatus!: SalesOrderFulfillmentStatus
  @ApiProperty({ type: 'boolean' }) readonly advancedToLandTransit!: boolean
}

export class FactoryShipmentResultDto {
  @ApiProperty({ type: () => [FactoryShipmentPurchaseOrderResultDto] })
  readonly purchaseOrders!: readonly FactoryShipmentPurchaseOrderResultDto[]
  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly changedPurchaseOrderCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly alreadySatisfiedCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly remainingPendingShipmentCount!: number
  @ApiProperty({ type: () => FactoryShipmentSalesOrderResultDto, nullable: true })
  readonly salesOrder!: FactoryShipmentSalesOrderResultDto | null
}

export class SalesOrderFactoryShipmentContextSalesOrderDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string' }) readonly customerName!: string
  @ApiProperty({ enum: ['PREPARING'] }) readonly fulfillmentStatus!: 'PREPARING'
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
}

export class FactoryShipmentProductPreviewDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly lineId!: string
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: () => PurchaseOrderListImageDto, nullable: true })
  readonly mainImage!: PurchaseOrderListImageDto | null
}

export class FactoryShipmentLineSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly lineCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly totalQuantity!: number
  @ApiProperty({ type: () => [FactoryShipmentProductPreviewDto] })
  readonly previews!: readonly FactoryShipmentProductPreviewDto[]
}

export class SalesOrderFactoryShipmentContextPurchaseOrderDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string', format: 'date' }) readonly orderDate!: string
  @ApiProperty({ enum: PurchaseOrderProductMode })
  readonly productMode!: PurchaseOrderProductMode
  @ApiProperty({ type: () => PurchaseOrderSupplierDto })
  readonly supplier!: PurchaseOrderSupplierDto
  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus })
  readonly fulfillmentStatus!: PurchaseOrderFulfillmentStatus
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
  @ApiProperty({ type: () => FactoryShipmentLineSummaryDto })
  readonly lineSummary!: FactoryShipmentLineSummaryDto
  @ApiProperty({ type: 'string', nullable: true }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: () => [PurchaseOrderPartDto] }) readonly parts!: readonly PurchaseOrderPartDto[]
}

export class SalesOrderFactoryShipmentContextDto {
  @ApiProperty({ type: () => SalesOrderFactoryShipmentContextSalesOrderDto })
  readonly salesOrder!: SalesOrderFactoryShipmentContextSalesOrderDto
  @ApiProperty({ type: () => [SalesOrderFactoryShipmentContextPurchaseOrderDto] })
  readonly purchaseOrders!: readonly SalesOrderFactoryShipmentContextPurchaseOrderDto[]
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly pendingShipmentCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly shipmentSatisfiedCount!: number
}
