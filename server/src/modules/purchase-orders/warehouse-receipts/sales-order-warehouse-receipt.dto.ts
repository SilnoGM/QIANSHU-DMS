import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import {
  PurchaseOrderFulfillmentStatus,
  SalesOrderFulfillmentStatus,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import {
  PurchaseOrderListImageDto,
  PurchaseOrderPartDto,
  PurchaseOrderSupplierDto,
} from '../dto/purchase-order-response.dto'

export class SalesOrderWarehouseReceiptProductPreviewDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly lineId!: string
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly productNo!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly description!: string | null
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly quantity!: number
  @ApiProperty({ type: () => PurchaseOrderListImageDto, nullable: true })
  readonly mainImage!: PurchaseOrderListImageDto | null
}

export class SalesOrderWarehouseReceiptLineSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly lineCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly totalQuantity!: number
  @ApiProperty({ type: () => [SalesOrderWarehouseReceiptProductPreviewDto] })
  readonly previews!: readonly SalesOrderWarehouseReceiptProductPreviewDto[]
}

export class SalesOrderWarehouseReceiptContextPurchaseOrderDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string', format: 'date' }) readonly orderDate!: string
  @ApiProperty({ type: () => PurchaseOrderSupplierDto })
  readonly supplier!: PurchaseOrderSupplierDto
  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus })
  readonly fulfillmentStatus!: PurchaseOrderFulfillmentStatus
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
  @ApiProperty({ type: 'string', nullable: true }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: () => SalesOrderWarehouseReceiptLineSummaryDto })
  readonly lineSummary!: SalesOrderWarehouseReceiptLineSummaryDto
  @ApiProperty({ type: 'integer', minimum: 0, description: '该采购单已确认入仓的有效货件数' })
  readonly receivedPartCount!: number
  @ApiProperty({ type: () => [PurchaseOrderPartDto], description: '仅包含已发货且尚未入仓的有效货件' })
  readonly parts!: readonly PurchaseOrderPartDto[]
}

export class SalesOrderWarehouseReceiptContextSalesOrderDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ type: 'string' }) readonly customerName!: string
  @ApiProperty({ enum: ['LAND_TRANSIT'] }) readonly fulfillmentStatus!: 'LAND_TRANSIT'
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly version!: number
}

export class SalesOrderWarehouseReceiptContextDto {
  @ApiProperty({ type: () => SalesOrderWarehouseReceiptContextSalesOrderDto })
  readonly salesOrder!: SalesOrderWarehouseReceiptContextSalesOrderDto
  @ApiProperty({ type: () => [SalesOrderWarehouseReceiptContextPurchaseOrderDto] })
  readonly purchaseOrders!: readonly SalesOrderWarehouseReceiptContextPurchaseOrderDto[]
  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly pendingReceiptPartCount!: number
}

export class SalesOrderWarehouseReceiptTargetDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  purchaseOrderId!: string

  @ApiProperty({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 1000, uniqueItems: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  partIds!: string[]
}

export class SalesOrderWarehouseReceiptRequestDto {
  @ApiProperty({ type: () => [SalesOrderWarehouseReceiptTargetDto], minItems: 1, maxItems: 100, description: '按采购单分组；同一货件只能出现一次，整次最多确认 1000 件' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderWarehouseReceiptTargetDto)
  targets!: SalesOrderWarehouseReceiptTargetDto[]

  @ApiProperty({ type: 'string', format: 'date-time', required: false, description: '实际入仓时间；省略时使用服务器当前时间，不能早于所有所选货件的发货时间或晚于当前时间。' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u)
  receivedAt?: string

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(0, 500)
  remark?: string | null
}

export class SalesOrderWarehouseReceiptPurchaseOrderResultDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus })
  readonly fulfillmentStatus!: PurchaseOrderFulfillmentStatus
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly receivedPartCount!: number
  @ApiProperty({ type: 'boolean' }) readonly changed!: boolean
}

export class SalesOrderWarehouseReceiptSalesOrderResultDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly orderNo!: string
  @ApiProperty({ enum: SalesOrderFulfillmentStatus })
  readonly fulfillmentStatus!: SalesOrderFulfillmentStatus
  @ApiProperty({ type: 'boolean' }) readonly advancedToWarehouseArrived!: boolean
}

export class SalesOrderWarehouseReceiptResultDto {
  @ApiProperty({ type: () => [SalesOrderWarehouseReceiptPurchaseOrderResultDto] })
  readonly purchaseOrders!: readonly SalesOrderWarehouseReceiptPurchaseOrderResultDto[]
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly receivedPartCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly changedPurchaseOrderCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly remainingPendingReceiptCount!: number
  @ApiProperty({ type: () => SalesOrderWarehouseReceiptSalesOrderResultDto })
  readonly salesOrder!: SalesOrderWarehouseReceiptSalesOrderResultDto
}
