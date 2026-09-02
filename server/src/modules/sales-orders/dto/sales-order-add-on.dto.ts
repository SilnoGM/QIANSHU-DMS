import { ApiProperty } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { SalesOrderLineInputDto } from './sales-order-create.dto'

const DICTIONARY_ITEM_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

export class SalesOrderAddOnLinesRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) => (
    typeof value === 'string' ? value.trim().normalize('NFC').toUpperCase() : value
  ))
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  @Matches(DICTIONARY_ITEM_VALUE_PATTERN)
  supplierValue!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string

  @ApiProperty({ type: () => [SalesOrderLineInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineInputDto)
  lines!: SalesOrderLineInputDto[]
}
