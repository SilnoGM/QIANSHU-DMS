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
  type ValidationArguments,
  ValidateBy,
  ValidateIf,
} from 'class-validator'

import {
  RegionLevel,
  type RegionLevel as RegionLevelValue,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export const RegionOwnStatus = {
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
} as const

export type RegionOwnStatus =
  (typeof RegionOwnStatus)[keyof typeof RegionOwnStatus]

export const RegionAvailability = {
  EFFECTIVE: 'EFFECTIVE',
  ANCESTOR_DISABLED: 'ANCESTOR_DISABLED',
} as const

export type RegionAvailability =
  (typeof RegionAvailability)[keyof typeof RegionAvailability]

export const RegionSortBy = {
  CODE: 'code',
  NAME: 'name',
  SORT_ORDER: 'sortOrder',
  UPDATED_AT: 'updatedAt',
} as const

export type RegionSortBy =
  (typeof RegionSortBy)[keyof typeof RegionSortBy]

export const RegionSortOrder = {
  ASC: 'asc',
  DESC: 'desc',
} as const

export type RegionSortOrder =
  (typeof RegionSortOrder)[keyof typeof RegionSortOrder]

/**
 * `ownStatus=DISABLED` 已能完整描述节点自身状态，不能再与“有效性”组合，
 * 否则查询语义会变成一个永远为空或互相矛盾的条件。
 */
function IsCompatibleRegionAvailability(): PropertyDecorator {
  return ValidateBy({
    name: 'isCompatibleRegionAvailability',
    validator: {
      validate(value: unknown, arguments_: ValidationArguments): boolean {
        if (value === undefined) {
          return true
        }

        const query = arguments_.object as RegionListQueryDto
        return query.ownStatus !== RegionOwnStatus.DISABLED
      },
      defaultMessage(): string {
        return '自身停用状态不能与可用性筛选同时使用'
      },
    },
  })
}

export class RegionIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  regionId!: string
}

export class RegionListQueryDto {
  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @ValidateIf((_object: RegionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  parentId?: string

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((_object: RegionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, { message: '长度必须为 1 到 128 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  query?: string

  @ApiPropertyOptional({ type: 'string', minLength: 2, maxLength: 64 })
  @ValidateIf((_object: RegionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(2, 64, { message: '长度必须为 2 到 64 个字符' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/u, {
    message: '只能包含英文字母、数字、点、下划线和连字符',
  })
  code?: string

  @ApiPropertyOptional({
    type: 'string',
    enum: RegionOwnStatus,
  })
  @ValidateIf((_object: RegionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(RegionOwnStatus, { message: '必须是有效的自身状态' })
  ownStatus?: RegionOwnStatus

  @ApiPropertyOptional({
    type: 'string',
    enum: RegionAvailability,
  })
  @ValidateIf((_object: RegionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(RegionAvailability, { message: '必须是有效的可用性状态' })
  @IsCompatibleRegionAvailability()
  availability?: RegionAvailability

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

  @ApiPropertyOptional({
    type: 'string',
    enum: RegionSortBy,
  })
  @ValidateIf((_object: RegionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(RegionSortBy, { message: '必须是有效的排序字段' })
  sortBy?: RegionSortBy

  @ApiPropertyOptional({
    type: 'string',
    enum: RegionSortOrder,
  })
  @ValidateIf((_object: RegionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(RegionSortOrder, { message: '必须是有效的排序方向' })
  sortOrder?: RegionSortOrder
}

export class RegionNavigationNodeDto {
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

  @ApiProperty({ type: () => [RegionNavigationNodeDto] })
  children!: RegionNavigationNodeDto[]
}
