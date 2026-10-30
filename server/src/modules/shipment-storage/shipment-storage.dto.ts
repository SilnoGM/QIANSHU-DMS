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
  ShipmentStorageClaimRequestStatus,
  ShipmentStorageLocationScope,
  ShipmentStorageStatus,
} from '../../generated/prisma/enums'

export const SHIPMENT_STORAGE_STATUSES = ['IN_STORAGE', 'RESERVED', 'CLAIMED', 'VOIDED'] as const
export const SHIPMENT_STORAGE_LOCATION_SCOPES = ['MAINLAND', 'OVERSEAS'] as const
export const SHIPMENT_STORAGE_REASONS = ['CUSTOMER_CANCEL', 'CUSTOMER_REJECT', 'OTHER'] as const
export const SHIPMENT_STORAGE_CLAIM_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const
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

export class RejectShipmentStorageClaimRequestDto {
  @ApiProperty({ type: 'string', maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string
}

export class ShipmentStorageClaimRequestParamsDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  storageRecordId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  requestId!: string
}

export class ShipmentStoragePersonDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly displayName!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly avatarUrl!: string | null
}

export class ShipmentStorageClaimRequestAllocationDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly salesOrderLineId!: string
  @ApiProperty({ type: 'integer' }) readonly lineNumber!: number
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: 'integer' }) readonly quantity!: number
}

export class ShipmentStorageClaimRequestSummaryDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: () => ShipmentStoragePersonDto }) readonly applicant!: ShipmentStoragePersonDto
  @ApiProperty({ type: 'string' }) readonly targetSalesOrderNo!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
}

export class ShipmentStorageClaimRequestDto extends ShipmentStorageClaimRequestSummaryDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly storageRecordId!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly targetSalesOrderId!: string
  @ApiProperty({ type: 'string' }) readonly costTotalCny!: string
  @ApiProperty({ type: () => [ShipmentStorageClaimRequestAllocationDto] }) readonly allocations!: readonly ShipmentStorageClaimRequestAllocationDto[]
  @ApiProperty({ type: 'string', enum: SHIPMENT_STORAGE_CLAIM_REQUEST_STATUSES }) readonly status!: ShipmentStorageClaimRequestStatus
  @ApiProperty({ type: 'string', nullable: true }) readonly rejectReason!: string | null
  @ApiProperty({ type: () => ShipmentStoragePersonDto, nullable: true }) readonly reviewedBy!: ShipmentStoragePersonDto | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly reviewedAt!: string | null
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly updatedAt!: string
}

export class ShipmentStorageIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  storageRecordId!: string
}

export class ShipmentStorageLineImageParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  storageRecordId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  lineId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  productMediaId!: string
}

export class ShipmentStorageProductImageDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly contentUrl!: string
}

export class ShipmentStorageProductPreviewDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly lineId!: string
  @ApiProperty({ type: 'integer' }) readonly lineNumber!: number
  @ApiProperty({ type: 'string', nullable: true }) readonly productNo!: string | null
  @ApiProperty({ type: 'string' }) readonly productName!: string
  @ApiProperty({ type: 'integer' }) readonly quantity!: number
  @ApiProperty({ type: () => ShipmentStorageProductImageDto, nullable: true }) readonly mainImage!: ShipmentStorageProductImageDto | null
}

export class ShipmentStorageLineSummaryDto {
  @ApiProperty({ type: 'integer' }) readonly lineCount!: number
  @ApiProperty({ type: 'integer' }) readonly totalQuantity!: number
  @ApiProperty({ type: () => [ShipmentStorageProductPreviewDto] }) readonly previews!: readonly ShipmentStorageProductPreviewDto[]
}

export class ShipmentStorageContainerBatchDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly containerBatchNo!: string
  @ApiProperty({ type: 'string' }) readonly containerBatchName!: string
  @ApiProperty({ type: 'string', format: 'date' }) readonly loadingDate!: string
}

export class ShipmentStorageContainerItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'integer' }) readonly lineNumber!: number
  @ApiProperty({ type: 'string', nullable: true }) readonly oceanShippingMarkText!: string | null
  @ApiProperty({ type: 'string' }) readonly goodsName!: string
  @ApiProperty({ type: 'integer' }) readonly packageCount!: number
  @ApiProperty({ type: 'string', nullable: true }) readonly packageUnit!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly grossWeightKg!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly lengthCm!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly widthCm!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly heightCm!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly volumeCai!: string | null
  @ApiProperty({ type: 'integer', nullable: true }) readonly chargeableVolumeCai!: number | null
  @ApiProperty({ type: 'string', nullable: true }) readonly reportedVolumeCai!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly recipientName!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly recipientPhone!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly recipientAddress!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly codAmountTwd!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly warehouseReceiptReference!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly remark!: string | null
  @ApiProperty({ type: () => ShipmentStorageContainerBatchDto }) readonly containerBatch!: ShipmentStorageContainerBatchDto
}

export class ShipmentStorageCostDto {
  @ApiProperty({ type: 'string' }) readonly purchaseCostCny!: string
  @ApiProperty({ type: 'string' }) readonly packagingCostCny!: string
  @ApiProperty({ type: 'string' }) readonly totalCostCny!: string
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
  @ApiProperty({ type: 'array', items: { type: 'string' }, description: '当前已装柜的装柜唛头，按装柜明细顺序返回' }) readonly containerMarks!: readonly string[]
  @ApiProperty({ type: () => ShipmentStorageLineSummaryDto }) readonly lineSummary!: ShipmentStorageLineSummaryDto
  @ApiProperty({ type: 'string' }) readonly originPurchaseOrderNo!: string
  @ApiProperty({ type: () => ShipmentStoragePersonDto, nullable: true }) readonly originPurchaseCreator!: ShipmentStoragePersonDto | null
  @ApiProperty({ type: 'string' }) readonly originSalesOrderNo!: string
  @ApiProperty({ type: () => ShipmentStoragePersonDto, nullable: true }) readonly originIssuer!: ShipmentStoragePersonDto | null
  @ApiProperty({ type: 'string' }) readonly originCustomerName!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly originSalesOrderId!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly originIssuerUserId!: string
  @ApiProperty({ type: () => ShipmentStorageCostDto }) readonly cost!: ShipmentStorageCostDto
  @ApiProperty({ type: () => ShipmentStorageClaimRequestSummaryDto, nullable: true }) readonly claimRequest!: ShipmentStorageClaimRequestSummaryDto | null
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly snapshotAt!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly locationUpdatedAt!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly claimedAt!: string | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly claimedSalesOrderId!: string | null
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly createdAt!: string
}

export class ShipmentStorageLocationEventDto {
  @ApiProperty({ type: 'integer' }) readonly sequence!: number
  @ApiProperty({ type: 'string', enum: SHIPMENT_STORAGE_LOCATION_SCOPES, nullable: true }) readonly fromLocationScope!: ShipmentStorageLocationScope | null
  @ApiProperty({ type: 'string', nullable: true }) readonly fromWarehouseValue!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly fromWarehouseLabel!: string | null
  @ApiProperty({ type: 'string', enum: SHIPMENT_STORAGE_LOCATION_SCOPES }) readonly locationScope!: ShipmentStorageLocationScope
  @ApiProperty({ type: 'string' }) readonly warehouseValue!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly warehouseLabel!: string | null
  @ApiProperty({ type: 'string' }) readonly reason!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly occurredAt!: string
}

export class ShipmentStorageCostTransferDto {
  @ApiProperty({ type: 'string', enum: ['RELEASE', 'CLAIM'] }) readonly direction!: 'RELEASE' | 'CLAIM'
  @ApiProperty({ type: 'string' }) readonly amountCny!: string
  @ApiProperty({ type: 'array', items: { type: 'string' }, description: '资金动账批次号；历史或零成本可能为空' }) readonly batchNos!: readonly string[]
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly occurredAt!: string
}

export class ShipmentStorageDetailDto extends ShipmentStorageListItemDto {
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) readonly originAllocations!: readonly unknown[]
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) readonly containerSnapshot!: unknown
  @ApiProperty({ type: () => [ShipmentStorageContainerItemDto] }) readonly containerLoadingItems!: readonly ShipmentStorageContainerItemDto[]
  @ApiProperty({ type: () => [ShipmentStorageLocationEventDto] }) readonly locationEvents!: readonly ShipmentStorageLocationEventDto[]
  @ApiProperty({ type: () => [ShipmentStorageCostTransferDto] }) readonly costTransfers!: readonly ShipmentStorageCostTransferDto[]
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
