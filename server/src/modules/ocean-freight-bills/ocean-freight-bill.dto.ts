import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator'

export class OceanFreightBillIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}
export class OceanFreightBillListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1_000_000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @MaxLength(128) @Matches(/^[^\p{Cc}\p{Cs}]*$/u) keyword?: string
}
export class OceanFreightBillCreateDto {
  @ApiProperty({ maxLength: 128 }) @IsString() @MaxLength(128) billName!: string
  @ApiProperty({ description: 'Positive TWD per CNY decimal, up to 12 decimal places.' }) @IsString() @Matches(/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/u) twdPerCny!: string
  @ApiPropertyOptional({ type: 'string', format: 'date', nullable: true }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/u) billDate?: string | null
  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true }) @IsOptional() @IsUUID('4') sourceFileId?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) remark?: string | null
}
export class OceanFreightBillLineCreateDto {
  @ApiProperty({ enum: ['NORMAL', 'ADJUSTMENT'] }) @IsIn(['NORMAL', 'ADJUSTMENT']) lineType!: 'NORMAL' | 'ADJUSTMENT'
  @ApiProperty({ maxLength: 500 }) @IsString() @MaxLength(500) goodsName!: string
  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true }) @IsOptional() @IsUUID('4') loadingItemId?: string | null
  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true }) @IsOptional() @IsUUID('4') adjustsBillLineId?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 128 }) @IsOptional() @IsString() @MaxLength(128) containerBatchName?: string | null
  @ApiPropertyOptional({ type: 'string', format: 'date', nullable: true }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/u) loadingDate?: string | null
  @ApiPropertyOptional({ type: 'number', nullable: true, minimum: 1, maximum: 1000000 }) @IsOptional() @IsInt() @Min(1) @Max(1000000) packageCount?: number | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) warehouseReceiptReference?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) oceanShippingMarkText?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 32 }) @IsOptional() @IsString() @MaxLength(32) packageUnit?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 128 }) @IsOptional() @IsString() @MaxLength(128) recipientName?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) recipientPhone?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) recipientAddress?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) recipientInfoRaw?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 32 }) @IsOptional() @IsString() @MaxLength(32) cargoCategoryCode?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) remark?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, pattern: '^(0|[1-9]\\d{0,14})(\\.\\d{1,3})?$' }) @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,14})(\.\d{1,3})?$/u) grossWeightKg?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, pattern: '^(0|[1-9]\\d{0,14})(\\.\\d{1,3})?$' }) @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,14})(\.\d{1,3})?$/u) lengthCm?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, pattern: '^(0|[1-9]\\d{0,14})(\\.\\d{1,3})?$' }) @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,14})(\.\d{1,3})?$/u) widthCm?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, pattern: '^(0|[1-9]\\d{0,14})(\\.\\d{1,3})?$' }) @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,14})(\.\d{1,3})?$/u) heightCm?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, pattern: '^(0|[1-9]\\d{0,15})(\\.\\d{1,8})?$' }) @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,15})(\.\d{1,8})?$/u) reportedVolumeCai?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, pattern: '^(0|[1-9]\\d{0,27})(\\.\\d{1,2})?$' }) @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,27})(\.\d{1,2})?$/u) codAmountTwd?: string | null
}
export class OceanFreightBillDto {
  @ApiProperty() id!: string
  @ApiProperty() billNo!: string
  @ApiProperty() billName!: string
  @ApiProperty() twdPerCny!: string
  @ApiProperty() createdById!: string
  @ApiProperty() updatedById!: string
  @ApiProperty() createdAt!: string
  @ApiProperty() updatedAt!: string
  @ApiProperty({ type: 'string', nullable: true }) billDate!: string | null
  @ApiProperty({ type: 'string', nullable: true }) sourceFileId!: string | null
  @ApiProperty({ type: 'string', nullable: true }) remark!: string | null
  @ApiProperty({ type: 'string', nullable: true }) codTotalAmountTwd!: string | null
  @ApiProperty({ type: 'string', nullable: true }) chargeTotalAmountTwd!: string | null
  @ApiProperty({ type: 'string', nullable: true }) payableAmountCny!: string | null
  @ApiProperty({ type: 'string', nullable: true }) returnAmountCny!: string | null
  @ApiProperty({ type: 'string', nullable: true }) netReturnAmountCny!: string | null
  @ApiProperty({ type: 'string', nullable: true }) reportedPayableAmountCny!: string | null
  @ApiProperty({ type: 'string', nullable: true }) reportedReturnAmountCny!: string | null
  @ApiProperty({ type: 'string', nullable: true }) reportedNetReturnAmountCny!: string | null
  @ApiProperty({ type: 'string', nullable: true }) roundingDifferenceCny!: string | null
  @ApiProperty() version!: number
}
export class OceanFreightBillLineDto extends OceanFreightBillLineCreateDto {
  @ApiProperty() id!: string
  @ApiProperty() billId!: string
  @ApiProperty() createdAt!: string
  @ApiProperty() updatedAt!: string
  @ApiProperty() lineNumber!: number
  @ApiProperty() version!: number
  @ApiProperty({ enum: ['UNMATCHED', 'PENDING', 'DISPUTED', 'CONFIRMED'] }) reconciliationStatus!: string
  @ApiProperty({ type: 'string', nullable: true }) volumeCai!: string | null
  @ApiProperty({ type: 'string', nullable: true }) chargeTotalAmountTwd!: string | null
  @ApiProperty({ type: 'string', nullable: true }) payableAmountCny!: string | null
  @ApiProperty({ type: 'string', nullable: true }) returnAmountCny!: string | null
  @ApiProperty({ type: 'string', nullable: true }) netReturnAmountCny!: string | null
  @ApiProperty({ type: 'string', nullable: true }) reconciliationRemark!: string | null
  @ApiProperty({ type: 'string', nullable: true }) reconciledById!: string | null
  @ApiProperty({ type: 'string', nullable: true }) reconciledAt!: string | null
  @ApiProperty({ type: 'number', nullable: true }) chargeableVolumeCai!: number | null
}
export class OceanFreightBillPageDto {
  @ApiProperty({ type: [OceanFreightBillDto] }) items!: OceanFreightBillDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}
export class OceanFreightBillLinePageDto {
  @ApiProperty({ type: [OceanFreightBillLineDto] }) items!: OceanFreightBillLineDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}
