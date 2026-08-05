import { ApiProperty } from '@nestjs/swagger'

import {
  SupplierEntityType,
  type SupplierEntityType as SupplierEntityTypeValue,
} from '../../../generated/prisma/enums'

export class SupplierRegionReferenceDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string' })
  name!: string
}

export class SupplierListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string' })
  code!: string

  @ApiProperty({ type: 'string' })
  legalName!: string

  @ApiProperty({ type: 'string', nullable: true })
  shortName!: string | null

  @ApiProperty({ type: 'string', enum: SupplierEntityType })
  entityType!: SupplierEntityTypeValue

  @ApiProperty({ type: SupplierRegionReferenceDto, nullable: true })
  registrationCountryRegion!: SupplierRegionReferenceDto | null

  @ApiProperty({ type: 'string', nullable: true })
  primaryContactName!: string | null

  @ApiProperty({ type: 'boolean' })
  hasPrimaryContactPhone!: boolean

  @ApiProperty({ type: 'boolean' })
  hasPrimaryContactWechatId!: boolean

  @ApiProperty({ type: () => [SupplierRegionReferenceDto] })
  primaryAddressRegionPath!: SupplierRegionReferenceDto[]

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class SupplierPageDto {
  @ApiProperty({ type: () => [SupplierListItemDto] })
  items!: SupplierListItemDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

export class SupplierRegistrationDto {
  @ApiProperty({ type: SupplierRegionReferenceDto })
  countryRegion!: SupplierRegionReferenceDto

  @ApiProperty({ type: 'string' })
  number!: string
}

export class SupplierPrimaryContactDto {
  @ApiProperty({ type: 'string', nullable: true })
  name!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  phone!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  wechatId!: string | null
}

export class SupplierPrimaryAddressDto {
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  countryRegionId!: string | null

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  provinceStateId!: string | null

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  cityId!: string | null

  @ApiProperty({ type: () => [SupplierRegionReferenceDto] })
  regionPath!: SupplierRegionReferenceDto[]

  @ApiProperty({ type: 'string', nullable: true })
  addressLine!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  postalCode!: string | null
}

export class SupplierEnableReadinessDto {
  @ApiProperty({ type: 'boolean' })
  ready!: boolean

  @ApiProperty({
    type: 'array',
    items: {
      type: 'string',
      enum: ['primaryContact.name', 'primaryContact.channel'],
    },
  })
  missingFields!: Array<'primaryContact.name' | 'primaryContact.channel'>
}

export class SupplierDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string' })
  code!: string

  @ApiProperty({ type: 'string' })
  legalName!: string

  @ApiProperty({ type: 'string', nullable: true })
  shortName!: string | null

  @ApiProperty({ type: 'string', enum: SupplierEntityType })
  entityType!: SupplierEntityTypeValue

  @ApiProperty({ type: SupplierRegistrationDto, nullable: true })
  registration!: SupplierRegistrationDto | null

  @ApiProperty({ type: SupplierPrimaryContactDto, nullable: true })
  primaryContact!: SupplierPrimaryContactDto | null

  @ApiProperty({ type: SupplierPrimaryAddressDto, nullable: true })
  primaryAddress!: SupplierPrimaryAddressDto | null

  @ApiProperty({ type: 'string', nullable: true })
  remark!: string | null

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: SupplierEnableReadinessDto })
  enableReadiness!: SupplierEnableReadinessDto

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}
