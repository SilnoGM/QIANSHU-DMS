import { ApiProperty } from '@nestjs/swagger'

import {
  DictionaryTone,
  type DictionaryTone as DictionaryToneValue,
} from '../../../generated/prisma/enums'

export class DictionaryTypeDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', minLength: 3, maxLength: 64 })
  code!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  name!: string

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true })
  description!: string | null

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2_147_483_647 })
  sortOrder!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  itemCount!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  enabledItemCount!: number

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class DictionaryItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  dictionaryTypeId!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  value!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  label!: string

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true })
  description!: string | null

  @ApiProperty({ type: 'string', enum: DictionaryTone })
  tone!: DictionaryToneValue

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: 'boolean' })
  effectiveEnabled!: boolean

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2_147_483_647 })
  sortOrder!: number

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class DictionaryTypePageDto {
  @ApiProperty({ type: [DictionaryTypeDto] })
  items!: DictionaryTypeDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

export class DictionaryItemPageDto {
  @ApiProperty({ type: [DictionaryItemDto] })
  items!: DictionaryItemDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

export class DictionaryCatalogItemDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  value!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  label!: string

  @ApiProperty({ type: 'string', enum: DictionaryTone })
  tone!: DictionaryToneValue

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: 'boolean' })
  effectiveEnabled!: boolean

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2_147_483_647 })
  sortOrder!: number
}

export class DictionaryCatalogDto {
  @ApiProperty({ type: 'string', minLength: 3, maxLength: 64 })
  code!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  name!: string

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: [DictionaryCatalogItemDto] })
  items!: DictionaryCatalogItemDto[]
}

export class DictionaryCatalogBatchDto {
  @ApiProperty({ type: [DictionaryCatalogDto] })
  dictionaries!: DictionaryCatalogDto[]

  @ApiProperty({
    type: 'array',
    items: { type: 'string', minLength: 3, maxLength: 64 },
  })
  missingCodes!: string[]
}
