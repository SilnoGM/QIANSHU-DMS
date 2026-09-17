import { PaymentRecipientAccountDto, PaymentRecipientProfileDto } from '../../payment-recipients/payment-recipient.dto'
import { PurchaseOrderPaymentVoucherInputDto } from '../dto/purchase-order-mutation.dto'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested, IsDefined } from 'class-validator'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class PurchasePayableIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}
export class PurchasePayableListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
}
export class PurchasePayablePayDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') recipientAccountId!: string
  @ApiProperty({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) recipientProfileVersion!: number
  @ApiProperty({ type: () => PurchaseOrderPaymentVoucherInputDto }) @IsDefined() @ValidateNested() @Type(() => PurchaseOrderPaymentVoucherInputDto) voucher!: PurchaseOrderPaymentVoucherInputDto
  @ApiProperty({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedVersion!: number
  @ApiProperty({ maxLength: 64, description: 'Effective payment.method dictionary value.' }) @IsString() @IsUnicodeCodePointLength(1, 64) paymentMethod!: string
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500 }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 500) remark?: string | null
}
export class PurchasePayablePersonDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
}
export class PurchasePayableVoucherDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty() contentUrl!: string
  @ApiProperty({ type: 'string', nullable: true }) title!: string | null
}
export class PurchasePayableReceiptDto {
  @ApiProperty({ type: () => PaymentRecipientAccountDto, nullable: true }) recipient!: PaymentRecipientAccountDto | null
  @ApiProperty({ type: () => PurchasePayableVoucherDto, nullable: true }) voucher!: PurchasePayableVoucherDto | null
}
export class PurchasePayableDto {
  @ApiProperty({ type: () => PurchasePayableReceiptDto, nullable: true }) paymentReceipt!: PurchasePayableReceiptDto | null
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ enum: ['DEPOSIT', 'BALANCE'] }) paymentType!: 'DEPOSIT' | 'BALANCE'
  @ApiProperty({ description: 'CNY amount with two decimal places.' }) dueAmount!: string
  @ApiProperty({ description: 'CNY amount with two decimal places.' }) paidAmount!: string
  @ApiProperty({ description: 'CNY amount with two decimal places.' }) remainingAmount!: string
  @ApiProperty({ enum: ['PENDING_PAYMENT', 'PAID', 'NO_PAYMENT', 'CANCELLED'] }) status!: 'PENDING_PAYMENT' | 'PAID' | 'NO_PAYMENT' | 'CANCELLED'
  @ApiProperty() version!: number
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) paidAt!: string | null
  @ApiProperty({ type: () => PurchasePayablePersonDto, nullable: true }) paidBy!: PurchasePayablePersonDto | null
}
export class PurchasePayableOrderDto {
  @ApiProperty({ type: () => PaymentRecipientProfileDto, nullable: true }) paymentRecipientProfile!: PaymentRecipientProfileDto | null
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() orderNo!: string
  @ApiProperty({ format: 'date' }) orderDate!: string
  @ApiProperty({ enum: ['SALES_LINKED', 'STOCK'] }) purchaseType!: 'SALES_LINKED' | 'STOCK'
  @ApiProperty() supplierName!: string
  @ApiProperty({ type: 'string', nullable: true }) salesOrderNo!: string | null
  @ApiProperty({ description: 'CNY amount with two decimal places.' }) purchaseTotalAmount!: string
  @ApiProperty({ enum: ['CNY'] }) currencyCode!: 'CNY'
  @ApiProperty({ enum: ['USER', 'COMPANY'] }) accountOwnerType!: 'USER' | 'COMPANY'
  @ApiProperty({ type: () => PurchasePayablePersonDto, nullable: true }) owner!: PurchasePayablePersonDto | null
  @ApiProperty({ type: [PurchasePayableDto] }) items!: PurchasePayableDto[]
}
export class PurchasePayableOrderPageDto {
  @ApiProperty({ type: [PurchasePayableOrderDto] }) items!: PurchasePayableOrderDto[]
  @ApiProperty({ description: 'Total purchase order groups, not installment rows.' }) total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}

export class PurchasePayableVoucherIdDto extends PurchasePayableIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') documentId!: string
}
export class PurchasePayableVoucherUploadRequestDto {
  @ApiProperty({ enum: ['IMAGE'] }) mediaType!: 'IMAGE'
  @ApiProperty({ type: 'string', format: 'binary' }) file!: unknown
}
export class PurchasePayableVoucherUploadDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty({ enum: ['IMAGE'] }) mediaType!: 'IMAGE'
  @ApiProperty() mimeType!: string
  @ApiProperty() sizeBytes!: string
  @ApiProperty() originalFilename!: string
}
