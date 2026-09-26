import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'

export enum SlhBillRateSourceDto { EMBEDDED = 'EMBEDDED', SYSTEM = 'SYSTEM', MANUAL = 'MANUAL' }
export enum SlhBillPricingBasisDto { WEIGHT = 'WEIGHT', VOLUME = 'VOLUME' }
export enum SlhBillChargeTypeDto {
  FREIGHT = 'FREIGHT', COD_HANDLING = 'COD_HANDLING', HEAVY_CARGO = 'HEAVY_CARGO', DELIVERY = 'DELIVERY',
  REDELIVERY = 'REDELIVERY', TRANSFER_DELIVERY = 'TRANSFER_DELIVERY', REMOTE_AREA = 'REMOTE_AREA',
  UNLOADING = 'UNLOADING', STORAGE = 'STORAGE', WAITING = 'WAITING', OVERSIZE = 'OVERSIZE',
  INSPECTION = 'INSPECTION', FORKLIFT = 'FORKLIFT', MINIMUM_CHARGE = 'MINIMUM_CHARGE', OTHER = 'OTHER',
}

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/u
const RATE_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/u

export class SlhBillIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}

export class SlhBillListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ type: 'string', description: 'Inclusive period start lower bound (YYYY-MM-DD).' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/u) periodFrom?: string
  @ApiPropertyOptional({ type: 'string', description: 'Inclusive period end upper bound (YYYY-MM-DD).' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/u) periodTo?: string
  @ApiPropertyOptional({ maxLength: 128, description: 'Matches bill number, source file name or container batch name.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
  @ApiPropertyOptional({ type: 'string', pattern: '^(?:0|[1-9]\\d{0,27})(?:\\.\\d{1,2})?$', description: 'Minimum payable amount in CNY.' }) @IsOptional() @IsString() @Matches(AMOUNT_PATTERN) payableMin?: string
  @ApiPropertyOptional({ type: 'string', pattern: '^(?:0|[1-9]\\d{0,27})(?:\\.\\d{1,2})?$', description: 'Maximum payable amount in CNY.' }) @IsOptional() @IsString() @Matches(AMOUNT_PATTERN) payableMax?: string
  @ApiPropertyOptional({ enum: ['active', 'superseded', 'all'], default: 'active' }) @IsOptional() @IsIn(['active', 'superseded', 'all']) state?: 'active' | 'superseded' | 'all'
}

export class SlhBillLineListQueryDto extends SlhBillIdDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 50, maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number
}

export class SlhBillStagedFileDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty() fileName!: string
  @ApiProperty({ description: 'Lowercase hex SHA-256 of the uploaded bytes.' }) checksumSha256!: string
  @ApiProperty() sizeBytes!: number
}

export class SlhBillMediaAssetDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
}

export class SlhBillImportCreateDto extends SlhBillMediaAssetDto {
  @ApiPropertyOptional({ type: 'string', nullable: true, pattern: '^(?:0|[1-9]\\d{0,17})(?:\\.\\d{1,12})?$', description: 'Manual TWD per CNY rate; only allowed when the bill formula has no divisor.' })
  @IsOptional() @IsString() @Matches(RATE_PATTERN) manualForeignUnitsPerCny?: string | null
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Existing bill this import replaces.' })
  @IsOptional() @IsUUID('4') supersedesBillId?: string | null
  @ApiPropertyOptional({ default: false, description: 'Acknowledge a duplicate period and container set.' })
  @IsOptional() @Type(() => Boolean) @IsIn([true, false]) duplicateAcknowledged?: boolean
}

export class SlhBillLineChargeDto {
  @ApiProperty({ enum: SlhBillChargeTypeDto }) chargeType!: SlhBillChargeTypeDto
  @ApiProperty({ enum: ['CNY', 'TWD'] }) currencyCode!: string
  @ApiProperty({ type: 'string', description: 'Amount in the charge currency.' }) amount!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) sourceRemarkText!: string | null
}

export class SlhBillLineDto {
  @ApiProperty() lineNumber!: number
  @ApiProperty({ type: 'string', description: 'YYYY-MM-DD' }) loadingDate!: string
  @ApiProperty() containerBatchNameText!: string
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) containerBatchId!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) warehouseReceiptReference!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) shippingMarkText!: string | null
  @ApiProperty() goodsName!: string
  @ApiProperty() packageCount!: number
  @ApiPropertyOptional({ type: 'string', nullable: true }) packageUnit!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) grossWeightKg!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) weightUnit!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) lengthCm!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) widthCm!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) heightCm!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) volumeCai!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) reportedVolumeCai!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) volumeDifferenceCai!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) categoryCode!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) unitPriceAmount!: string | null
  @ApiPropertyOptional({ enum: SlhBillPricingBasisDto, nullable: true }) pricingBasis!: SlhBillPricingBasisDto | null
  @ApiProperty({ type: 'string' }) freightAmountCny!: string
  @ApiProperty({ type: 'string' }) codHandlingAmountCny!: string
  @ApiProperty({ type: 'string' }) surchargeAmountCny!: string
  @ApiProperty({ type: 'string' }) payableAmountCny!: string
  @ApiProperty({ type: 'string' }) codAmountTwd!: string
  @ApiProperty({ type: 'string' }) ntdSurchargeAmountTwd!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) recipientInfoRaw!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) remark!: string | null
  @ApiProperty({ type: [SlhBillLineChargeDto] }) charges!: SlhBillLineChargeDto[]
}

export class SlhBillLinePageDto {
  @ApiProperty({ type: [SlhBillLineDto] }) items!: SlhBillLineDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}

export class SlhBillListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() slhBillNo!: string
  @ApiProperty({ type: 'string' }) periodStart!: string
  @ApiProperty({ type: 'string' }) periodEnd!: string
  @ApiProperty() lineCount!: number
  @ApiProperty() containerBatchCount!: number
  @ApiProperty({ type: 'string' }) payableTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) ntdSurchargeTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) reportedNetAmountTwd!: string
  @ApiPropertyOptional({ enum: SlhBillRateSourceDto, nullable: true }) rateSource!: SlhBillRateSourceDto | null
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) supersededById!: string | null
  @ApiProperty() sourceFileName!: string
  @ApiProperty({ type: 'string' }) createdAt!: string
  @ApiProperty({ type: 'string' }) createdByDisplayName!: string
}

export class SlhBillPageDto {
  @ApiProperty({ type: [SlhBillListItemDto] }) items!: SlhBillListItemDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}

export class SlhBillRateDto {
  @ApiProperty({ enum: SlhBillRateSourceDto }) source!: SlhBillRateSourceDto
  @ApiProperty({ type: 'string', description: 'TWD per CNY, twelve decimals.' }) foreignUnitsPerCny!: string
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Rate embedded in the bill formula, when present.' }) embeddedForeignUnitsPerCny!: string | null
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) exchangeRateId!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) capturedAt!: string | null
}

export class SlhBillReportedDto {
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'The 小计 row payable amount.' }) subtotalPayableAmountCny!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'The 合计应付人民币 row amount, negative by the carrier convention.' }) payableAmountCny!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'The 合计应付台币NTD cell value as written by the carrier.' }) netAmountTwd!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) netAmountFormula!: string | null
  @ApiProperty({ type: 'string', description: 'Unconverted net amount: COD total minus NTD surcharge total.' }) reportedNetAmountTwd!: string
}

export class SlhBillDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() slhBillNo!: string
  @ApiProperty({ type: 'string' }) periodStart!: string
  @ApiProperty({ type: 'string' }) periodEnd!: string
  @ApiProperty() lineCount!: number
  @ApiProperty() containerBatchCount!: number
  @ApiProperty({ type: [String] }) containerBatchNames!: string[]
  @ApiProperty({ type: 'string' }) freightTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codHandlingTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) surchargeTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) payableTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) ntdSurchargeTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) reportedNetAmountTwd!: string
  @ApiPropertyOptional({ type: () => SlhBillRateDto, nullable: true }) rate!: SlhBillRateDto | null
  @ApiProperty({ type: () => SlhBillReportedDto }) reported!: SlhBillReportedDto
  @ApiProperty() sourceFileName!: string
  @ApiProperty() sourceFileSha256!: string
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) supersededById!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) supersededAt!: string | null
  @ApiProperty() version!: number
  @ApiProperty({ type: 'string' }) createdAt!: string
  @ApiProperty({ type: 'string' }) createdByDisplayName!: string
}

export class SlhBillPreviewLineDto extends SlhBillLineDto {
  @ApiProperty({ type: [String] }) notes!: string[]
  @ApiProperty({ type: [String] }) differences!: string[]
  @ApiProperty({ type: [String] }) lineWarnings!: string[]
  @ApiProperty({ type: [String] }) errors!: string[]
}

export class SlhBillTotalsDto {
  @ApiProperty({ type: 'string' }) freightTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codHandlingTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) surchargeTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) payableTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) ntdSurchargeTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) reportedNetAmountTwd!: string
}

export class SlhBillDuplicateDto {
  @ApiProperty({ format: 'uuid' }) billId!: string
  @ApiProperty() slhBillNo!: string
  @ApiProperty({ type: 'string' }) periodStart!: string
  @ApiProperty({ type: 'string' }) periodEnd!: string
}

export class SlhBillImportPreviewDto {
  @ApiProperty({ type: 'string' }) periodStart!: string
  @ApiProperty({ type: 'string' }) periodEnd!: string
  @ApiProperty({ type: [String] }) containerBatchNames!: string[]
  @ApiProperty() lineCount!: number
  @ApiProperty() containerBatchCount!: number
  @ApiProperty({ type: () => SlhBillTotalsDto }) totals!: SlhBillTotalsDto
  @ApiProperty({ type: () => SlhBillReportedDto }) reported!: SlhBillReportedDto
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'System TWD per CNY rate read for preview; null when the bill embeds its own rate.' })
  systemForeignUnitsPerCny!: string | null
  @ApiPropertyOptional({ type: () => SlhBillDuplicateDto, nullable: true }) duplicate!: SlhBillDuplicateDto | null
  @ApiProperty({ type: [String] }) differences!: string[]
  @ApiProperty({ type: [String] }) warnings!: string[]
  @ApiProperty({ type: [SlhBillPreviewLineDto] }) lines!: SlhBillPreviewLineDto[]
}
