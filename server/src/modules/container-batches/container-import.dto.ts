import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsString, IsUUID, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator'
import { PurchaseOrderType } from '../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import { PURCHASE_SHIPMENT_VIEWS, PurchaseShipmentContainerBatchDto, type PurchaseShipmentView } from '../purchase-orders/shipments/purchase-shipment.dto'
import type { ReferenceField } from './import-matching'

export class ContainerImportCandidateDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ type: String, nullable: true }) shipmentNo!: string | null
  @ApiProperty({ type: String, nullable: true }) shippingMarkText!: string | null
  @ApiProperty({ type: String, nullable: true }) trackingNo!: string | null
  @ApiProperty({ type: String, nullable: true }) warehouseValue!: string | null
  @ApiProperty() goodsName!: string
  @ApiProperty({ type: String, nullable: true }) purchaseOrderNo!: string | null
  @ApiProperty({ type: String, nullable: true }) salesOrderNo!: string | null
  @ApiProperty({ type: String, nullable: true, description: '销售订单客户名；库存采购为空。按采购域口径随 purchase-orders:read 返回。' }) customerName!: string | null
  @ApiProperty({ enum: PurchaseOrderType }) purchaseType!: PurchaseOrderType
  @ApiProperty({ enum: PURCHASE_SHIPMENT_VIEWS.filter(value => value !== 'ALL') }) viewStatus!: Exclude<PurchaseShipmentView, 'ALL'>
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) warehouseReceivedAt!: string | null
  @ApiProperty({ type: () => PurchaseShipmentContainerBatchDto, nullable: true, description: '货件当前所在柜次；未装柜为空。' }) containerBatch!: PurchaseShipmentContainerBatchDto | null
  @ApiProperty({ enum: ['shippingMarkText', 'trackingNo', 'shipmentNo'], isArray: true, description: '该候选命中的精确标识字段。' }) matchFields!: ReferenceField[]
  @ApiProperty() eligible!: boolean
  @ApiProperty({ type: String, nullable: true }) ineligibleReason!: string | null
}
export class ContainerImportRowDto {
  @ApiProperty() rowKey!: string
  @ApiProperty() sourceSheetName!: string
  @ApiProperty() sourceRowNumber!: number
  @ApiProperty({ type: String, nullable: true }) containerBatchName!: string | null
  @ApiProperty({ type: String, nullable: true }) warehouseReceiptReference!: string | null
  @ApiProperty({ type: String, nullable: true }) oceanShippingMarkText!: string | null
  @ApiProperty() goodsName!: string
  @ApiProperty() packageCount!: number
  @ApiProperty({ type: String, nullable: true }) packageUnit!: string | null
  @ApiProperty({ type: String, nullable: true }) grossWeightKg!: string | null
  @ApiProperty({ type: String, nullable: true }) lengthCm!: string | null
  @ApiProperty({ type: String, nullable: true }) widthCm!: string | null
  @ApiProperty({ type: String, nullable: true }) heightCm!: string | null
  @ApiProperty({ type: String, nullable: true }) reportedVolumeCai!: string | null
  @ApiProperty({ type: String, nullable: true }) volumeCai!: string | null
  @ApiProperty({ type: Number, nullable: true }) chargeableVolumeCai!: number | null
  @ApiProperty({ type: String, nullable: true }) recipientName!: string | null
  @ApiProperty({ type: String, nullable: true }) recipientPhone!: string | null
  @ApiProperty({ type: String, nullable: true }) recipientAddress!: string | null
  @ApiProperty({ type: String, nullable: true }) codAmountTwd!: string | null
  @ApiProperty({ type: String, nullable: true }) remark!: string | null
  @ApiProperty({ type: [String] }) errors!: string[]
  @ApiProperty({ type: [String] }) warnings!: string[]
  @ApiProperty({ type: [ContainerImportCandidateDto] }) candidates!: ContainerImportCandidateDto[]
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) matchedShipmentId!: string | null
  @ApiProperty({ enum: ['MATCHED', 'AMBIGUOUS', 'UNMATCHED', 'INVALID', 'SKIPPED'] }) matchStatus!: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'INVALID' | 'SKIPPED'
  @ApiProperty({ type: String, nullable: true }) matchReason!: string | null
}
export class ContainerImportPreviewDto {
  @ApiProperty({ format: 'uuid' }) containerBatchId!: string
  @ApiProperty() containerBatchName!: string
  @ApiProperty() containerBatchNo!: string
  @ApiProperty() warehouseValue!: string
  @ApiProperty() expectedVersion!: number
  @ApiProperty({ format: 'uuid' }) sourceFileId!: string
  @ApiProperty() sourceFilename!: string
  @ApiProperty() sourceHash!: string
  @ApiProperty({ description: 'All source rows already exist by source identity or ocean shipping mark.' }) alreadyImported!: boolean
  @ApiProperty({ type: [ContainerImportRowDto] }) rows!: ContainerImportRowDto[]
  @ApiProperty({ type: [String] }) warnings!: string[]
}
export class ContainerImportSelectionDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @IsUnicodeCodePointLength(1, 64) rowKey!: string
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) @ValidateIf((_object, value) => value !== null) @IsUUID('4') shipmentId!: string | null
}
export class ContainerImportConfirmDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') sourceFileId!: string
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' }) @IsString() @Matches(/^[a-f0-9]{64}$/u) sourceHash!: string
  @ApiProperty({ description: 'Explicit acknowledgement that pending unmatched rows will be imported without shipment associations; existing rows are skipped.' }) @IsBoolean() allowUnmatched!: boolean
  @ApiProperty({ type: [ContainerImportSelectionDto], minItems: 1, maxItems: 2000 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ContainerImportSelectionDto) rows!: ContainerImportSelectionDto[]
}
export class ContainerImportResultDto {
  @ApiProperty({ format: 'uuid' }) containerBatchId!: string
  @ApiProperty() importedCount!: number
  @ApiProperty() skippedCount!: number
  @ApiProperty() unmatchedCount!: number
  @ApiProperty() replayed!: boolean
}
