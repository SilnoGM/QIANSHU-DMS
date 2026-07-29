import { ApiProperty } from '@nestjs/swagger'

import { CurrencyCatalogItemDto } from '../../currencies/dto/currency.dto'

export class ExchangeRateDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  currencyId!: string

  @ApiProperty({ type: 'string', example: '4.8' })
  foreignUnitsPerCny!: string

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class ExchangeRateManagementItemDto {
  @ApiProperty({ type: () => CurrencyCatalogItemDto })
  currency!: CurrencyCatalogItemDto

  @ApiProperty({
    type: () => ExchangeRateDto,
    nullable: true,
  })
  currentRate!: ExchangeRateDto | null
}

export class ExchangeRatePageDto {
  @ApiProperty({ type: () => [ExchangeRateManagementItemDto] })
  items!: ExchangeRateManagementItemDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}
