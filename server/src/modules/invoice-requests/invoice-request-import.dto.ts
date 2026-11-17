import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import { INVOICE_REQUEST_IMPORT_ITEM_LIMIT, type InvoiceRequestImportTargetStatus } from './invoice-request-import.logic'

// 与提交载荷同一口径：台币金额用字符串传、数量用整数、统编 8 位数字。
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d{0,15}$/u
const NON_NEGATIVE_INTEGER_PATTERN = /^\d{1,16}$/u
const TAX_ID_PATTERN = /^\d{8}$/u
const NON_BLANK_PATTERN = /\S/u
const REFERENCE_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/u
const IMPORT_TARGET_STATUSES: readonly InvoiceRequestImportTargetStatus[] = ['NOTIFIED', 'ISSUED']

export class InvoiceRequestImportLineDto {
  @ApiProperty({ maxLength: 200, description: '品名，允许重复。' })
  @IsString() @Matches(NON_BLANK_PATTERN) @IsUnicodeCodePointLength(1, 200) productName!: string
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1_000_000 }) @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) quantity!: number
  @ApiProperty({ type: 'string', pattern: '^[1-9]\\d{0,15}$', description: '整数台币单价。' })
  @IsString() @Matches(POSITIVE_INTEGER_PATTERN) unitPrice!: string
}

/** 票面期望值：只做比对，不参与计算；不一致即整条失败，避免静默改数。 */
export class InvoiceRequestImportExpectedDto {
  @ApiProperty({ type: 'string', pattern: '^\\d{1,16}$', description: '期望销售额（整数台币）。' })
  @IsString() @Matches(NON_NEGATIVE_INTEGER_PATTERN) salesAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d{1,16}$', description: '期望税额（整数台币）。' })
  @IsString() @Matches(NON_NEGATIVE_INTEGER_PATTERN) taxAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d{1,16}$', description: '期望合计（整数台币）。' })
  @IsString() @Matches(NON_NEGATIVE_INTEGER_PATTERN) totalAmount!: string
}

/** 历史时间回填：省略时按导入时刻，给了就必须单调且不在未来。 */
export class InvoiceRequestImportOccurredAtDto {
  @ApiPropertyOptional({ type: 'string', description: '申请时间（ISO 8601）。省略时取导入时刻。' })
  @IsOptional() @IsString() submittedAt?: string | null
  @ApiPropertyOptional({ type: 'string', description: '通知时间（ISO 8601）。省略时等于申请时间。' })
  @IsOptional() @IsString() notifiedAt?: string | null
  @ApiPropertyOptional({ type: 'string', description: '发票照片上传时间（ISO 8601）。省略时等于通知时间。' })
  @IsOptional() @IsString() documentUploadedAt?: string | null
}

export class InvoiceRequestImportItemDto {
  @ApiProperty({ maxLength: 64, description: '批内唯一的源引用（如源表行号），用于幂等与回执定位。' })
  @IsString() @Matches(REFERENCE_PATTERN) sourceRef!: string
  @ApiProperty({ format: 'uuid', description: '归属开票人：必须是启用用户且持有 invoice-requests:read。' })
  @IsUUID('4') ownerUserId!: string
  @ApiProperty({ maxLength: 200, description: '抬头名称。' })
  @IsString() @Matches(NON_BLANK_PATTERN) @IsUnicodeCodePointLength(1, 200) buyerName!: string
  @ApiProperty({ type: 'string', pattern: '^\\d{8}$', description: '统一编号，8 位数字。' })
  @IsString() @Matches(TAX_ID_PATTERN) buyerTaxId!: string
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500, description: '发票备注，会复制给代开票方。' })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) invoiceRemark?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500, description: '内部备注，仅内部可见。' })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) internalRemark?: string | null
  @ApiProperty({ description: '寄送姓名。' })
  @IsString() @Matches(NON_BLANK_PATTERN) recipientName!: string
  @ApiProperty({ description: '寄送电话，单值单行，不做格式校验。' })
  @IsString() @Matches(NON_BLANK_PATTERN) recipientPhone!: string
  @ApiProperty({ description: '寄送地址，不要求邮递区号。' })
  @IsString() @Matches(NON_BLANK_PATTERN) recipientAddress!: string
  @ApiProperty({ type: [InvoiceRequestImportLineDto], description: '明细行，1–5 行。' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => InvoiceRequestImportLineDto)
  lines!: InvoiceRequestImportLineDto[]
  @ApiPropertyOptional({ type: InvoiceRequestImportExpectedDto, description: '票面期望值；提供时与复算结果不一致即失败。' })
  @IsOptional() @ValidateNested() @Type(() => InvoiceRequestImportExpectedDto) expected?: InvoiceRequestImportExpectedDto | null
  @ApiPropertyOptional({ type: 'string', pattern: '^\\d{1,16}$', description: '票面税额覆盖：仅导入路径生效，用于 5% 四舍五入与票面不一致的历史单。' })
  @IsOptional() @IsString() @Matches(NON_NEGATIVE_INTEGER_PATTERN) taxAmountOverride?: string | null
  @ApiProperty({ enum: IMPORT_TARGET_STATUSES, description: '目标状态：已通知开票或已开出邮寄（ISSUED 必须带照片）。' })
  @IsIn([...IMPORT_TARGET_STATUSES]) targetStatus!: InvoiceRequestImportTargetStatus
  @ApiPropertyOptional({ type: InvoiceRequestImportOccurredAtDto, description: '历史时间回填。' })
  @IsOptional() @ValidateNested() @Type(() => InvoiceRequestImportOccurredAtDto) occurredAt?: InvoiceRequestImportOccurredAtDto | null
  @ApiPropertyOptional({ format: 'uuid', description: '发票照片媒体资产；目标状态 ISSUED 时必填。' })
  @IsOptional() @IsUUID('4') documentMediaAssetId?: string | null
}

export class InvoiceRequestImportBatchDto {
  @ApiProperty({ maxLength: 64, description: '批次标识，与 sourceRef 共同构成幂等键。' })
  @IsString() @Matches(REFERENCE_PATTERN) batchRef!: string
  @ApiPropertyOptional({ default: false, description: '预检模式：完成全部校验与金额复算，不落库、不耗号。' })
  @IsOptional() @Type(() => Boolean) @IsIn([true, false]) dryRun?: boolean
  @ApiProperty({ type: [InvoiceRequestImportItemDto], description: `导入条目，1–${INVOICE_REQUEST_IMPORT_ITEM_LIMIT} 条。` })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(INVOICE_REQUEST_IMPORT_ITEM_LIMIT) @ValidateNested({ each: true }) @Type(() => InvoiceRequestImportItemDto)
  items!: InvoiceRequestImportItemDto[]
}

export class InvoiceRequestImportItemResultDto {
  @ApiProperty() sourceRef!: string
  @ApiProperty({ enum: ['CREATED', 'REPLAYED', 'VALID', 'FAILED'], description: 'CREATED 已建单；REPLAYED 幂等命中返回原单；VALID 预检通过；FAILED 失败。' })
  outcome!: 'CREATED' | 'REPLAYED' | 'VALID' | 'FAILED'
  @ApiPropertyOptional({ type: 'string', nullable: true }) invoiceRequestId!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) invoiceNo!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '失败码；成功时为 null。' }) code!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '失败原因；成功时为 null。' }) message!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '落库后的销售额（整数台币）。' }) salesAmount!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '落库后的税额（整数台币）。' }) taxAmount!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '落库后的合计（整数台币）。' }) totalAmount!: string | null
  @ApiProperty({ description: '税额是否来自票面覆盖。' }) taxOverridden!: boolean
}

export class InvoiceRequestImportBatchResultDto {
  @ApiProperty() batchRef!: string
  @ApiProperty() dryRun!: boolean
  @ApiProperty() created!: number
  @ApiProperty() replayed!: number
  @ApiProperty() valid!: number
  @ApiProperty() failed!: number
  @ApiProperty({ type: [InvoiceRequestImportItemResultDto] }) items!: InvoiceRequestImportItemResultDto[]
}
