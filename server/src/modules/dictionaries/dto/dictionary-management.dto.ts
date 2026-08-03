import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger'
import {
  Transform,
  Type,
} from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator'

import {
  isNormalizableDictionaryBatchCodes,
  isNormalizableDictionaryQuery,
  isNormalizableDictionaryTypeCode,
} from '../dictionary.normalizer'

export const DictionaryStatusFilter = {
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
} as const

export type DictionaryStatusFilter =
  (typeof DictionaryStatusFilter)[keyof typeof DictionaryStatusFilter]

export const DictionaryTypeSortBy = {
  SORT_ORDER: 'sortOrder',
  CODE: 'code',
  NAME: 'name',
  UPDATED_AT: 'updatedAt',
} as const

export type DictionaryTypeSortBy =
  (typeof DictionaryTypeSortBy)[keyof typeof DictionaryTypeSortBy]

export const DictionaryItemSortBy = {
  SORT_ORDER: 'sortOrder',
  VALUE: 'value',
  LABEL: 'label',
  UPDATED_AT: 'updatedAt',
} as const

export type DictionaryItemSortBy =
  (typeof DictionaryItemSortBy)[keyof typeof DictionaryItemSortBy]

export const DictionarySortOrder = {
  ASC: 'asc',
  DESC: 'desc',
} as const

export type DictionarySortOrder =
  (typeof DictionarySortOrder)[keyof typeof DictionarySortOrder]

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

function IsNormalizableDictionaryQuery(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalizableDictionaryQuery',
    validator: {
      validate: isNormalizableDictionaryQuery,
      defaultMessage(): string {
        return '规范化后长度必须为 1 到 128 个字符'
      },
    },
  })
}

function IsNormalizableDictionaryBatchCodes(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalizableDictionaryBatchCodes',
    validator: {
      validate: isNormalizableDictionaryBatchCodes,
      defaultMessage(): string {
        return '必须提交 1 到 20 个互不重复的有效字典类型编码'
      },
    },
  })
}

export class DictionaryTypeIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  typeId!: string
}

export class DictionaryItemIdParamDto extends DictionaryTypeIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  itemId!: string
}

export class DictionaryCatalogCodeParamDto {
  @ApiProperty({
    type: 'string',
    description: '接受可规范化的大小写和首尾 Unicode 空白；规范化后长度 3..64',
  })
  @IsString({ message: '必须是字符串' })
  @IsNormalizableDictionaryTypeCode()
  code!: string
}

abstract class DictionaryPaginationQueryDto {
  @ApiPropertyOptional({
    type: 'string',
    description: '规范化后长度 1..128',
  })
  @ValidateIf((_object: DictionaryPaginationQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsNormalizableDictionaryQuery()
  query?: string

  @ApiPropertyOptional({ type: 'string', enum: DictionaryStatusFilter })
  @ValidateIf((_object: DictionaryPaginationQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(DictionaryStatusFilter, { message: '必须是有效的字典状态' })
  status?: DictionaryStatusFilter

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
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

export class DictionaryTypeListQueryDto
  extends DictionaryPaginationQueryDto {
  @ApiPropertyOptional({
    type: 'string',
    enum: DictionaryTypeSortBy,
    default: DictionaryTypeSortBy.SORT_ORDER,
  })
  @IsEnum(DictionaryTypeSortBy, { message: '必须是有效的类型排序字段' })
  sortBy: DictionaryTypeSortBy = DictionaryTypeSortBy.SORT_ORDER

  @ApiPropertyOptional({
    type: 'string',
    enum: DictionarySortOrder,
    default: DictionarySortOrder.ASC,
  })
  @IsEnum(DictionarySortOrder, { message: '必须是有效的排序方向' })
  sortOrder: DictionarySortOrder = DictionarySortOrder.ASC
}

export class DictionaryItemListQueryDto
  extends DictionaryPaginationQueryDto {
  @ApiPropertyOptional({
    type: 'string',
    enum: DictionaryItemSortBy,
    default: DictionaryItemSortBy.SORT_ORDER,
  })
  @IsEnum(DictionaryItemSortBy, { message: '必须是有效的条目排序字段' })
  sortBy: DictionaryItemSortBy = DictionaryItemSortBy.SORT_ORDER

  @ApiPropertyOptional({
    type: 'string',
    enum: DictionarySortOrder,
    default: DictionarySortOrder.ASC,
  })
  @IsEnum(DictionarySortOrder, { message: '必须是有效的排序方向' })
  sortOrder: DictionarySortOrder = DictionarySortOrder.ASC
}

export class DictionaryCatalogBatchQueryDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string' },
    minItems: 1,
    maxItems: 20,
    uniqueItems: true,
    description: '通过 repeated query parameter 传递，不接受逗号拼接',
  })
  // repeated query 单值由 HTTP adapter 表现为 string；这里只统一容器形状，不转换业务值。
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [value] : value,
  )
  // 校验器会按规范化后的 code 判重，避免大小写或首尾空白绕过唯一性限制。
  @IsNormalizableDictionaryBatchCodes()
  codes!: string[]
}
