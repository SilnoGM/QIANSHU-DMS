import { ApiProperty } from '@nestjs/swagger'
import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator'

import { FOREIGN_UNITS_PER_CNY_PATTERN } from '../exchange-rate.normalizer'

const RATE_VALIDATION_MESSAGE =
  '必须是大于 0 且最多 18 位整数、12 位小数的十进制字符串'

export class CreateExchangeRateRequestDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  currencyId!: string

  @ApiProperty({
    type: 'string',
    example: '4.8',
    pattern: FOREIGN_UNITS_PER_CNY_PATTERN.source,
  })
  @IsString({ message: '必须是字符串' })
  @Matches(FOREIGN_UNITS_PER_CNY_PATTERN, {
    message: RATE_VALIDATION_MESSAGE,
  })
  foreignUnitsPerCny!: string
}

export class UpdateExchangeRateRequestDto {
  @ApiProperty({
    type: 'string',
    example: '4.8',
    pattern: FOREIGN_UNITS_PER_CNY_PATTERN.source,
  })
  @IsString({ message: '必须是字符串' })
  @Matches(FOREIGN_UNITS_PER_CNY_PATTERN, {
    message: RATE_VALIDATION_MESSAGE,
  })
  foreignUnitsPerCny!: string

  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  expectedVersion!: number
}
