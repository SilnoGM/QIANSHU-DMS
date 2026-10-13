import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsDefined,
  IsInt,
  IsIn,
  Min,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator'

import {
  SalesOrderFulfillmentStatus,
  SalesOrderPaymentType,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,4})?$/u

/**
 * 收款申请可提交的类型：COD_BALANCE 是代收回填收款专用（由账单结算产生），
 * 不开放给人工申请；枚举加值不会自动放宽这道口子。
 */
const SUBMITTABLE_PAYMENT_TYPES = [
  SalesOrderPaymentType.DEPOSIT,
  SalesOrderPaymentType.PROGRESS,
  SalesOrderPaymentType.INVOICE_TAX,
  SalesOrderPaymentType.BALANCE,
  SalesOrderPaymentType.OTHER,
] as const

export class SalesOrderStatusRequestDto {
  @ApiProperty({ enum: SalesOrderStatus })
  @IsEnum(SalesOrderStatus)
  toStatus!: SalesOrderStatus

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string | null
}

export class SalesOrderFulfillmentStatusRequestDto {
  @ApiProperty({ enum: SalesOrderFulfillmentStatus })
  @IsEnum(SalesOrderFulfillmentStatus)
  toStatus!: SalesOrderFulfillmentStatus

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string | null
}

export class SalesOrderPaymentTermsRequestDto {
  @ApiProperty({ type: 'string', pattern: AMOUNT_PATTERN.source })
  @Matches(AMOUNT_PATTERN)
  agreedTotalAmount!: string

  @ApiProperty({ type: 'string', pattern: AMOUNT_PATTERN.source })
  @Matches(AMOUNT_PATTERN)
  depositDueAmount!: string

  @ApiProperty({ type: 'string', pattern: AMOUNT_PATTERN.source })
  @Matches(AMOUNT_PATTERN)
  balanceDueAmount!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string
}

export class SalesOrderPaymentVoucherInputDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  mediaAssetId!: string
}

export class SalesOrderPaymentRequestDto {
  @ApiProperty({ enum: SUBMITTABLE_PAYMENT_TYPES })
  @IsIn(SUBMITTABLE_PAYMENT_TYPES)
  paymentType!: SalesOrderPaymentType

  @ApiProperty({ type: 'string', pattern: AMOUNT_PATTERN.source })
  @Matches(AMOUNT_PATTERN)
  amount!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  @IsString()
  receivedAt!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  paymentMethod!: string

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  remark!: string | null

  @ApiProperty({ type: () => SalesOrderPaymentVoucherInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => SalesOrderPaymentVoucherInputDto)
  voucher!: SalesOrderPaymentVoucherInputDto
}

export class SalesOrderPaymentVoidRequestDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOrderVersion!: number

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string
}
