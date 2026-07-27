import { ApiProperty } from '@nestjs/swagger'

import {
  RegionLevel,
  type RegionLevel as RegionLevelValue,
} from '../../../generated/prisma/enums'

export class RegionDto {
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

  @ApiProperty({ type: 'string', nullable: true })
  sourceName!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  sourceCode!: string | null

  @ApiProperty({ type: 'string' })
  administrativeType!: string

  @ApiProperty({ type: 'string', enum: RegionLevel })
  level!: RegionLevelValue

  @ApiProperty({ type: 'boolean' })
  enabled!: boolean

  @ApiProperty({ type: 'boolean' })
  effectiveEnabled!: boolean

  @ApiProperty({ type: 'integer', minimum: 0 })
  sortOrder!: number

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class RegionPageDto {
  @ApiProperty({ type: () => [RegionDto] })
  items!: RegionDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

export class RegionMutationResultDto {
  @ApiProperty({ type: () => RegionDto })
  region!: RegionDto

  @ApiProperty({ type: 'integer', minimum: 0 })
  affectedCount!: number
}
