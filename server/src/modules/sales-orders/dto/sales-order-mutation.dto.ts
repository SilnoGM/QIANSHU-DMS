import { ApiProperty } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator'

import {
  SalesOrderFulfillmentStatus,
  SalesOrderPaymentType,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,4})?$/u

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

export class SalesOrderPaymentRequestDto {
  @ApiProperty({ enum: SalesOrderPaymentType })
  @IsEnum(SalesOrderPaymentType)
  paymentType!: SalesOrderPaymentType

  @ApiProperty({ type: 'string', pattern: AMOUNT_PATTERN.source })
  @Matches(AMOUNT_PATTERN)
  amount!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  @IsString()
  receivedAt!: string

  @ApiProperty({ type: 'string', maxLength: 64, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  paymentMethod!: string | null

  @ApiProperty({ type: 'string', maxLength: 128, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  referenceNo!: string | null

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  remark!: string | null
}

export class SalesOrderPaymentVoidRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string
}
