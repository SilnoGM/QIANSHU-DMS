import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import type {
  ShipmentStorageLocationScope,
  ShipmentStorageStatus,
} from '../../generated/prisma/enums'

export const SHIPMENT_STORAGE_STATUSES = ['IN_STORAGE', 'RESERVED', 'CLAIMED', 'VOIDED'] as const
export const SHIPMENT_STORAGE_LOCATION_SCOPES = ['MAINLAND', 'OVERSEAS'] as const
export const SHIPMENT_STORAGE_REASONS = ['CUSTOMER_CANCEL', 'CUSTOMER_REJECT', 'OTHER'] as const
const WAREHOUSE_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

export class ShipmentStorageListQueryDto {
  @ApiProperty({ type: 'string', format: 'uuid', required: false, description: '精确查看单条寄仓记录；用于从货件列表跳转' })
  @IsOptional()
  @IsUUID('4')
  storageId?: string

  @ApiProperty({ enum: SHIPMENT_STORAGE_STATUSES, required: false })
  @IsOptional()
  @IsIn(SHIPMENT_STORAGE_STATUSES)
  status?: ShipmentStorageStatus

  @ApiProperty({ enum: SHIPMENT_STORAGE_LOCATION_SCOPES, required: false })
  @IsOptional()
  @IsIn(SHIPMENT_STORAGE_LOCATION_SCOPES)
  locationScope?: ShipmentStorageLocationScope

  @ApiProperty({ type: 'string', maxLength: 64, required: false })
  @IsOptional()
  @IsString()
  @Matches(WAREHOUSE_VALUE_PATTERN)
  warehouseValue?: string

  @ApiProperty({ type: 'string', maxLength: 128, required: false, description: '货件编号、唛头、来源销售单号、来源采购单号或客户名称' })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  keyword?: string

  @ApiProperty({ type: 'integer', minimum: 1, default: 1, required: false })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100, default: 20, required: false })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}

export class ReleaseShipmentStorageRequestDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 50 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  shipmentIds!: string[]

  @ApiProperty({ enum: SHIPMENT_STORAGE_LOCATION_SCOPES })
  @IsIn(SHIPMENT_STORAGE_LOCATION_SCOPES)
  locationScope!: ShipmentStorageLocationScope

  @ApiProperty({ type: 'string', maxLength: 64, required: false, description: '仅 OVERSEAS 使用：overseas.warehouse 的稳定 value' })
  @IsOptional()
  @Matches(WAREHOUSE_VALUE_PATTERN)
  overseasWarehouseValue?: string

  @ApiProperty({ enum: SHIPMENT_STORAGE_REASONS })
  @IsIn(SHIPMENT_STORAGE_REASONS)
  reason!: typeof SHIPMENT_STORAGE_REASONS[number]

  @ApiProperty({ type: 'string', maxLength: 500, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(0, 500)
  note?: string | null

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  requestKey!: string
}

export class RelocateShipmentStorageRequestDto {
  @ApiProperty({ type: 'string', maxLength: 64, description: 'overseas.warehouse 的稳定 value' })
  @Matches(WAREHOUSE_VALUE_PATTERN)
  warehouseValue!: string

  @ApiProperty({ type: 'string', maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  requestKey!: string
}

export class ClaimShipmentStorageLineDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  salesOrderLineId!: string

  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number
}

export class ClaimShipmentStorageRequestDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  salesOrderId!: string

  @ApiProperty({ type: () => [ClaimShipmentStorageLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  lines!: ClaimShipmentStorageLineDto[]

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  requestKey!: string
}

export class ShipmentStorageIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  storageRecordId!: string
}

export class ShipmentStorageCostDto {
  @ApiProperty({ type: 'string' }) readonly purchaseCostCny!: string
  @ApiProperty({ type: 'string' }) readonly packagingCostCny!: string
  @ApiProperty({ type: 'string' }) readonly totalCostCny!: string
  @ApiProperty({ type: 'string' }) readonly originalShareRate!: string
  @ApiProperty({ type: 'string' }) readonly userLegCny!: string
  @ApiProperty({ type: 'string' }) readonly companyLegCny!: string
}

export class ShipmentStorageListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly shipmentId!: string
  @ApiProperty({ type: 'string', enum: SHIPMENT_STORAGE_STATUSES }) readonly status!: ShipmentStorageStatus
  @ApiProperty({ type: 'string', enum: SHIPMENT_STORAGE_LOCATION_SCOPES }) readonly locationScope!: ShipmentStorageLocationScope
  @ApiProperty({ type: 'string' }) readonly warehouseValue!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly warehouseLabel!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly shipmentNo!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: 'string' }) readonly originPurchaseOrderNo!: string
  @ApiProperty({ type: 'string' }) readonly originSalesOrderNo!: string
  @ApiProperty({ type: 'string' }) readonly originCustomerName!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly originSalesOrderId!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly originIssuerUserId!: string
  @ApiProperty({ type: () => ShipmentStorageCostDto }) readonly cost!: ShipmentStorageCostDto
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly snapshotAt!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly locationUpdatedAt!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly claimedAt!: string | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly claimedSalesOrderId!: string | null
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
}

export class ShipmentStorageLocationEventDto {
  @ApiProperty({ type: 'integer' }) readonly sequence!: number
  @ApiProperty({ type: 'string', enum: SHIPMENT_STORAGE_LOCATION_SCOPES }) readonly locationScope!: ShipmentStorageLocationScope
  @ApiProperty({ type: 'string' }) readonly warehouseValue!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly warehouseLabel!: string | null
  @ApiProperty({ type: 'string' }) readonly reason!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly occurredAt!: string
}

export class ShipmentStorageDetailDto extends ShipmentStorageListItemDto {
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) readonly originAllocations!: readonly unknown[]
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) readonly containerSnapshot!: unknown
  @ApiProperty({ type: () => [ShipmentStorageLocationEventDto] }) readonly locationEvents!: readonly ShipmentStorageLocationEventDto[]
}

export class ShipmentStoragePageDto {
  @ApiProperty({ type: () => [ShipmentStorageListItemDto] }) readonly items!: readonly ShipmentStorageListItemDto[]
  @ApiProperty({ type: 'integer' }) readonly page!: number
  @ApiProperty({ type: 'integer' }) readonly pageSize!: number
  @ApiProperty({ type: 'integer' }) readonly total!: number
}

export const SHIPMENT_STORAGE_COUNT_VALUES = ['ALL', 'IN_STORAGE', 'CLAIMED', 'VOIDED'] as const

export class ShipmentStorageStatusCountDto {
  @ApiProperty({ enum: SHIPMENT_STORAGE_COUNT_VALUES }) readonly value!: typeof SHIPMENT_STORAGE_COUNT_VALUES[number]
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
}

export class ShipmentStorageStatusCountsDto {
  @ApiProperty({ type: () => [ShipmentStorageStatusCountDto] }) readonly items!: readonly ShipmentStorageStatusCountDto[]
}
