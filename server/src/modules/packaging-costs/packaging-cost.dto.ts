import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsDefined, IsIn, ValidateNested, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator'
import { PaymentRecipientAccountDto, PaymentRecipientAccountInputDto, PaymentRecipientProfileDto } from '../payment-recipients/payment-recipient.dto'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'

export enum PackagingCostStatusDto { PENDING_PAYMENT = 'PENDING_PAYMENT', PAID = 'PAID' }
export enum PackagingCostVendorDto { CHENGXIN = 'CHENGXIN', OTHER = 'OTHER' }
export enum PackagingCostImageKindDto { PACKAGING = 'PACKAGING', QUOTATION = 'QUOTATION', PAYMENT = 'PAYMENT' }
export class PackagingCostIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}
export class PackagingCostImageParamsDto extends PackagingCostIdDto {
  @ApiProperty({ enum: PackagingCostImageKindDto }) @IsEnum(PackagingCostImageKindDto) kind!: PackagingCostImageKindDto
}
export class PackagingCostListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ enum: PackagingCostStatusDto }) @IsOptional() @IsEnum(PackagingCostStatusDto) status?: PackagingCostStatusDto
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
}
export class PackagingCostRequestCreateDto {
  @ApiPropertyOptional({ type: [PaymentRecipientAccountInputDto], minItems: 1, maxItems: 2, description: 'Required for OTHER; ALIPAY or WECHAT only. Omit for CHENGXIN.' }) @IsOptional() @IsArray() @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => PaymentRecipientAccountInputDto) paymentRecipients?: PaymentRecipientAccountInputDto[]
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') shipmentId!: string
  @ApiProperty({ maxLength: 64, description: 'Effective value from warehouse.packaging_type.' }) @IsString() @IsUnicodeCodePointLength(1, 64) packagingType!: string
  @ApiProperty({ enum: PackagingCostVendorDto }) @IsEnum(PackagingCostVendorDto) packagingVendor!: PackagingCostVendorDto
  @ApiProperty({ type: 'string', pattern: '^(0|[1-9]\\d{0,25})(\\.\\d{1,2})?$', description: 'Positive CNY amount; at most two decimal places.' }) @IsString() @Matches(/^(0|[1-9]\d{0,25})(\.\d{1,2})?$/u) amount!: string
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') packagingImageMediaAssetId!: string
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') quotationImageMediaAssetId!: string
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) remark?: string | null
}
export class PackagingCostPaymentVoucherDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') mediaAssetId!: string
}
export class PackagingCostRequestPayDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') recipientAccountId!: string
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) recipientProfileVersion!: number
  @ApiProperty({ enum: ['ALIPAY', 'WECHAT'] }) @IsIn(['ALIPAY', 'WECHAT']) paymentMethod!: 'ALIPAY' | 'WECHAT'
  @ApiProperty({ type: () => PackagingCostPaymentVoucherDto }) @IsDefined() @ValidateNested() @Type(() => PackagingCostPaymentVoucherDto) voucher!: PackagingCostPaymentVoucherDto
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) remark?: string | null
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number
}
export class PackagingCostPersonDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
}
export class PackagingCostImageDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] }) mimeType!: string
  @ApiProperty() originalFilename!: string
}
export class PackagingCostImageUploadDto extends PackagingCostImageDto {
  @ApiProperty({ enum: ['IMAGE'] }) mediaType!: 'IMAGE'
  @ApiProperty({ type: 'string', description: 'Byte size as an integer string.' }) sizeBytes!: string
}
export class PackagingCostPaymentReceiptDto {
  @ApiProperty({ type: () => PaymentRecipientAccountDto, nullable: true }) recipient!: PaymentRecipientAccountDto | null
  @ApiProperty({ type: () => PackagingCostImageDto, nullable: true }) voucher!: PackagingCostImageDto | null
  @ApiProperty({ type: 'string', nullable: true }) remark!: string | null
}
export class PackagingCostRequestDto {
  @ApiProperty({ type: () => PaymentRecipientProfileDto, nullable: true }) paymentRecipientProfile!: PaymentRecipientProfileDto | null
  @ApiProperty({ type: () => PackagingCostPaymentReceiptDto, nullable: true }) paymentReceipt!: PackagingCostPaymentReceiptDto | null
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) shipmentId!: string
  @ApiProperty() shipmentNo!: string
  @ApiProperty() shippingMarkText!: string
  @ApiProperty({ format: 'uuid' }) purchaseOrderId!: string
  @ApiProperty() purchaseOrderNo!: string
  @ApiProperty({ format: 'uuid' }) salesOrderId!: string
  @ApiProperty() salesOrderNo!: string
  @ApiProperty({ type: () => PackagingCostPersonDto }) owner!: PackagingCostPersonDto
  @ApiProperty() packagingType!: string
  @ApiProperty() packagingTypeName!: string
  @ApiProperty({ enum: PackagingCostVendorDto }) packagingVendor!: PackagingCostVendorDto
  @ApiProperty({ description: 'Immutable CNY amount with four decimal places.' }) amount!: string
  @ApiProperty({ enum: ['CNY'] }) currencyCode!: 'CNY'
  @ApiProperty({ type: 'string', nullable: true }) remark!: string | null
  @ApiProperty({ enum: PackagingCostStatusDto }) status!: PackagingCostStatusDto
  @ApiProperty({ type: () => PackagingCostPersonDto }) submittedBy!: PackagingCostPersonDto
  @ApiProperty({ format: 'date-time' }) submittedAt!: string
  @ApiProperty({ type: () => PackagingCostPersonDto, nullable: true }) paidBy!: PackagingCostPersonDto | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) paidAt!: string | null
  @ApiProperty() version!: number
  @ApiProperty({ type: () => PackagingCostImageDto }) packagingImage!: PackagingCostImageDto
  @ApiProperty({ type: () => PackagingCostImageDto }) quotationImage!: PackagingCostImageDto
}
export class PackagingCostStatusCountsDto {
  @ApiProperty() PENDING_PAYMENT!: number
  @ApiProperty() PAID!: number
}
export class PackagingCostRequestPageDto {
  @ApiProperty({ type: [PackagingCostRequestDto] }) items!: PackagingCostRequestDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
  @ApiProperty({ type: () => PackagingCostStatusCountsDto }) statusCounts!: PackagingCostStatusCountsDto
}

export class PackagingCostShipmentIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') shipmentId!: string
}
export class PackagingCostRequestSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() packagingTypeName!: string
  @ApiProperty({ enum: PackagingCostVendorDto }) packagingVendor!: PackagingCostVendorDto
  @ApiProperty({ description: 'Immutable CNY amount with four decimal places.' }) amount!: string
  @ApiProperty({ enum: ['CNY'] }) currencyCode!: 'CNY'
  @ApiProperty({ enum: PackagingCostStatusDto }) status!: PackagingCostStatusDto
  @ApiProperty({ type: () => PackagingCostPersonDto }) submittedBy!: PackagingCostPersonDto
  @ApiProperty({ format: 'date-time' }) submittedAt!: string
  @ApiProperty({ type: () => PackagingCostPersonDto, nullable: true }) paidBy!: PackagingCostPersonDto | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) paidAt!: string | null
  @ApiProperty({ type: 'string', nullable: true }) remark!: string | null
}
export class PackagingCostShipmentContextDto {
  @ApiProperty({ format: 'uuid' }) shipmentId!: string
  @ApiProperty({ type: 'string', nullable: true }) shipmentNo!: string | null
  @ApiProperty({ type: 'string', nullable: true }) shippingMarkText!: string | null
  @ApiProperty({ type: 'string', nullable: true }) purchaseOrderNo!: string | null
  @ApiProperty({ type: 'string', nullable: true }) salesOrderNo!: string | null
  @ApiProperty({ type: () => PackagingCostPersonDto, nullable: true }) owner!: PackagingCostPersonDto | null
  @ApiProperty({ type: [PackagingCostRequestSummaryDto], description: 'Existing requests for this exact shipment, ordered by submittedAt and id descending.' }) existingRequests!: PackagingCostRequestSummaryDto[]
  @ApiProperty() eligible!: boolean
  @ApiProperty({ type: 'string', enum: ['invalidShipment', 'noSalesSource', null], nullable: true }) unavailableReason!: 'invalidShipment' | 'noSalesSource' | null
}
