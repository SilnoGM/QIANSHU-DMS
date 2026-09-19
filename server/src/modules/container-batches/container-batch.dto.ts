import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'

export class ContainerBatchIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}
export class ContainerBatchListQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1, maximum: 1_000_000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1
  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
}
export class ContainerBatchCreateDto {
  @ApiProperty({ maxLength: 32, example: '0917柜' }) @IsString() @IsUnicodeCodePointLength(1, 32) containerBatchName!: string
  @ApiProperty({ maxLength: 64, description: 'Effective stable value of mainland.warehouse.' }) @IsString() @IsUnicodeCodePointLength(1, 64) warehouseValue!: string
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @IsOptional() @IsUUID('4') sourceFileId?: string | null
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) remark?: string | null
}
export class ContainerLoadingItemCreateDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @IsOptional() @IsUUID('4') shipmentId?: string | null
  @ApiPropertyOptional({ type: String, maxLength: 128, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 128) oceanShippingMarkText?: string | null
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) warehouseReceiptReference?: string | null
  @ApiProperty({ maxLength: 255 }) @IsString() @IsUnicodeCodePointLength(1, 255) goodsName!: string
  @ApiProperty({ minimum: 1, maximum: 1_000_000 }) @IsInt() @Min(1) @Max(1_000_000) packageCount!: number
  @ApiPropertyOptional({ type: String, maxLength: 32, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 32) packageUnit?: string | null
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) remark?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 19, description: 'Positive total row weight in kg; decimal(18,3). Never multiplied by packageCount.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 19) grossWeightKg?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 19, description: 'Positive per-package length in cm; decimal(18,3).' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 19) lengthCm?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 19, description: 'Positive per-package width in cm; decimal(18,3).' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 19) widthCm?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 19, description: 'Positive per-package height in cm; decimal(18,3).' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 19) heightCm?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 25, description: 'Non-negative source row volume; decimal(24,8). Preserved for comparison.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 25) reportedVolumeCai?: string | null
}
export class ContainerBatchDto {
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
  @ApiProperty({ type: String, nullable: true, description: 'Calculated row volume, rounded to eight decimals; null when dimensions are incomplete.' }) volumeCai!: string | null
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 2_147_483_647, description: 'Ceiling of the full precision row volume, before display rounding.' }) chargeableVolumeCai!: number | null
  @ApiProperty({ type: String, nullable: true }) reportedVolumeCai!: string | null
  @ApiProperty({ type: String, nullable: true, description: 'Calculated row volume minus reported source volume; null when either is missing.' }) volumeDifferenceCai!: string | null
}
export class ContainerLoadingItemPageDto {
  @ApiProperty({ type: [ContainerLoadingItemDto] }) items!: ContainerLoadingItemDto[]
  @ApiProperty() total!: number
}
