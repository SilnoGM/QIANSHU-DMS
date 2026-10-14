import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import { INVOICE_REQUEST_LINE_LIMIT, type InvoiceRequestStatusValue } from './invoice-request.contract'
import { INVOICE_REQUEST_STATUS_FILTER_VALUES, type InvoiceRequestStatusFilterValue } from './invoice-request-list-filter'

// 台币金额与数量都是整数：金额用字符串传（仓库金额惯例），数量用整数。
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d{0,15}$/u
const TAX_ID_PATTERN = /^\d{8}$/u
const NON_BLANK_PATTERN = /\S/u

export class InvoiceRequestIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}

export class InvoiceRequestLineInputDto {
  @ApiProperty({ maxLength: 200, description: '品名，允许重复。' })
  @IsString() @Matches(NON_BLANK_PATTERN) @IsUnicodeCodePointLength(1, 200) productName!: string
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1_000_000 }) @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) quantity!: number
  @ApiProperty({ type: 'string', pattern: '^[1-9]\\d{0,15}$', description: '整数台币单价。' })
  @IsString() @Matches(POSITIVE_INTEGER_PATTERN) unitPrice!: string
}

/** 提交与重新提交共用同一份开票信息载荷；重新提交额外要求版本号。 */
export class InvoiceRequestSubmitDto {
  @ApiProperty({ maxLength: 200, description: '抬头名称（手填）。' })
  @IsString() @Matches(NON_BLANK_PATTERN) @IsUnicodeCodePointLength(1, 200) buyerName!: string
  @ApiProperty({ type: 'string', pattern: '^\\d{8}$', description: '统一编号，8 位数字。' })
  @IsString() @Matches(TAX_ID_PATTERN) buyerTaxId!: string
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500, description: '发票备注，会随开票信息复制给代开票方。' })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) invoiceRemark?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500, description: '申请单备注，仅内部可见，不复制给代开票方。' })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) internalRemark?: string | null
  @ApiProperty({ description: '寄送姓名（不设业务长度上限）。' })
  @IsString() @Matches(NON_BLANK_PATTERN) recipientName!: string
  @ApiProperty({ description: '寄送电话，单值单行文本，不做格式校验。' })
  @IsString() @Matches(NON_BLANK_PATTERN) recipientPhone!: string
  @ApiProperty({ description: '寄送地址，不要求邮递区号。' })
  @IsString() @Matches(NON_BLANK_PATTERN) recipientAddress!: string
  @ApiProperty({ type: [InvoiceRequestLineInputDto], description: `明细行，1–${INVOICE_REQUEST_LINE_LIMIT} 行。` })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(INVOICE_REQUEST_LINE_LIMIT) @ValidateNested({ each: true }) @Type(() => InvoiceRequestLineInputDto)
  lines!: InvoiceRequestLineInputDto[]
  @ApiPropertyOptional({ default: false, description: '确认「存在抬头、统编、营业税与总计完全一致的申请单」后继续提交。' })
  @IsOptional() @Type(() => Boolean) @IsIn([true, false]) duplicateAcknowledged?: boolean
}

export class InvoiceRequestResubmitDto extends InvoiceRequestSubmitDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '客户端读到的单据版本号。' })
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number
}

export class InvoiceRequestReturnDto {
  @ApiProperty({ maxLength: 500, description: '退回原因，必填。' })
  @IsString() @Matches(NON_BLANK_PATTERN) @IsUnicodeCodePointLength(1, 500) reason!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number
}

export class InvoiceRequestNotifyDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number
}

export class InvoiceRequestCancelDto {
  @ApiProperty({ maxLength: 500, description: '取消原因，必填。' })
  @IsString() @Matches(NON_BLANK_PATTERN) @IsUnicodeCodePointLength(1, 500) reason!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number
}

export class InvoiceRequestSettleDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number
  @ApiProperty({ format: 'uuid', description: '客户端展示时使用的汇率记录 id。' }) @IsUUID('4') exchangeRateId!: string
  @ApiProperty({ type: 'integer', minimum: 1, description: '客户端展示时使用的汇率版本号。' }) @Type(() => Number) @IsInt() @Min(1) exchangeRateVersion!: number
}

export class InvoiceRequestListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ enum: INVOICE_REQUEST_STATUS_FILTER_VALUES, default: 'ALL' })
  @IsOptional() @IsIn(INVOICE_REQUEST_STATUS_FILTER_VALUES) status?: InvoiceRequestStatusFilterValue
  @ApiPropertyOptional({ maxLength: 128, description: '匹配申请单号、抬头、统编、备注或寄送姓名。' })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
}

/** 计数查询与列表共用同一组筛选，只去掉分页（计数覆盖完整结果集，不是当前页）。 */
export class InvoiceRequestStatusCountsQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_REQUEST_STATUS_FILTER_VALUES, default: 'ALL' })
  @IsOptional() @IsIn(INVOICE_REQUEST_STATUS_FILTER_VALUES) status?: InvoiceRequestStatusFilterValue
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
}

export class InvoiceRequestStatusCountDto {
  @ApiProperty({ enum: INVOICE_REQUEST_STATUS_FILTER_VALUES }) value!: InvoiceRequestStatusFilterValue
  @ApiProperty() count!: number
}

export class InvoiceRequestStatusCountsDto {
  @ApiProperty({ type: [InvoiceRequestStatusCountDto], description: '每个状态的数量，外加 ALL 的合计；当前关键词筛选生效，状态筛选不生效。' })
  statuses!: InvoiceRequestStatusCountDto[]
}

export class InvoiceRequestLineDto {
  @ApiProperty() lineNo!: number
  @ApiProperty() productName!: string
  @ApiProperty() quantity!: number
  @ApiProperty({ type: 'string', description: '整数台币单价。' }) unitPrice!: string
  @ApiProperty({ type: 'string', description: '金额 = 数量 × 单价（服务端复算，不接受手填）。' }) amount!: string
}

export class InvoiceRequestHistoryDto {
  @ApiProperty() action!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) fromStatus!: InvoiceRequestStatusValue | null
  @ApiProperty() toStatus!: InvoiceRequestStatusValue
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '退回与取消必填。' }) reason!: string | null
  @ApiProperty() actorUserId!: string
  @ApiProperty() actorName!: string
  @ApiProperty({ type: 'string', description: 'ISO 8601。' }) occurredAt!: string
}

export class InvoiceRequestDocumentDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty() fileName!: string
  @ApiProperty({ type: 'string', description: 'ISO 8601。' }) uploadedAt!: string
}

export class InvoiceRequestListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ type: 'integer', description: '乐观锁版本号；写动作必须回传它，冲突时服务端返回 STATE_CHANGED。' }) version!: number
  @ApiProperty() invoiceNo!: string
  @ApiProperty({ enum: INVOICE_REQUEST_STATUS_FILTER_VALUES }) status!: InvoiceRequestStatusValue
  @ApiProperty() buyerName!: string
  @ApiProperty() buyerTaxId!: string
  @ApiProperty({ type: 'string' }) salesAmount!: string
  @ApiProperty({ type: 'string' }) taxAmount!: string
  @ApiProperty({ type: 'string' }) totalAmount!: string
  @ApiProperty() lineCount!: number
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '首行品名，多行时以「等 N 项」收尾。' }) lineSummary!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) invoiceRemark!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) internalRemark!: string | null
  @ApiProperty({ format: 'uuid' }) creatorUserId!: string
  @ApiProperty() creatorName!: string
  @ApiProperty({ type: 'string', description: '申请日期（= 记录创建时间），ISO 8601。' }) submittedAt!: string
  @ApiProperty({ type: 'string', description: '最近一次提交时间，ISO 8601。' }) lastSubmittedAt!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) notifiedAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) returnedAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '最近一次退回原因。' }) latestReturnReason!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '发票上传日期，ISO 8601。' }) documentUploadedAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '可结算时刻（上传 + 120 小时），ISO 8601。' }) settleableAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) settledAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '入账成本（人民币，两位小数）。' }) settleAmountCny!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) cancelledAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) cancelReason!: string | null
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: '发票照片；有值即可用单据详情的内容接口读取。' }) documentMediaAssetId!: string | null
}

export class InvoiceRequestDto extends InvoiceRequestListItemDto {
  @ApiProperty() recipientName!: string
  @ApiProperty() recipientPhone!: string
  @ApiProperty() recipientAddress!: string
  @ApiProperty({ type: [InvoiceRequestLineDto] }) lines!: InvoiceRequestLineDto[]
  @ApiProperty({ type: [InvoiceRequestHistoryDto] }) history!: InvoiceRequestHistoryDto[]
  @ApiPropertyOptional({ type: InvoiceRequestDocumentDto, nullable: true }) document!: InvoiceRequestDocumentDto | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '结算时冻结的汇率（1 人民币 = 多少外币单位）。' }) foreignUnitsPerCnySnapshot!: string | null
  @ApiPropertyOptional({ type: 'integer', nullable: true }) exchangeRateVersionSnapshot!: number | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '汇率取数时刻，ISO 8601。' }) rateCapturedAt!: string | null
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) fundPostingBatchId!: string | null
}

export class InvoiceRequestPageDto {
  @ApiProperty({ type: [InvoiceRequestListItemDto] }) items!: InvoiceRequestListItemDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}
