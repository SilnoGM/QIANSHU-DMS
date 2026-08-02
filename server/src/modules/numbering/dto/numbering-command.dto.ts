import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger'
import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { isNormalizableNumberingRuleCode } from '../numbering.normalizer'
import { NumberingRuleConfigInputDto } from './numbering-segment.dto'

const MAX_INT32 = 2_147_483_647

function IsNormalizableNumberingRuleCode(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalizableNumberingRuleCode',
    validator: {
      validate: isNormalizableNumberingRuleCode,
      defaultMessage(): string {
        return '规则编码规范化后必须以英文字母开头，且只能包含英文字母、数字和下划线'
      },
    },
  })
}

abstract class NumberingExpectedVersionRequestDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_INT32,
  })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  @Max(MAX_INT32, { message: 'expectedVersion 不能超过 2147483647' })
  expectedVersion!: number
}

export class CreateNumberingRuleRequestDto
  extends NumberingRuleConfigInputDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @IsString({ message: '规则编码必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, {
    message: '规则编码输入长度必须为 1 到 64 个字符',
  })
  @IsNormalizableNumberingRuleCode()
  ruleCode!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString({ message: '名称必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, {
    message: '名称长度必须为 1 到 128 个字符',
  })
  @Matches(/\S/u, { message: '名称不能为空白文本' })
  name!: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 0,
    maxLength: 500,
    nullable: true,
    description: 'null 或规范化为空白表示不设置说明',
  })
  @ValidateIf((_object: CreateNumberingRuleRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '说明必须是字符串或 null' })
  @IsUnicodeCodePointLength(0, 500, {
    message: '说明长度不能超过 500 个字符',
  })
  description?: string | null
}

export class UpdateNumberingRuleRequestDto
  extends PartialType(NumberingRuleConfigInputDto) {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((object: UpdateNumberingRuleRequestDto, value: unknown) =>
    value !== undefined
    || (
      object.description === undefined
      && object.resetPolicy === undefined
      && object.segments === undefined
    ),
  )
  @IsString({ message: '名称必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, {
    message: '名称长度必须为 1 到 128 个字符',
  })
  @Matches(/\S/u, { message: '名称不能为空白文本' })
  name?: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 0,
    maxLength: 500,
    nullable: true,
    description: 'null 或规范化为空白表示清空说明',
  })
  @ValidateIf((_object: UpdateNumberingRuleRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '说明必须是字符串或 null' })
  @IsUnicodeCodePointLength(0, 500, {
    message: '说明长度不能超过 500 个字符',
  })
  description?: string | null

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_INT32,
  })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  @Max(MAX_INT32, { message: 'expectedVersion 不能超过 2147483647' })
  expectedVersion!: number

}

export class PreviewNumberingRuleRequestDto
  extends NumberingRuleConfigInputDto {
  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @ValidateIf((_object: PreviewNumberingRuleRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsUUID(undefined, { message: 'ruleId 必须是有效的 UUID' })
  ruleId?: string
}

export class PublishNumberingRuleRequestDto
  extends NumberingExpectedVersionRequestDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_INT32,
  })
  @IsInt({ message: 'draftRevision 必须是整数' })
  @Min(1, { message: 'draftRevision 不能小于 1' })
  @Max(MAX_INT32, { message: 'draftRevision 不能超过 2147483647' })
  draftRevision!: number
}

export class ChangeNumberingRuleStatusRequestDto
  extends NumberingExpectedVersionRequestDto {}

export class CloneNumberingRuleRequestDto
  extends NumberingExpectedVersionRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @IsString({ message: '规则编码必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, {
    message: '规则编码输入长度必须为 1 到 64 个字符',
  })
  @IsNormalizableNumberingRuleCode()
  ruleCode!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString({ message: '名称必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, {
    message: '名称长度必须为 1 到 128 个字符',
  })
  @Matches(/\S/u, { message: '名称不能为空白文本' })
  name!: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 0,
    maxLength: 500,
    nullable: true,
  })
  @ValidateIf((_object: CloneNumberingRuleRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '说明必须是字符串或 null' })
  @IsUnicodeCodePointLength(0, 500, {
    message: '说明长度不能超过 500 个字符',
  })
  description?: string | null
}
