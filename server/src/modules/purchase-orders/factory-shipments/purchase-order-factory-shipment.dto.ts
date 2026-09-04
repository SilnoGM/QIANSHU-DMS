import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator'

import {
  PurchaseOrderFulfillmentStatus,
  SalesOrderFulfillmentStatus,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import {
  PurchaseOrderLineSummaryDto,
  PurchaseOrderSupplierDto,
} from '../dto/purchase-order-response.dto'

export class PurchaseOrderFactoryShipmentRequestDto {
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
  @ApiProperty({ enum: ['SHIPPED', 'SIGNED'] })
  readonly fulfillmentStatus!: 'SHIPPED' | 'SIGNED'
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

export class SalesOrderFactoryShipmentContextPurchaseOrderDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string', format: 'date' }) readonly orderDate!: string
  @ApiProperty({ type: () => PurchaseOrderSupplierDto })
  readonly supplier!: PurchaseOrderSupplierDto
  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus })
  readonly fulfillmentStatus!: PurchaseOrderFulfillmentStatus
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
  @ApiProperty({ type: () => PurchaseOrderLineSummaryDto })
  readonly lineSummary!: PurchaseOrderLineSummaryDto
}

export class SalesOrderFactoryShipmentContextDto {
  @ApiProperty({ type: () => SalesOrderFactoryShipmentContextSalesOrderDto })
  readonly salesOrder!: SalesOrderFactoryShipmentContextSalesOrderDto
  @ApiProperty({ type: () => [SalesOrderFactoryShipmentContextPurchaseOrderDto] })
  readonly purchaseOrders!: readonly SalesOrderFactoryShipmentContextPurchaseOrderDto[]
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly pendingShipmentCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly shipmentSatisfiedCount!: number
}
