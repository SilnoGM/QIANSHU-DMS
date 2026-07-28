import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

import {
  RegionLevel,
  type RegionLevel as RegionLevelValue,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class RegionOptionsQueryDto {
  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @ValidateIf((_object: RegionOptionsQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  parentId?: string
}

export class RegionSearchQueryDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, { message: '长度必须为 1 到 128 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  query!: string

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 50,
    default: 20,
  })
  @Type(() => Number)
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  @Max(50, { message: '不能超过 50' })
  limit = 20
}

export class RegionCityIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  cityId!: string
}

export class RegionOptionDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  parentId!: string | null

  @ApiProperty({ type: 'string' })
  code!: string

  @ApiProperty({ type: 'string' })
  name!: string

  @ApiProperty({ type: 'string', nullable: true })
  englishName!: string | null

  @ApiProperty({ type: 'string', enum: RegionLevel })
  level!: RegionLevelValue

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: 'boolean' })
  effectiveEnabled!: boolean

  @ApiProperty({ type: 'boolean' })
  hasChildren!: boolean
}

export class RegionPathNodeDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  parentId!: string | null

  @ApiProperty({ type: 'string' })
  code!: string

  @ApiProperty({ type: 'string' })
  name!: string

  @ApiProperty({ type: 'string', nullable: true })
  englishName!: string | null

  @ApiProperty({ type: 'string', enum: RegionLevel })
  level!: RegionLevelValue

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: 'boolean' })
  effectiveEnabled!: boolean

  @ApiProperty({ type: 'boolean' })
  hasChildren!: boolean
}

export class RegionPathDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  cityId!: string

  @ApiProperty({
    type: () => [RegionPathNodeDto],
    minItems: 3,
    maxItems: 3,
  })
  path!: [
    RegionPathNodeDto,
    RegionPathNodeDto,
    RegionPathNodeDto,
  ]
}

export class RegionSearchItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  cityId!: string

  @ApiProperty({
    type: () => [RegionPathNodeDto],
    minItems: 3,
    maxItems: 3,
  })
  path!: [
    RegionPathNodeDto,
    RegionPathNodeDto,
    RegionPathNodeDto,
  ]
}

export class RegionSearchResponseDto {
  @ApiProperty({ type: () => [RegionSearchItemDto] })
  items!: RegionSearchItemDto[]

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 50 })
  limit!: number

  @ApiProperty({ type: 'boolean' })
  hasMore!: boolean
}
