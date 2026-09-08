import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { SalesOrderLineInputDto } from './sales-order-create.dto'

const ACTUAL_UNIT_PRICE_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u

export class SalesOrderExistingLineTargetDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  lineId!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  name!: string

  @ApiProperty({ type: 'string', maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 1000)
  description!: string | null

  @ApiProperty({
    type: 'string',
    pattern: ACTUAL_UNIT_PRICE_PATTERN.source,
    description: '既有销售明细修改后的本单售价，非负且最多两位小数',
  })
  @IsString()
  @Matches(ACTUAL_UNIT_PRICE_PATTERN)
  actualUnitPriceAmount!: string

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2_147_483_647 })
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  desiredQuantity!: number
}

export class SalesOrderProductsUpdateRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string

  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  confirmDepositReduction!: boolean

  @ApiProperty({ type: () => [SalesOrderExistingLineTargetDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderExistingLineTargetDto)
  existingLines!: SalesOrderExistingLineTargetDto[]

  @ApiProperty({ type: () => [SalesOrderLineInputDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineInputDto)
  newLines!: SalesOrderLineInputDto[]
}
