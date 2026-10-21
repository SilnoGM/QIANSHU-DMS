import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'

export const PAYMENT_RECIPIENT_METHODS = ['ALIPAY', 'WECHAT', 'BANK_TRANSFER'] as const
export type PaymentRecipientMethod = typeof PAYMENT_RECIPIENT_METHODS[number]
export class PaymentRecipientAccountInputDto {
  @ApiProperty({ enum: PAYMENT_RECIPIENT_METHODS }) @IsIn(PAYMENT_RECIPIENT_METHODS) paymentMethod!: PaymentRecipientMethod
  @ApiProperty({ maxLength: 128 }) @IsString() @IsUnicodeCodePointLength(1, 128) recipientName!: string
  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true }) @IsOptional() @IsUUID('4') qrMediaAssetId?: string | null
  @ApiPropertyOptional({ type: 'string', maxLength: 128, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) bankName?: string | null
  @ApiPropertyOptional({ type: 'string', maxLength: 128, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) bankAccount?: string | null
  @ApiPropertyOptional({ type: 'string', maxLength: 128, nullable: true }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) bankBranch?: string | null
}
export class PaymentRecipientAccountDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ enum: PAYMENT_RECIPIENT_METHODS }) paymentMethod!: PaymentRecipientMethod
  @ApiProperty() recipientName!: string
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) qrMediaAssetId!: string | null
  @ApiProperty({ type: 'string', nullable: true }) qrContentUrl!: string | null
  @ApiProperty({ type: 'string', nullable: true }) bankName!: string | null
  @ApiProperty({ type: 'string', nullable: true }) bankAccount!: string | null
  @ApiProperty({ type: 'string', nullable: true }) bankBranch!: string | null
}
export class PaymentRecipientProfileDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() version!: number
  @ApiProperty({ type: [PaymentRecipientAccountDto] }) accounts!: PaymentRecipientAccountDto[]
}
export class PaymentRecipientPersonDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
  @ApiProperty({ type: 'string', nullable: true }) avatarUrl!: string | null
}
export class SupplierPaymentProfileDto {
  @ApiProperty() supplierValue!: string
  @ApiProperty() supplierName!: string
  @ApiProperty() supplierEnabled!: boolean
  @ApiProperty() version!: number
  @ApiProperty({ type: [PaymentRecipientAccountDto] }) accounts!: PaymentRecipientAccountDto[]
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) updatedAt!: string | null
  @ApiProperty({ type: () => PaymentRecipientPersonDto, nullable: true }) updatedBy!: PaymentRecipientPersonDto | null
}
export class SupplierPaymentProfileQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1
  @ApiPropertyOptional({ type: Number, default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
}
export class SupplierPaymentProfilePageDto {
  @ApiProperty({ type: [SupplierPaymentProfileDto] }) items!: SupplierPaymentProfileDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}
export class SupplierPaymentProfileSaveDto {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) expectedVersion!: number
  @ApiProperty({ type: [PaymentRecipientAccountInputDto], maxItems: 3 }) @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => PaymentRecipientAccountInputDto) accounts!: PaymentRecipientAccountInputDto[]
}
export class SupplierPaymentProfileParamDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @IsUnicodeCodePointLength(1, 64) supplierValue!: string
}
export class PaymentRecipientImageParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}
export class PaymentRecipientImageUploadDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty({ enum: ['IMAGE'] }) mediaType!: 'IMAGE'
  @ApiProperty() mimeType!: string
  @ApiProperty() sizeBytes!: string
  @ApiProperty() originalFilename!: string
}

export class PackagingPaymentProfileDto {
  @ApiProperty({ enum: ['CHENGXIN'] }) vendor!: 'CHENGXIN'
  @ApiProperty() vendorName!: string
  @ApiProperty() version!: number
  @ApiProperty({ type: [PaymentRecipientAccountDto] }) accounts!: PaymentRecipientAccountDto[]
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) updatedAt!: string | null
  @ApiProperty({ type: () => PaymentRecipientPersonDto, nullable: true }) updatedBy!: PaymentRecipientPersonDto | null
}
