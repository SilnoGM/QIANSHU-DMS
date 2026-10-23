import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateIf } from 'class-validator'

import { PurchaseOrderLineType, PurchaseOrderPartStatus, PurchaseOrderProductMode, PurchaseOrderStatus, PurchaseOrderType } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { isNormalizableDictionaryItemValue, normalizeDictionaryItemValue } from '../../dictionaries/dictionary.normalizer'
import { PurchaseOrderActorDto, PurchaseOrderListImageDto, PurchaseOrderSourceSalesOrderDto, PurchaseOrderSupplierDto } from '../dto/purchase-order-response.dto'

export const PURCHASE_SHIPMENT_VIEWS = ['ALL', 'PENDING_REVIEW', 'AWAITING_SHIPMENT', 'SHIPPED', 'WAREHOUSE_RECEIVED', 'CONTAINER_LOADED', 'DELIVERED', 'CANCELLED'] as const
export type PurchaseShipmentView = typeof PURCHASE_SHIPMENT_VIEWS[number]
export const PURCHASE_SHIPMENT_SORTS = ['CREATED_DESC', 'SHIPPED_DESC', 'WAREHOUSE_RECEIVED_DESC'] as const
export type PurchaseShipmentSort = typeof PURCHASE_SHIPMENT_SORTS[number]
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class PurchaseShipmentFilterDto {
  @ApiProperty({ type: 'string', maxLength: 128, required: false, description: '货件编号、物流单号、采购单号、基础唛头、货件唛头、销售单号、客户、产品名称或自定义供应商名称' })
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

  @ApiProperty({ type: 'string', maxLength: 64, required: false, description: 'mainland.warehouse 的稳定 value；按字典规则规范化，允许历史停用或未知值；不能与 destinationWarehouseMissing=true 同时使用' })
  @Transform(({ value }: { value: unknown }) => isNormalizableDictionaryItemValue(value) ? normalizeDictionaryItemValue(value) : value)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString() @IsUnicodeCodePointLength(1, 64) @Matches(/^[A-Z0-9][A-Z0-9._-]*$/u)
  destinationWarehouseValue?: string

  @ApiProperty({ type: 'boolean', required: false, description: '仅 true 筛选目的地仓库未记录（null）的历史货件；false 或省略均不添加缺失条件；true 与 destinationWarehouseValue 互斥' })
  @Transform(({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  destinationWarehouseMissing?: boolean

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

  @ApiProperty({ enum: PURCHASE_SHIPMENT_SORTS, required: false, default: 'CREATED_DESC', description: '按创建、发货或实际到仓时间降序；空时间置后，以创建时间、采购单、货件顺序和 ID 保持分页稳定' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(PURCHASE_SHIPMENT_SORTS)
  sort?: PurchaseShipmentSort

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

export class PurchaseShipmentDestinationWarehouseDto {
  @ApiProperty({ type: 'string', description: '历史保存的仓库字典稳定 value' }) readonly value!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly label!: string | null
  @ApiProperty({ type: 'boolean' }) readonly known!: boolean
  @ApiProperty({ type: 'boolean' }) readonly effectiveEnabled!: boolean
}

export class PurchaseShipmentContainerBatchDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly containerBatchNo!: string
  @ApiProperty({ type: 'string' }) readonly containerBatchName!: string
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
  @ApiProperty({ type: 'string', maxLength: 64, nullable: true, description: 'mainland.warehouse 的稳定 value；历史未记录时为空' }) readonly destinationWarehouseValue!: string | null
  @ApiProperty({ type: () => PurchaseShipmentDestinationWarehouseDto, nullable: true }) readonly destinationWarehouse!: PurchaseShipmentDestinationWarehouseDto | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, description: '仓库实际收货时间，不代表库存记账' }) readonly warehouseReceivedAt!: string | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) readonly warehouseReceivedById!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly warehouseRecordedAt!: string | null
  @ApiProperty({ type: 'string', maxLength: 500, nullable: true }) readonly warehouseRemark!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true }) readonly warehouseReceivedBy!: PurchaseOrderActorDto | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, description: '被装柜明细关联的装柜时间；未装柜时为空，关联移除后不回退' }) readonly loadedAt!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true }) readonly loadedBy!: PurchaseOrderActorDto | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly loadedRecordedAt!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, description: '客户签收时间；签收后不可回退' }) readonly deliveredAt!: string | null
  @ApiProperty({ type: () => PurchaseOrderActorDto, nullable: true }) readonly deliveredBy!: PurchaseOrderActorDto | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly deliveredRecordedAt!: string | null
  @ApiProperty({ type: 'string', maxLength: 500, nullable: true }) readonly deliveryRemark!: string | null
  @ApiProperty({ type: () => PurchaseShipmentContainerBatchDto, nullable: true, description: '货件当前所在装柜柜次；未装柜或历史解绑后为空' }) readonly containerBatch!: PurchaseShipmentContainerBatchDto | null
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

export class PurchaseShipmentDeliverRequestDto {
  @ApiProperty({ type: 'string', maxLength: 500, nullable: true, required: false, description: '签收备注；仅随签收事实一次保存' })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500)
  remark?: string | null
}

export class PurchaseShipmentDeliverResultDto {
  @ApiProperty({ type: () => PurchaseShipmentDetailDto }) readonly shipment!: PurchaseShipmentDetailDto
  @ApiProperty({ type: 'boolean', description: '本次签收后销售订单是否已签收' }) readonly salesOrderSigned!: boolean
  @ApiProperty({ type: 'integer', minimum: 0, description: '同一销售订单下仍未签收的有效货件数；库存采购固定为 0' }) readonly remainingShipmentCount!: number
  @ApiProperty({ type: 'boolean', description: '全部货件已签收但缺少有效签收单时为 true；此时货件已签收，订单保持待签收' }) readonly salesOrderReceiptRequired!: boolean
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

export class PurchaseShipmentWarehouseStatusCountsDto {
  @ApiProperty({ type: 'string' }) readonly value!: string
  @ApiProperty({ type: () => [PurchaseShipmentStatusCountDto] }) readonly items!: readonly PurchaseShipmentStatusCountDto[]
}

export class PurchaseShipmentStatusCountsDto {
  @ApiProperty({ type: () => [PurchaseShipmentStatusCountDto] }) readonly items!: readonly PurchaseShipmentStatusCountDto[]
  @ApiProperty({ type: () => [PurchaseOrderActorDto], description: '有货件的采购单采购人，不受当前筛选影响' }) readonly buyerOptions!: readonly PurchaseOrderActorDto[]
  @ApiPropertyOptional({
    type: () => [PurchaseShipmentWarehouseStatusCountsDto],
    description: '已到仓视图下按目的地仓库分组的各视图计数；一次请求替代逐仓库计数',
  }) readonly warehouseCounts?: readonly PurchaseShipmentWarehouseStatusCountsDto[]
}
