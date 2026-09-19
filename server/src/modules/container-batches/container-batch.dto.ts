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
}
export class ContainerLoadingItemPageDto {
  @ApiProperty({ type: [ContainerLoadingItemDto] }) items!: ContainerLoadingItemDto[]
  @ApiProperty() total!: number
}
