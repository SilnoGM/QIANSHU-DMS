import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger'
import {
  IsEnum,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator'

import {
  DictionaryTone,
  type DictionaryTone as DictionaryToneValue,
} from '../../../generated/prisma/enums'
import {
  isNormalizableDictionaryDescription,
  isNormalizableDictionaryItemValue,
  isNormalizableDictionaryLabel,
  isNormalizableDictionaryName,
  isNormalizableDictionaryTypeCode,
} from '../dictionary.normalizer'

const MAX_INT32 = 2_147_483_647

/**
 * DTO 只判断输入能否按字典规则规范化，实际 NFC、空白折叠和大小写转换仍由
 * normalizer 统一执行。这样可以按“规范化后的 code point”校验长度，同时避免
 * `@Transform` 与业务层各自维护一套转换规则。
 */
function IsNormalizableDictionaryTypeCode(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalizableDictionaryTypeCode',
    validator: {
      validate: isNormalizableDictionaryTypeCode,
      defaultMessage(): string {
        return '规范化后必须是包含命名空间点的 ASCII 字典类型编码'
      },
    },
  })
}

function IsNormalizableDictionaryItemValue(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalizableDictionaryItemValue',
    validator: {
      validate: isNormalizableDictionaryItemValue,
      defaultMessage(): string {
        return '规范化后只能包含英文字母、数字、点、下划线和连字符'
      },
    },
  })
}

function IsNormalizableDictionaryName(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalizableDictionaryName',
    validator: {
      validate: isNormalizableDictionaryName,
      defaultMessage(): string {
        return '规范化后长度必须为 1 到 128 个字符'
      },
    },
  })
}

function IsNormalizableDictionaryLabel(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalizableDictionaryLabel',
    validator: {
      validate: isNormalizableDictionaryLabel,
      defaultMessage(): string {
        return '规范化后长度必须为 1 到 128 个字符'
      },
    },
  })
}

function IsNormalizableDictionaryDescription(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalizableDictionaryDescription',
    validator: {
      validate: isNormalizableDictionaryDescription,
      defaultMessage(): string {
        return '规范化后长度不能超过 500 个字符'
      },
    },
  })
}

abstract class DictionaryExpectedVersionRequestDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_INT32,
  })
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  expectedVersion!: number
}

export class CreateDictionaryTypeRequestDto {
  @ApiProperty({
    type: 'string',
    description: '接受可规范化的大小写和首尾 Unicode 空白；规范化后长度 3..64',
  })
  @IsString({ message: '必须是字符串' })
  @IsNormalizableDictionaryTypeCode()
  code!: string

  @ApiProperty({ type: 'string', description: '规范化后长度 1..128' })
  @IsString({ message: '必须是字符串' })
  @IsNormalizableDictionaryName()
  name!: string

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    description: 'null 或规范化为空白表示不设置说明；非空规范化后最长 500',
  })
  @ValidateIf((_object: CreateDictionaryTypeRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableDictionaryDescription()
  description?: string | null

  @ApiProperty({ type: 'integer', minimum: 0, maximum: MAX_INT32 })
  @IsInt({ message: '必须是整数' })
  @Min(0, { message: '不能小于 0' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  sortOrder!: number
}

/** `expectedVersion` 不是可变字段；三个业务字段都缺失时借 name 产生空 Patch 错误。 */
export class UpdateDictionaryTypeRequestDto {
  @ApiPropertyOptional({
    type: 'string',
    description: '规范化后长度 1..128',
  })
  @ValidateIf((object: UpdateDictionaryTypeRequestDto, value: unknown) =>
    value !== undefined
    || (
      object.description === undefined
      && object.sortOrder === undefined
    ),
  )
  @IsString({ message: '必须是字符串' })
  @IsNormalizableDictionaryName()
  name?: string

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    description: 'null 或规范化为空白表示清空说明；非空规范化后最长 500',
  })
  @ValidateIf((_object: UpdateDictionaryTypeRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableDictionaryDescription()
  description?: string | null

  @ApiPropertyOptional({ type: 'integer', minimum: 0, maximum: MAX_INT32 })
  @ValidateIf((_object: UpdateDictionaryTypeRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsInt({ message: '必须是整数' })
  @Min(0, { message: '不能小于 0' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  sortOrder?: number

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_INT32,
  })
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  expectedVersion!: number
}

export class CreateDictionaryItemRequestDto {
  @ApiProperty({
    type: 'string',
    description: '接受可规范化的大小写和首尾 Unicode 空白；规范化后长度 1..64',
  })
  @IsString({ message: '必须是字符串' })
  @IsNormalizableDictionaryItemValue()
  value!: string

  @ApiProperty({ type: 'string', description: '规范化后长度 1..128' })
  @IsString({ message: '必须是字符串' })
  @IsNormalizableDictionaryLabel()
  label!: string

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    description: 'null 或规范化为空白表示不设置说明；非空规范化后最长 500',
  })
  @ValidateIf((_object: CreateDictionaryItemRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableDictionaryDescription()
  description?: string | null

  @ApiPropertyOptional({
    type: 'string',
    enum: DictionaryTone,
    default: DictionaryTone.DEFAULT,
  })
  @ValidateIf((_object: CreateDictionaryItemRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(DictionaryTone, { message: '必须是有效的字典 Tone' })
  tone?: DictionaryToneValue

  @ApiProperty({ type: 'integer', minimum: 0, maximum: MAX_INT32 })
  @IsInt({ message: '必须是整数' })
  @Min(0, { message: '不能小于 0' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  sortOrder!: number
}

/** `expectedVersion` 不是可变字段；四个业务字段都缺失时借 label 产生空 Patch 错误。 */
export class UpdateDictionaryItemRequestDto {
  @ApiPropertyOptional({
    type: 'string',
    description: '规范化后长度 1..128',
  })
  @ValidateIf((object: UpdateDictionaryItemRequestDto, value: unknown) =>
    value !== undefined
    || (
      object.description === undefined
      && object.tone === undefined
      && object.sortOrder === undefined
    ),
  )
  @IsString({ message: '必须是字符串' })
  @IsNormalizableDictionaryLabel()
  label?: string

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    description: 'null 或规范化为空白表示清空说明；非空规范化后最长 500',
  })
  @ValidateIf((_object: UpdateDictionaryItemRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableDictionaryDescription()
  description?: string | null

  @ApiPropertyOptional({ type: 'string', enum: DictionaryTone })
  @ValidateIf((_object: UpdateDictionaryItemRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(DictionaryTone, { message: '必须是有效的字典 Tone' })
  tone?: DictionaryToneValue

  @ApiPropertyOptional({ type: 'integer', minimum: 0, maximum: MAX_INT32 })
  @ValidateIf((_object: UpdateDictionaryItemRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsInt({ message: '必须是整数' })
  @Min(0, { message: '不能小于 0' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  sortOrder?: number

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_INT32,
  })
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  expectedVersion!: number
}

export class ChangeDictionaryStatusRequestDto
  extends DictionaryExpectedVersionRequestDto {}

/**
 * class-validator 的空 Patch 规则无法自动进入 OpenAPI。Task 8 的 Controller 必须
 * 复用这两个 body schema，保证公开契约和运行时都要求至少一个可变字段。
 */
export const UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA = {
  allOf: [
    { $ref: getSchemaPath(UpdateDictionaryTypeRequestDto) },
    {
      anyOf: [
        { required: ['name'] },
        { required: ['description'] },
        { required: ['sortOrder'] },
      ],
    },
  ],
}

export const UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA = {
  allOf: [
    { $ref: getSchemaPath(UpdateDictionaryItemRequestDto) },
    {
      anyOf: [
        { required: ['label'] },
        { required: ['description'] },
        { required: ['tone'] },
        { required: ['sortOrder'] },
      ],
    },
  ],
}
