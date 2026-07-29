import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger'
import {
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const MAX_INT32 = 2_147_483_647
const CURRENCY_CODE_INPUT_PATTERN = /^[A-Za-z]{3}$/u

export class CreateCurrencyRequestDto {
  @ApiProperty({
    type: 'string',
    minLength: 3,
    maxLength: 3,
    example: 'TWD',
  })
  @IsString({ message: '必须是字符串' })
  @Matches(CURRENCY_CODE_INPUT_PATTERN, { message: '必须是三位英文字母' })
  code!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, { message: '长度必须为 1 到 128 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  name!: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 0,
    maxLength: 128,
    description: '省略或规范化为空白时存储为 null',
  })
  @ValidateIf((_object: CreateCurrencyRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(0, 128, { message: '长度不能超过 128 个字符' })
  englishName?: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 0,
    maxLength: 16,
    description: '省略或规范化为空白时存储为 null；符号不作为货币标识',
  })
  @ValidateIf((_object: CreateCurrencyRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(0, 16, { message: '长度不能超过 16 个字符' })
  symbol?: string

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 4 })
  @IsInt({ message: '必须是整数' })
  @Min(0, { message: '不能小于 0' })
  @Max(4, { message: '不能超过 4' })
  minorUnit!: number

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: MAX_INT32,
  })
  @IsInt({ message: '必须是整数' })
  @Min(0, { message: '不能小于 0' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  sortOrder!: number
}

export class UpdateCurrencyRequestDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((object: UpdateCurrencyRequestDto, value: unknown) =>
    value !== undefined
    || (
      object.englishName === undefined
      && object.symbol === undefined
      && object.sortOrder === undefined
    ),
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, { message: '长度必须为 1 到 128 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  name?: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 0,
    maxLength: 128,
    nullable: true,
    description: 'null 或规范化为空白表示清空英文名',
  })
  @ValidateIf((_object: UpdateCurrencyRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(0, 128, { message: '长度不能超过 128 个字符' })
  englishName?: string | null

  @ApiPropertyOptional({
    type: 'string',
    minLength: 0,
    maxLength: 16,
    nullable: true,
    description: 'null 或规范化为空白表示清空符号',
  })
  @ValidateIf((_object: UpdateCurrencyRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(0, 16, { message: '长度不能超过 16 个字符' })
  symbol?: string | null

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: MAX_INT32,
  })
  @ValidateIf((_object: UpdateCurrencyRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsInt({ message: '必须是整数' })
  @Min(0, { message: '不能小于 0' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  sortOrder?: number

  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  expectedVersion!: number
}

export class ChangeCurrencyStatusRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  expectedVersion!: number
}
