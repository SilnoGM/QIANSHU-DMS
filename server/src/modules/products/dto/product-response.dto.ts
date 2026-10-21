import { ApiProperty } from '@nestjs/swagger'

import {
  DictionaryTone,
  ProductMediaKind,
  ProductStatus,
} from '../../../generated/prisma/enums'

export const ProductSupplierState = {
  EFFECTIVE: 'EFFECTIVE',
  DISABLED: 'DISABLED',
  UNKNOWN: 'UNKNOWN',
} as const

export type ProductSupplierState =
  (typeof ProductSupplierState)[keyof typeof ProductSupplierState]

export class ProductMoneyDto {
  @ApiProperty({ type: 'string', nullable: true })
  readonly amount!: string | null

  @ApiProperty({ type: 'string', minLength: 3, maxLength: 3 })
  readonly currency!: string
}

export class ProductSupplierDto {
  @ApiProperty({ type: 'string' })
  readonly value!: string

  @ApiProperty({ type: 'string', nullable: true })
  readonly label!: string | null

  @ApiProperty({ enum: DictionaryTone, nullable: true })
  readonly tone!: DictionaryTone | null

  @ApiProperty({ enum: ProductSupplierState })
  readonly state!: ProductSupplierState
}

export class ProductAttributeDto {
  @ApiProperty({ type: 'string' })
  readonly title!: string

  @ApiProperty({ type: 'string' })
  readonly value!: string
}

export class ProductActorDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string' })
  readonly displayName!: string

  @ApiProperty({ type: 'string', nullable: true })
  readonly avatarUrl!: string | null
}

export class ProductMediaItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ enum: ProductMediaKind })
  readonly kind!: ProductMediaKind

  @ApiProperty({ type: 'string' })
  readonly originalFilename!: string

  @ApiProperty({ type: 'string' })
  readonly mimeType!: string

  @ApiProperty({ type: 'string', pattern: '^\\d+$' })
  readonly sizeBytes!: string

  @ApiProperty({ type: 'integer', minimum: 1 })
  readonly width!: number

  @ApiProperty({ type: 'integer', minimum: 1 })
  readonly height!: number

  @ApiProperty({ type: 'integer', minimum: 1, nullable: true })
  readonly durationMs!: number | null

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly sortOrder!: number

  @ApiProperty({ type: 'boolean' })
  readonly isPrimary!: boolean

  @ApiProperty({ type: 'string', example: '/api/products/{productId}/media/{productMediaId}/content' })
  readonly contentUrl!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  readonly createdAt!: string
}

export class ProductMediaDto {
  @ApiProperty({ type: () => ProductMediaItemDto, nullable: true })
  readonly mainImage!: ProductMediaItemDto | null

  @ApiProperty({ type: () => [ProductMediaItemDto] })
  readonly images!: readonly ProductMediaItemDto[]

  @ApiProperty({ type: () => [ProductMediaItemDto] })
  readonly videos!: readonly ProductMediaItemDto[]
}

export class ProductListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string' })
  readonly name!: string

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  readonly categoryId!: string | null

  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 })
  readonly categoryName!: string | null

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  readonly productHeadId!: string | null

  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 })
  readonly productHeadName!: string | null

  @ApiProperty({ type: 'string' })
  readonly productNo!: string

  @ApiProperty({ enum: ProductStatus })
  readonly status!: ProductStatus

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly sortOrder!: number

  @ApiProperty({ type: () => ProductSupplierDto, nullable: true })
  readonly supplier!: ProductSupplierDto | null

  @ApiProperty({ type: () => ProductMediaDto })
  readonly media!: ProductMediaDto

  @ApiProperty({ type: () => ProductMoneyDto })
  readonly twdSalePrice!: ProductMoneyDto

  @ApiProperty({ type: () => ProductMoneyDto })
  readonly myrSalePrice!: ProductMoneyDto

  @ApiProperty({ type: () => ProductMoneyDto })
  readonly purchaseCost!: ProductMoneyDto

  @ApiProperty({ type: () => [ProductAttributeDto] })
  readonly attributes!: readonly ProductAttributeDto[]

  @ApiProperty({ type: 'string', nullable: true, maxLength: 512 })
  readonly remark!: string | null

  @ApiProperty({ type: () => ProductActorDto, nullable: true })
  readonly createdBy!: ProductActorDto | null

  @ApiProperty({ type: () => ProductActorDto, nullable: true })
  readonly updatedBy!: ProductActorDto | null

  @ApiProperty({ type: 'integer', minimum: 1 })
  readonly version!: number

  @ApiProperty({ type: 'string', format: 'date-time' })
  readonly createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  readonly updatedAt!: string
}

export class ProductPageDto {
  @ApiProperty({ type: () => [ProductListItemDto] })
  readonly items!: readonly ProductListItemDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  readonly page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  readonly pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  readonly total!: number
}

