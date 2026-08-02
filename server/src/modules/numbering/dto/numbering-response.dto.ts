import {
  ApiExtraModels,
  ApiProperty,
} from '@nestjs/swagger'

import {
  NUMBERING_RESET_POLICIES,
  type NumberingResetPolicy,
} from '../rule-engine'
import {
  ApiNumberingRuleSegments,
  NumberingDateSegmentInputDto,
  NumberingFixedSegmentInputDto,
  NumberingRandomSegmentInputDto,
  NumberingRuleSegmentInputDto,
  NumberingSeparatorSegmentInputDto,
  NumberingSequenceSegmentInputDto,
} from './numbering-segment.dto'
import {
  NumberingRuleStatus,
  type NumberingRuleStatus as NumberingRuleStatusValue,
} from './numbering-management.dto'

export const NUMBERING_TIME_ZONE = 'Asia/Shanghai' as const

export const NumberingStatisticsSource = {
  ACTIVE: 'ACTIVE',
  DRAFT: 'DRAFT',
} as const

export type NumberingStatisticsSource =
  (typeof NumberingStatisticsSource)[keyof typeof NumberingStatisticsSource]

export const NumberingPeriodStatus = {
  AVAILABLE: 'AVAILABLE',
  EXHAUSTED: 'EXHAUSTED',
} as const

export type NumberingPeriodStatus =
  (typeof NumberingPeriodStatus)[keyof typeof NumberingPeriodStatus]

export const NumberingRuleVersionStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  RETIRED: 'RETIRED',
} as const

export type NumberingRuleVersionStatus =
  (typeof NumberingRuleVersionStatus)[keyof typeof NumberingRuleVersionStatus]

const DECIMAL_PATTERN = '^(?:0|[1-9]\\d*)$'

@ApiExtraModels(
  NumberingFixedSegmentInputDto,
  NumberingDateSegmentInputDto,
  NumberingSeparatorSegmentInputDto,
  NumberingSequenceSegmentInputDto,
  NumberingRandomSegmentInputDto,
)
export class NumberingRuleConfigResponseDto {
  @ApiProperty({ type: 'string', enum: NUMBERING_RESET_POLICIES })
  resetPolicy!: NumberingResetPolicy

  @ApiProperty({
    type: 'string',
    enum: [NUMBERING_TIME_ZONE],
    default: NUMBERING_TIME_ZONE,
  })
  readonly timezone: typeof NUMBERING_TIME_ZONE = NUMBERING_TIME_ZONE

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 64 })
  maxOutputLength!: number

  @ApiNumberingRuleSegments()
  segments!: NumberingRuleSegmentInputDto[]
}

export class NumberingRuleStatisticsDto {
  @ApiProperty({ type: 'string', enum: NumberingStatisticsSource })
  statisticsSource!: NumberingStatisticsSource

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 16 })
  periodKey!: string

  @ApiProperty({ type: 'string', pattern: DECIMAL_PATTERN })
  capacity!: string

  @ApiProperty({ type: 'string', pattern: DECIMAL_PATTERN })
  usedCount!: string

  @ApiProperty({ type: 'string', pattern: DECIMAL_PATTERN })
  remainingCount!: string

  @ApiProperty({ type: 'string', pattern: DECIMAL_PATTERN })
  lifetimeUsedCount!: string

  @ApiProperty({
    type: 'string',
    pattern: DECIMAL_PATTERN,
    nullable: true,
  })
  nextSequenceValue!: string | null

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64, nullable: true })
  nextNumberPreview!: string | null

  @ApiProperty({ type: 'boolean' })
  nextNumberDeterministic!: boolean

  @ApiProperty({ type: 'string', enum: NumberingPeriodStatus })
  periodStatus!: NumberingPeriodStatus

  @ApiProperty({ type: 'string', format: 'date-time' })
  asOf!: string
}

export class NumberingRuleVersionDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'integer', minimum: 1 })
  revision!: number

  @ApiProperty({ type: 'string', enum: NumberingRuleVersionStatus })
  status!: NumberingRuleVersionStatus

  @ApiProperty({ type: NumberingRuleConfigResponseDto })
  config!: NumberingRuleConfigResponseDto

  @ApiProperty({ type: 'string', pattern: DECIMAL_PATTERN })
  capacity!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  publishedAt!: string | null
}

export class NumberingRuleListItemDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  ruleCode!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  name!: string

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true })
  description!: string | null

  @ApiProperty({ type: 'string', enum: NumberingRuleStatus })
  status!: NumberingRuleStatusValue

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number

  @ApiProperty({ type: 'integer', minimum: 1, nullable: true })
  activeRevision!: number | null

  @ApiProperty({ type: 'integer', minimum: 1, nullable: true })
  draftRevision!: number | null

  @ApiProperty({ type: NumberingRuleVersionDto })
  displayVersion!: NumberingRuleVersionDto

  @ApiProperty({ type: NumberingRuleStatisticsDto })
  statistics!: NumberingRuleStatisticsDto

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class NumberingRuleDetailDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  ruleCode!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  name!: string

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true })
  description!: string | null

  @ApiProperty({ type: 'string', enum: NumberingRuleStatus })
  status!: NumberingRuleStatusValue

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number

  @ApiProperty({ type: NumberingRuleVersionDto, nullable: true })
  activeVersion!: NumberingRuleVersionDto | null

  @ApiProperty({ type: NumberingRuleVersionDto, nullable: true })
  draftVersion!: NumberingRuleVersionDto | null

  @ApiProperty({ type: NumberingRuleStatisticsDto })
  statistics!: NumberingRuleStatisticsDto

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class PreviewNumberingRuleResponseDto {
  @ApiProperty({ type: NumberingRuleConfigResponseDto })
  normalizedConfig!: NumberingRuleConfigResponseDto

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 16 })
  periodKey!: string

  @ApiProperty({ type: 'string', pattern: DECIMAL_PATTERN })
  capacity!: string

  @ApiProperty({ type: 'string', pattern: DECIMAL_PATTERN })
  usedCount!: string

  @ApiProperty({ type: 'string', pattern: DECIMAL_PATTERN })
  remainingCount!: string

  @ApiProperty({
    type: 'string',
    pattern: DECIMAL_PATTERN,
    nullable: true,
  })
  nextSequenceValue!: string | null

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64, nullable: true })
  nextNumberPreview!: string | null

  @ApiProperty({ type: 'boolean' })
  nextNumberDeterministic!: boolean

  @ApiProperty({ type: 'string', enum: NumberingPeriodStatus })
  periodStatus!: NumberingPeriodStatus

  @ApiProperty({
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 64 },
    maxItems: 5,
  })
  samples!: string[]

  @ApiProperty({ type: 'string', format: 'date-time' })
  asOf!: string
}

export class NumberingIssuanceDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'integer', minimum: 1 })
  ruleRevision!: number

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 16 })
  periodKey!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  generatedNumber!: string

  @ApiProperty({
    type: 'string',
    pattern: DECIMAL_PATTERN,
    nullable: true,
  })
  sequenceValue!: string | null

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  consumerCode!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  issuedAt!: string
}

export class NumberingRulePageDto {
  @ApiProperty({ type: [NumberingRuleListItemDto] })
  items!: NumberingRuleListItemDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

export class NumberingRuleVersionPageDto {
  @ApiProperty({ type: [NumberingRuleVersionDto] })
  items!: NumberingRuleVersionDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

export class NumberingIssuancePageDto {
  @ApiProperty({ type: [NumberingIssuanceDto] })
  items!: NumberingIssuanceDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}
