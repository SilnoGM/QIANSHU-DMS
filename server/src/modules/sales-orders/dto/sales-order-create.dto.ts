import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
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

import { SalesOrderLineType } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u
const ACTUAL_UNIT_PRICE_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export class SalesOrderCustomerInputDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  name!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  phone!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('all')
  countryRegionId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('all')
  provinceStateId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('all')
  cityId!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 1000 })
  @IsString()
  @IsUnicodeCodePointLength(1, 1000)
  addressDetail!: string
}

export class SalesOrderLineInputDto {
  @ApiProperty({ enum: SalesOrderLineType })
  @IsEnum(SalesOrderLineType)
  lineType!: SalesOrderLineType

  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  @ValidateIf((item: SalesOrderLineInputDto) => item.lineType === 'CATALOG')
  @IsUUID('4')
  productId?: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128, required: false })
  @ValidateIf((item: SalesOrderLineInputDto) => item.lineType === 'CUSTOM')
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  name?: string

  @ApiProperty({ type: 'string', maxLength: 1000, nullable: true, required: false })
  @ValidateIf((item: SalesOrderLineInputDto) => item.lineType === 'CUSTOM')
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 1000)
  description?: string | null

  @ApiProperty({
    type: 'string',
    pattern: ACTUAL_UNIT_PRICE_PATTERN.source,
    description: '本单实际单价，非负且最多两位小数',
  })
  @IsString()
  @Matches(ACTUAL_UNIT_PRICE_PATTERN)
  actualUnitPriceAmount!: string

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity!: number
}

export class SalesOrderIssuanceVoucherInputDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  mediaAssetId!: string
}

export class CreateSalesOrderRequestDto {
  @ApiProperty({ type: 'string', format: 'date' })
  @IsString()
  @Matches(DATE_PATTERN)
  orderDate!: string

  @ApiProperty({ enum: ['TWD', 'MYR'] })
  @IsIn(['TWD', 'MYR'])
  currencyCode!: 'TWD' | 'MYR'

  @ApiProperty({ type: () => SalesOrderCustomerInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => SalesOrderCustomerInputDto)
  customer!: SalesOrderCustomerInputDto

  @ApiProperty({ type: () => [SalesOrderLineInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineInputDto)
  lines!: SalesOrderLineInputDto[]

  @ApiProperty({ type: 'string', pattern: AMOUNT_PATTERN.source })
  @IsString()
  @Matches(AMOUNT_PATTERN)
  agreedTotalAmount!: string

  @ApiProperty({ type: 'string', pattern: AMOUNT_PATTERN.source })
  @IsString()
  @Matches(AMOUNT_PATTERN)
  depositDueAmount!: string

  @ApiProperty({ type: 'string', pattern: AMOUNT_PATTERN.source })
  @IsString()
  @Matches(AMOUNT_PATTERN)
  balanceDueAmount!: string

  @ApiProperty({ type: () => SalesOrderIssuanceVoucherInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => SalesOrderIssuanceVoucherInputDto)
  issuanceVoucher!: SalesOrderIssuanceVoucherInputDto

  @ApiProperty({ type: 'string', maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 1000)
  remark!: string | null
}
