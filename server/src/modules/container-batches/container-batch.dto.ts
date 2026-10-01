import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'

export class ContainerBatchIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}
export class ContainerLoadingItemIdDto extends ContainerBatchIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') itemId!: string
}
export class ContainerBatchListQueryDto {
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 128) search?: string
  @ApiPropertyOptional({ maxLength: 64 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 64) warehouseValue?: string
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1, maximum: 1_000_000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1
  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
}
class ContainerBatchFieldsDto {
  @ApiProperty({ maxLength: 32, example: '0917柜' }) @IsString() @IsUnicodeCodePointLength(1, 32) containerBatchName!: string
  @ApiProperty({ maxLength: 64, description: 'Effective stable value of mainland.warehouse.' }) @IsString() @IsUnicodeCodePointLength(1, 64) warehouseValue!: string
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) remark?: string | null
}
export class ContainerBatchCreateDto extends ContainerBatchFieldsDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'Required source XLSX uploaded by the current user before creation.' }) @IsUUID('4') sourceFileId!: string
}
export class ContainerBatchUpdateDto extends ContainerBatchFieldsDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @IsOptional() @IsUUID('4') sourceFileId?: string | null
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number
}
export class ContainerLoadingItemCreateDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 128 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 128) recipientName?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 128 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 128) recipientPhone?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 2000) recipientAddress?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 31 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 31) codAmountTwd?: string | null
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @IsOptional() @IsUUID('4') shipmentId?: string | null
  @ApiPropertyOptional({ type: String, maxLength: 128, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 128) oceanShippingMarkText?: string | null
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) warehouseReceiptReference?: string | null
  @ApiProperty({ maxLength: 255 }) @IsString() @IsUnicodeCodePointLength(1, 255) goodsName!: string
  @ApiProperty({ minimum: 1, maximum: 1_000_000 }) @IsInt() @Min(1) @Max(1_000_000) packageCount!: number
  @ApiPropertyOptional({ type: String, maxLength: 32, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 32) packageUnit?: string | null
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) remark?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 19, description: 'Positive total row weight in kg; decimal(18,3). Never multiplied by packageCount.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 19) grossWeightKg?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 19, description: 'Positive per-package length in cm; decimal(18,2), matching the bill table record precision.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 19) lengthCm?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 19, description: 'Positive per-package width in cm; decimal(18,2), matching the bill table record precision.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 19) widthCm?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 19, description: 'Positive per-package height in cm; decimal(18,2), matching the bill table record precision.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 19) heightCm?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 25, description: 'Non-negative source row volume recorded at two decimals; decimal(24,2). The raw source cell stays in sourceData.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 25) reportedVolumeCai?: string | null
}
export class ContainerLoadingItemUpdateDto extends ContainerLoadingItemCreateDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2_147_483_647) itemExpectedVersion!: number
}
export class ContainerBatchDto {
  @ApiProperty() itemCount!: number
  @ApiProperty() shipmentCount!: number
  @ApiProperty() packageCountTotal!: number
  @ApiProperty({ type: String, nullable: true }) grossWeightKgTotal!: string | null
  @ApiProperty({ type: String, nullable: true }) volumeCaiTotal!: string | null
  @ApiProperty({ type: Number, nullable: true }) chargeableVolumeCaiTotal!: number | null
  @ApiProperty({ format: 'uuid' }) createdById!: string
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() containerBatchNo!: string
  @ApiProperty() containerBatchName!: string
  @ApiProperty({ type: String, format: 'date' }) loadingDate!: string
  @ApiProperty({ minimum: 1 }) sequenceInDay!: number
  @ApiProperty() warehouseValue!: string
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) sourceFileId!: string | null
  @ApiProperty({ type: String, nullable: true }) remark!: string | null
  @ApiProperty({ minimum: 1 }) version!: number
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string
}
export class ContainerBatchPageDto {
  @ApiProperty({ type: [ContainerBatchDto] }) items!: ContainerBatchDto[]
  @ApiProperty() total!: number
}
export class ContainerLoadingItemDto {
  @ApiProperty({ type: String, nullable: true }) shipmentNo!: string | null
  @ApiProperty({ type: String, nullable: true }) shippingMark!: string | null
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) purchaseOrderId!: string | null
  @ApiProperty({ type: String, nullable: true }) purchaseOrderNo!: string | null
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) salesOrderId!: string | null
  @ApiProperty({ type: String, nullable: true }) salesOrderNo!: string | null
  @ApiProperty({ type: String, nullable: true }) recipientName!: string | null
  @ApiProperty({ type: String, nullable: true }) recipientPhone!: string | null
  @ApiProperty({ type: String, nullable: true }) recipientAddress!: string | null
  @ApiProperty({ type: String, nullable: true }) codAmountTwd!: string | null
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) containerBatchId!: string
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) shipmentId!: string | null
  @ApiProperty() lineNumber!: number
  @ApiProperty({ type: String, nullable: true }) oceanShippingMarkText!: string | null
  @ApiProperty({ type: String, nullable: true }) warehouseReceiptReference!: string | null
  @ApiProperty() goodsName!: string
  @ApiProperty({ type: Number, minimum: 1 }) packageCount!: number
  @ApiProperty({ type: String, nullable: true }) packageUnit!: string | null
  @ApiProperty({ type: String, nullable: true }) remark!: string | null
  @ApiProperty() version!: number
  @ApiProperty({ type: String, nullable: true }) grossWeightKg!: string | null
  @ApiProperty({ type: String, nullable: true }) lengthCm!: string | null
  @ApiProperty({ type: String, nullable: true }) widthCm!: string | null
  @ApiProperty({ type: String, nullable: true }) heightCm!: string | null
  @ApiProperty({ type: String, nullable: true, description: 'Calculated row volume using the shared 28316 divisor, rounded to two decimals; decimal(24,2); null when dimensions are incomplete.' }) volumeCai!: string | null
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 2_147_483_647, description: 'Ceiling of the exact row volume, used as the billable quantity when pricing by volume.' }) chargeableVolumeCai!: number | null
  @ApiProperty({ type: String, nullable: true }) reportedVolumeCai!: string | null
  @ApiProperty({ type: String, nullable: true, description: 'Calculated row volume minus reported source volume; null when either is missing.' }) volumeDifferenceCai!: string | null
}
export class ContainerLoadingItemPageDto {
  @ApiProperty({ type: [ContainerLoadingItemDto] }) items!: ContainerLoadingItemDto[]
  @ApiProperty() total!: number
}
