import { ApiProperty } from '@nestjs/swagger'

export class CurrencyCatalogItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', minLength: 3, maxLength: 3 })
  code!: string

  @ApiProperty({ type: 'string' })
  name!: string

  @ApiProperty({ type: 'string', nullable: true })
  englishName!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  symbol!: string | null

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 4 })
  minorUnit!: number

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: 'boolean' })
  isBase!: boolean

  @ApiProperty({ type: 'integer', minimum: 0 })
  sortOrder!: number
}

export class CurrencyDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', minLength: 3, maxLength: 3 })
  code!: string

  @ApiProperty({ type: 'string' })
  name!: string

  @ApiProperty({ type: 'string', nullable: true })
  englishName!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  symbol!: string | null

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 4 })
  minorUnit!: number

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: 'boolean' })
  isBase!: boolean

  @ApiProperty({ type: 'integer', minimum: 0 })
  sortOrder!: number

  @ApiProperty({ type: 'boolean' })
  exchangeRateConfigured!: boolean

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class CurrencyPageDto {
  @ApiProperty({ type: () => [CurrencyDto] })
  items!: CurrencyDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}
