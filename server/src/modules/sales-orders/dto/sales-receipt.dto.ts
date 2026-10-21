import { SalesOrderPaymentType } from '../../../generated/prisma/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsDefined, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator'
import { SalesOrderPaymentRequestDto } from './sales-order-mutation.dto'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export enum SalesReceiptStatusDto { PENDING_REVIEW = 'PENDING_REVIEW', APPROVED = 'APPROVED', REJECTED = 'REJECTED' }
export enum SalesReceiptViewDto { PENDING_REVIEW = 'PENDING_REVIEW', APPROVED = 'APPROVED', REJECTED = 'REJECTED', VOIDED = 'VOIDED' }
export class SalesReceiptRequestCreateDto extends SalesOrderPaymentRequestDto {
  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true })
  @IsOptional() @IsUUID('4') resubmittedFromId?: string | null
}
export class SalesReceiptIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}
export class SalesReceiptOrderIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') salesOrderId!: string
}
export class SalesReceiptOrderVoucherIdDto extends SalesReceiptOrderIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') requestId!: string
}
export class SalesReceiptListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ enum: SalesReceiptViewDto, description: '财务视图，优先于 status；APPROVED 仅含未作废收款，VOIDED 仅含已通过后作废的收款' }) @IsOptional() @IsEnum(SalesReceiptViewDto) view?: SalesReceiptViewDto
  @ApiPropertyOptional({ enum: SalesReceiptStatusDto }) @IsOptional() @IsEnum(SalesReceiptStatusDto) status?: SalesReceiptStatusDto
  @ApiPropertyOptional() @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
  @ApiPropertyOptional({ enum: ['TWD', 'MYR'] }) @IsOptional() @IsEnum({ TWD: 'TWD', MYR: 'MYR' }) currencyCode?: string
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('4') accountOwnerUserId?: string
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsString() submittedFrom?: string
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsString() submittedTo?: string
}
export class SalesReceiptExpectedContextDto {
  @ApiProperty() @IsInt() @Min(1) orderVersion!: number
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') exchangeRateId!: string
  @ApiProperty() @IsInt() @Min(1) exchangeRateVersion!: number
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') ruleVersionId!: string
  @ApiProperty() @IsString() userShareRate!: string
}
export class SalesReceiptRejectDto {
  @ApiProperty() @IsInt() @Min(1) expectedVersion!: number
  @ApiProperty({ maxLength: 500 }) @IsString() @IsUnicodeCodePointLength(1, 500) reason!: string
}
export class SalesReceiptApproveDto {
  @ApiProperty() @IsInt() @Min(1) expectedVersion!: number
  @ApiProperty({ type: () => SalesReceiptExpectedContextDto }) @IsDefined() @ValidateNested() @Type(() => SalesReceiptExpectedContextDto) expectedContext!: SalesReceiptExpectedContextDto
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 500) reason?: string | null
}
export class SalesReceiptPersonDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
  @ApiProperty({ type: 'string', nullable: true }) avatarUrl!: string | null
}
export class SalesReceiptOrderDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() orderNo!: string
  @ApiProperty() version!: number
  @ApiProperty() customerName!: string
  @ApiProperty() orderStatus!: string
}
export class SalesReceiptVoucherDto {
  @ApiProperty() mediaType!: string
  @ApiProperty({ type: 'string', nullable: true }) mimeType!: string | null
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty() title!: string
}
export class SalesReceiptEntryDto {
  @ApiProperty() accountTarget!: string
  @ApiProperty() direction!: string
  @ApiProperty() amount!: string
}
export class SalesReceiptPostingDto {
  @ApiProperty({ format: 'uuid' }) ruleVersionId!: string
  @ApiProperty() ruleRevisionSnapshot!: number
  @ApiProperty({ format: 'uuid' }) batchId!: string
  @ApiProperty() businessAmount!: string
  @ApiProperty({ nullable: true, type: 'string' }) userShareRate!: string | null
  @ApiProperty({ nullable: true, type: 'string' }) companyShareRate!: string | null
  @ApiProperty({ type: [SalesReceiptEntryDto] }) entries!: SalesReceiptEntryDto[]
}
export class SalesReceiptPaymentDto {
  @ApiProperty({ type: 'string', nullable: true, format: 'uuid' }) exchangeRateId!: string | null
  @ApiProperty({ type: 'number', nullable: true }) exchangeRateVersionSnapshot!: number | null
  @ApiProperty({ nullable: true, type: () => SalesReceiptPostingDto }) reversal!: SalesReceiptPostingDto | null
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() origin!: string
  @ApiProperty({ nullable: true, type: 'string', format: 'date-time' }) voidedAt!: string | null
  @ApiProperty({ nullable: true, type: 'string' }) voidReason!: string | null
  @ApiProperty({ nullable: true, type: 'string', format: 'uuid' }) fundPostingBatchId!: string | null
  @ApiProperty({ nullable: true, type: 'string', format: 'uuid' }) fundReversalBatchId!: string | null
  @ApiProperty({ nullable: true, type: 'string' }) foreignUnitsPerCnySnapshot!: string | null
  @ApiProperty({ nullable: true, type: 'string', format: 'date-time' }) exchangeRateCapturedAt!: string | null
  @ApiProperty({ nullable: true, type: () => SalesReceiptPostingDto }) posting!: SalesReceiptPostingDto | null
}
export class SalesReceiptRequestDetailDto {
  @ApiProperty({ type: 'string', nullable: true, format: 'uuid', description: '编号派发记录；接入编号前的历史申请为 null' }) numberingIssuanceId!: string | null
  @ApiProperty({ type: 'string', nullable: true, maxLength: 64, description: '销售收款编号；接入编号前的历史申请为 null' }) collectionNo!: string | null
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) salesOrderId!: string
  @ApiProperty({ enum: SalesOrderPaymentType }) paymentType!: SalesOrderPaymentType
  @ApiProperty() amount!: string
  @ApiProperty() currencyCode!: string
  @ApiProperty({ format: 'date-time' }) receivedAt!: string
  @ApiProperty() paymentMethod!: string
  @ApiProperty() paymentMethodNameSnapshot!: string
  @ApiProperty({ nullable: true, type: 'string' }) remark!: string | null
  @ApiProperty({ enum: SalesReceiptStatusDto }) status!: SalesReceiptStatusDto
  @ApiProperty({ format: 'date-time' }) submittedAt!: string
  @ApiProperty({ nullable: true, type: 'string', format: 'date-time' }) reviewedAt!: string | null
  @ApiProperty({ nullable: true, type: 'string' }) reviewRemark!: string | null
  @ApiProperty() version!: number
  @ApiProperty({ nullable: true, type: 'string', format: 'uuid' }) resubmittedFromId!: string | null
  @ApiProperty({ type: () => SalesReceiptOrderDto }) salesOrder!: SalesReceiptOrderDto
  @ApiProperty({ type: () => SalesReceiptPersonDto }) accountOwner!: SalesReceiptPersonDto
  @ApiProperty({ type: () => SalesReceiptPersonDto }) submittedBy!: SalesReceiptPersonDto
  @ApiProperty({ nullable: true, type: () => SalesReceiptPersonDto }) reviewedBy!: SalesReceiptPersonDto | null
  @ApiProperty({ type: () => SalesReceiptVoucherDto }) voucher!: SalesReceiptVoucherDto
  @ApiProperty({ nullable: true, type: () => SalesReceiptPaymentDto }) approvedPayment!: SalesReceiptPaymentDto | null
}
export class SalesReceiptStatusCountsDto {
  @ApiProperty() PENDING_REVIEW!: number
  @ApiProperty() APPROVED!: number
  @ApiProperty() REJECTED!: number
  @ApiProperty() VOIDED!: number
}
export class SalesReceiptRequestPageDto {
  @ApiProperty({ description: 'All pending original-currency amount for an order; null for cross-currency finance queue', type: 'string', nullable: true }) pendingAmount!: string | null
  @ApiProperty({ type: [SalesReceiptRequestDetailDto] }) items!: SalesReceiptRequestDetailDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
  @ApiProperty({ type: () => SalesReceiptStatusCountsDto }) statusCounts!: SalesReceiptStatusCountsDto
}
export class SalesReceiptApprovalContextDto {
  @ApiProperty({ type: () => SalesReceiptExpectedContextDto }) expectedContext!: SalesReceiptExpectedContextDto
  @ApiProperty() foreignUnitsPerCny!: string
  @ApiProperty() businessAmount!: string
  @ApiProperty({ type: 'string', nullable: true }) userShareRate!: string | null
  @ApiProperty({ type: 'string', nullable: true }) companyShareRate!: string | null
  @ApiProperty({ type: [SalesReceiptEntryDto] }) entries!: SalesReceiptEntryDto[]
}
