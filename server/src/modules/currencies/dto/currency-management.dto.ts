import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export const CurrencyStatusFilter = {
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
} as const

export type CurrencyStatusFilter =
  (typeof CurrencyStatusFilter)[keyof typeof CurrencyStatusFilter]

export class CurrencyIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  currencyId!: string
}

export class CurrencyListQueryDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((_object: CurrencyListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, { message: '长度必须为 1 到 128 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  query?: string

  @ApiPropertyOptional({ type: 'string', enum: CurrencyStatusFilter })
  @ValidateIf((_object: CurrencyListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(CurrencyStatusFilter, { message: '必须是有效的货币状态' })
  status?: CurrencyStatusFilter

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    default: 1,
  })
  @Type(() => Number)
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  page = 1

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @Type(() => Number)
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  @Max(100, { message: '不能超过 100' })
  pageSize = 20
}
