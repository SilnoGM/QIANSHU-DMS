import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPaymentType,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u

export class PurchaseOrderReviewRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500, required: false })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason?: string
}

export class PurchaseOrderStatusRequestDto {
  @ApiProperty({ enum: ['CANCELLED'] })
  @IsIn(['CANCELLED'])
  toStatus!: 'CANCELLED'

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason?: string | null
}

export class PurchaseOrderFulfillmentStatusRequestDto {
  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus })
  @IsEnum(PurchaseOrderFulfillmentStatus)
  toStatus!: PurchaseOrderFulfillmentStatus

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason?: string | null
}

export class PurchaseOrderPaymentVoucherInputDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  mediaAssetId!: string
}

export class PurchaseOrderPaymentRequestDto {
  @ApiProperty({ enum: PurchaseOrderPaymentType })
  @IsEnum(PurchaseOrderPaymentType)
  paymentType!: PurchaseOrderPaymentType

  @ApiProperty({ type: 'string', pattern: AMOUNT_PATTERN.source })
  @Matches(AMOUNT_PATTERN)
  amount!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  @IsString()
  paidAt!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  paymentMethod!: string

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  remark?: string | null

  @ApiProperty({
    type: () => PurchaseOrderPaymentVoucherInputDto,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PurchaseOrderPaymentVoucherInputDto)
  voucher?: PurchaseOrderPaymentVoucherInputDto | null
}

export class PurchaseOrderPaymentVoidRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string
}
