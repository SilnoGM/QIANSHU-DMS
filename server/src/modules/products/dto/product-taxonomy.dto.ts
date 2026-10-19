import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsIn,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

function normalizeName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().normalize('NFC') : value
}

function normalizeSupplierValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value
}

export class ProductTaxonomyCategoryIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4', { message: 'categoryId 必须是 UUID v4' })
  categoryId!: string
}

export class ProductTaxonomyHeadIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4', { message: 'productHeadId 必须是 UUID v4' })
  productHeadId!: string
}

export class ProductTaxonomyCategoryListQueryDto {
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: 64,
    description: '供应商字典 raw value；分类必须按供应商作用域读取',
  })
  @Transform(({ value }: { value: unknown }) => normalizeSupplierValue(value))
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  supplierValue!: string
}

export class ProductTaxonomyOptionsQueryDto {
  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 64,
    description: '按供应商过滤；省略时返回全部供应商的分类',
  })
  @ValidateIf((_object: ProductTaxonomyOptionsQueryDto, value: unknown) =>
    value !== undefined)
  @Transform(({ value }: { value: unknown }) => normalizeSupplierValue(value))
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  supplierValue?: string
}

export class ProductTaxonomyHeadOptionDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string', maxLength: 64 })
  readonly name!: string

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly sortOrder!: number
}

export class ProductTaxonomyCategoryOptionDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string', maxLength: 64 })
  readonly name!: string

  @ApiProperty({ type: 'string', maxLength: 64 })
  readonly supplierValue!: string

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly sortOrder!: number

  @ApiProperty({ type: () => [ProductTaxonomyHeadOptionDto] })
  readonly productHeads!: readonly ProductTaxonomyHeadOptionDto[]
}

export class ProductTaxonomyOptionsDto {
  @ApiProperty({ type: () => [ProductTaxonomyCategoryOptionDto] })
  readonly categories!: readonly ProductTaxonomyCategoryOptionDto[]
}

export class ProductTaxonomyHeadListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string', maxLength: 64 })
  readonly name!: string

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly sortOrder!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly productCount!: number
}

export class ProductTaxonomyCategoryListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string', maxLength: 64 })
  readonly name!: string

  @ApiProperty({ type: 'string', maxLength: 64 })
  readonly supplierValue!: string

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly sortOrder!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly productCount!: number

  @ApiProperty({ type: () => [ProductTaxonomyHeadListItemDto] })
  readonly productHeads!: readonly ProductTaxonomyHeadListItemDto[]
}

export class ProductTaxonomyCategoryListDto {
  @ApiProperty({ type: () => [ProductTaxonomyCategoryListItemDto] })
  readonly items!: readonly ProductTaxonomyCategoryListItemDto[]
}

export class CreateProductTaxonomyCategoryRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) => normalizeSupplierValue(value))
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  supplierValue!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) => normalizeName(value))
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  name!: string
}

export class RenameProductTaxonomyCategoryRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) => normalizeName(value))
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  name!: string
}

export class CreateProductHeadRequestDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4', { message: 'categoryId 必须是 UUID v4' })
  categoryId!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) => normalizeName(value))
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  name!: string
}

export class RenameProductHeadRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) => normalizeName(value))
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  name!: string
}

export class MoveProductTaxonomyItemRequestDto {
  @ApiProperty({ type: 'string', enum: ['up', 'down'] })
  @IsIn(['up', 'down'], { message: 'direction 必须是 up 或 down' })
  direction!: 'up' | 'down'
}

export class ProductTaxonomyTreeHeadDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string', maxLength: 64 })
  readonly name!: string

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly sortOrder!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly productCount!: number
}

export class ProductTaxonomyTreeCategoryDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string', maxLength: 64 })
  readonly name!: string

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly sortOrder!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly productCount!: number

  @ApiProperty({ type: () => [ProductTaxonomyTreeHeadDto] })
  readonly productHeads!: readonly ProductTaxonomyTreeHeadDto[]
}

export class ProductTaxonomyTreeSupplierDto {
  @ApiProperty({ type: 'string', maxLength: 64 })
  readonly supplierValue!: string

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly productCount!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly unclassifiedCount!: number

  @ApiProperty({ type: () => [ProductTaxonomyTreeCategoryDto] })
  readonly categories!: readonly ProductTaxonomyTreeCategoryDto[]
}

export class ProductTaxonomyTreeDto {
  @ApiProperty({ type: () => [ProductTaxonomyTreeSupplierDto] })
  readonly suppliers!: readonly ProductTaxonomyTreeSupplierDto[]

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly totalProducts!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly unclassifiedCount!: number
}
