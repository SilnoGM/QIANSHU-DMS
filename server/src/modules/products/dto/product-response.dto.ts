import { ApiProperty } from '@nestjs/swagger'

import { DictionaryTone, ProductStatus } from '../../../generated/prisma/enums'

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
}

export class ProductListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly id!: string

  @ApiProperty({ type: 'string' })
  readonly name!: string

  @ApiProperty({ type: 'string' })
  readonly productNo!: string

  @ApiProperty({ enum: ProductStatus })
  readonly status!: ProductStatus

  @ApiProperty({ type: () => ProductSupplierDto, nullable: true })
  readonly supplier!: ProductSupplierDto | null

  @ApiProperty({ type: 'string', nullable: true })
  readonly mainImage!: string | null

  @ApiProperty({ type: [String] })
  readonly images!: readonly string[]

  @ApiProperty({ type: [String] })
  readonly videos!: readonly string[]

  @ApiProperty({ type: () => ProductMoneyDto })
  readonly twdSalePrice!: ProductMoneyDto

  @ApiProperty({ type: () => ProductMoneyDto })
  readonly myrSalePrice!: ProductMoneyDto

  @ApiProperty({ type: () => ProductMoneyDto })
  readonly purchaseCost!: ProductMoneyDto

  @ApiProperty({ type: () => [ProductAttributeDto] })
  readonly attributes!: readonly ProductAttributeDto[]

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
