import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger'
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const MAX_INT32 = 2_147_483_647
const REGION_CODE_INPUT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/u

export class CreateRegionRequestDto {
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    nullable: true,
    description: '上级地区 UUID；创建国家/地区时显式传 null',
  })
  @ValidateIf((_object: CreateRegionRequestDto, value: unknown) =>
    value !== null,
  )
  @IsDefined({ message: '必须明确指定上级地区，根节点使用 null' })
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  parentId!: string | null

  @ApiProperty({ type: 'string', minLength: 2, maxLength: 64 })
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(2, 64, { message: '长度必须为 2 到 64 个字符' })
  @Matches(REGION_CODE_INPUT_PATTERN, {
    message: '只能包含英文字母、数字、点、下划线和连字符',
  })
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
  @ValidateIf((_object: CreateRegionRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(0, 128, { message: '长度不能超过 128 个字符' })
  englishName?: string

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: MAX_INT32,
  })
  @IsInt({ message: '必须是整数' })
  @Min(0, { message: '不能小于 0' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  sortOrder!: number

  @ApiProperty({ type: 'boolean' })
  @IsBoolean({ message: '必须是布尔值' })
  enabled!: boolean
}

export class UpdateRegionRequestDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((object: UpdateRegionRequestDto, value: unknown) =>
    value !== undefined
    || (
      object.englishName === undefined
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
  @ValidateIf((_object: UpdateRegionRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(0, 128, { message: '长度不能超过 128 个字符' })
  englishName?: string | null

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: MAX_INT32,
  })
  @ValidateIf((_object: UpdateRegionRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsInt({ message: '必须是整数' })
  @Min(0, { message: '不能小于 0' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  sortOrder?: number
}
