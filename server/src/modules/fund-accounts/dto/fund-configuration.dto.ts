import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import {
  FUND_BUSINESS_SOURCE_SORT_FIELDS,
  FUND_POSTING_TYPE_SORT_FIELDS,
  type FundBusinessSourceSortField,
  type FundConfigurationSortOrder,
  type FundPostingRuleStatus,
  type FundPostingTypeSortField,
} from '../application/fund-configuration.contract'
import {
  FUND_ACCOUNT_TARGETS,
  FUND_ADJUSTMENT_MODES,
  FUND_AMOUNT_SIGN_POLICIES,
  FUND_AMOUNT_STRATEGIES,
  FUND_BUSINESS_CATEGORIES,
  FUND_DIRECTION_POLICIES,
  FUND_RULE_INPUT_MODES,
  type FundAccountTarget,
  type FundAdjustmentMode,
  type FundAmountSignPolicy,
  type FundAmountStrategy,
  type FundBusinessCategory,
  type FundDirectionPolicy,
  type FundRuleInputMode,
} from '../domain'

const MAX_INT32 = 2_147_483_647
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u

/**
 * HTTP 查询参数均以字符串进入应用。这里只转换严格的 true/false，其他值原样
 * 交给 class-validator 拒绝，避免 Boolean('false') 被误判为 true。
 */
function transformBooleanQueryValue(value: unknown): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

export class FundPostingTypeIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: 'postingTypeId 必须是有效的 UUID' })
  postingTypeId!: string
}

export class FundBusinessSourceIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: 'businessSourceId 必须是有效的 UUID' })
  businessSourceId!: string
}

abstract class FundConfigurationPaginationQueryDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt({ message: 'page 必须是整数' })
  @Min(1, { message: 'page 不能小于 1' })
  page = 1

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @Type(() => Number)
  @IsInt({ message: 'pageSize 必须是整数' })
  @Min(1, { message: 'pageSize 不能小于 1' })
  @Max(100, { message: 'pageSize 不能超过 100' })
  pageSize = 20

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((_object: FundConfigurationPaginationQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: 'search 必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, {
    message: 'search 长度必须为 1 到 128 个字符',
  })
  @Matches(/\S/u, { message: 'search 不能为空白文本' })
  search?: string
}

export class FundPostingTypeListQueryDto
  extends FundConfigurationPaginationQueryDto {
  @ApiPropertyOptional({ type: 'string', enum: FUND_BUSINESS_CATEGORIES })
  @ValidateIf((_object: FundPostingTypeListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsIn(FUND_BUSINESS_CATEGORIES, {
    message: 'businessCategory 不在白名单内',
  })
  businessCategory?: FundBusinessCategory

  @ApiPropertyOptional({ type: 'boolean' })
  @Transform(({ value }: { value: unknown }) =>
    transformBooleanQueryValue(value),
  )
  @ValidateIf((_object: FundPostingTypeListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean

  @ApiPropertyOptional({
    type: 'string',
    enum: FUND_POSTING_TYPE_SORT_FIELDS,
    default: 'updatedAt',
  })
  @IsIn(FUND_POSTING_TYPE_SORT_FIELDS, { message: 'sortBy 不在白名单内' })
  sortBy: FundPostingTypeSortField = 'updatedAt'

  @ApiPropertyOptional({ type: 'string', enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc'], { message: 'sortOrder 只允许 asc 或 desc' })
  sortOrder: FundConfigurationSortOrder = 'desc'
}

export class FundBusinessSourceListQueryDto
  extends FundConfigurationPaginationQueryDto {
  @ApiPropertyOptional({ type: 'boolean' })
  @Transform(({ value }: { value: unknown }) =>
    transformBooleanQueryValue(value),
  )
  @ValidateIf((_object: FundBusinessSourceListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean

  @ApiPropertyOptional({
    type: 'string',
    enum: FUND_BUSINESS_SOURCE_SORT_FIELDS,
    default: 'updatedAt',
  })
  @IsIn(FUND_BUSINESS_SOURCE_SORT_FIELDS, { message: 'sortBy 不在白名单内' })
  sortBy: FundBusinessSourceSortField = 'updatedAt'

  @ApiPropertyOptional({ type: 'string', enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc'], { message: 'sortOrder 只允许 asc 或 desc' })
  sortOrder: FundConfigurationSortOrder = 'desc'
}

export class FundPostingRuleLegRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 8 })
  @IsInt({ message: 'position 必须是整数' })
  @Min(1, { message: 'position 不能小于 1' })
  @Max(8, { message: 'position 不能超过 8' })
  position!: number

  @ApiProperty({ type: 'string', enum: FUND_ACCOUNT_TARGETS })
  @IsIn(FUND_ACCOUNT_TARGETS, { message: 'accountTarget 不在白名单内' })
  accountTarget!: FundAccountTarget

  @ApiProperty({ type: 'string', enum: FUND_DIRECTION_POLICIES })
  @IsIn(FUND_DIRECTION_POLICIES, {
    message: 'directionPolicy 不在白名单内',
  })
  directionPolicy!: FundDirectionPolicy

  @ApiProperty({ type: 'string', enum: FUND_AMOUNT_STRATEGIES })
  @IsIn(FUND_AMOUNT_STRATEGIES, {
    message: 'amountStrategy 不在白名单内',
  })
  amountStrategy!: FundAmountStrategy

  @ApiPropertyOptional({ type: 'string', enum: FUND_ADJUSTMENT_MODES })
  @IsOptional()
  @IsIn(FUND_ADJUSTMENT_MODES, {
    message: 'adjustmentMode 不在白名单内',
  })
  adjustmentMode?: FundAdjustmentMode
}

abstract class FundPostingTypeProfileRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString({ message: 'name 必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, {
    message: 'name 长度必须为 1 到 128 个字符',
  })
  @Matches(/\S/u, { message: 'name 不能为空白文本' })
  name!: string

  @ApiPropertyOptional({
    type: 'string',
    maxLength: 500,
    nullable: true,
  })
  @ValidateIf((_object: FundPostingTypeProfileRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: 'description 必须是字符串或 null' })
  @IsUnicodeCodePointLength(0, 500, {
    message: 'description 不能超过 500 个字符',
  })
  description?: string | null
}

export class CreateFundPostingTypeRequestDto
  extends FundPostingTypeProfileRequestDto {
  @ApiProperty({ type: 'string', pattern: CODE_PATTERN.source })
  @IsString({ message: 'code 必须是字符串' })
  @Matches(CODE_PATTERN, { message: 'code 格式无效' })
  code!: string

  @ApiProperty({
    type: 'string',
    enum: FUND_BUSINESS_CATEGORIES.filter(value => value !== 'ADJUSTMENT'),
  })
  @IsIn(FUND_BUSINESS_CATEGORIES.filter(value => value !== 'ADJUSTMENT'), {
    message: 'businessCategory 不允许 ADJUSTMENT',
  })
  businessCategory!: Exclude<FundBusinessCategory, 'ADJUSTMENT'>

  @ApiProperty({ type: 'boolean' })
  @IsBoolean({ message: 'requiresUser 必须是布尔值' })
  requiresUser!: boolean

  @ApiProperty({ type: 'string', enum: FUND_AMOUNT_SIGN_POLICIES })
  @IsIn(FUND_AMOUNT_SIGN_POLICIES, {
    message: 'amountSignPolicy 不在白名单内',
  })
  amountSignPolicy!: FundAmountSignPolicy

  @ApiProperty({ type: () => [FundPostingRuleLegRequestDto] })
  @IsArray({ message: 'legs 必须是数组' })
  @ArrayMinSize(1, { message: 'legs 至少包含一项' })
  @ArrayMaxSize(8, { message: 'legs 不能超过八项' })
  @ValidateNested({ each: true })
  @Type(() => FundPostingRuleLegRequestDto)
  legs!: FundPostingRuleLegRequestDto[]
}

export class UpdateFundPostingTypeRequestDto
  extends FundPostingTypeProfileRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_INT32 })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  @Max(MAX_INT32, { message: 'expectedVersion 超出范围' })
  expectedVersion!: number
}

export class ReplaceFundDraftRuleRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_INT32 })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  @Max(MAX_INT32, { message: 'expectedVersion 超出范围' })
  expectedVersion!: number

  @ApiProperty({ type: () => [FundPostingRuleLegRequestDto] })
  @IsArray({ message: 'legs 必须是数组' })
  @ArrayMinSize(1, { message: 'legs 至少包含一项' })
  @ArrayMaxSize(8, { message: 'legs 不能超过八项' })
  @ValidateNested({ each: true })
  @Type(() => FundPostingRuleLegRequestDto)
  legs!: FundPostingRuleLegRequestDto[]
}

export class PublishFundPostingRuleRequestDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: 'draftRuleVersionId 必须是有效的 UUID' })
  draftRuleVersionId!: string

  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_INT32 })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  @Max(MAX_INT32, { message: 'expectedVersion 超出范围' })
  expectedVersion!: number
}

export class ChangeFundConfigurationStatusRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_INT32 })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  @Max(MAX_INT32, { message: 'expectedVersion 超出范围' })
  expectedVersion!: number
}

abstract class FundBusinessSourceProfileRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString({ message: 'name 必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, {
    message: 'name 长度必须为 1 到 128 个字符',
  })
  @Matches(/\S/u, { message: 'name 不能为空白文本' })
  name!: string

  @ApiPropertyOptional({ type: 'string', maxLength: 500, nullable: true })
  @ValidateIf((_object: FundBusinessSourceProfileRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString({ message: 'description 必须是字符串或 null' })
  @IsUnicodeCodePointLength(0, 500, {
    message: 'description 不能超过 500 个字符',
  })
  description?: string | null

  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    uniqueItems: true,
  })
  @IsArray({ message: 'allowedPostingTypeIds 必须是数组' })
  @ArrayMaxSize(100, { message: 'allowedPostingTypeIds 不能超过 100 项' })
  @IsUUID(undefined, {
    each: true,
    message: 'allowedPostingTypeIds 必须全部是有效 UUID',
  })
  allowedPostingTypeIds!: string[]
}

export class CreateFundBusinessSourceRequestDto
  extends FundBusinessSourceProfileRequestDto {
  @ApiProperty({ type: 'string', pattern: CODE_PATTERN.source })
  @IsString({ message: 'code 必须是字符串' })
  @Matches(CODE_PATTERN, { message: 'code 格式无效' })
  code!: string

  @ApiProperty({ type: 'boolean' })
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled!: boolean
}

export class UpdateFundBusinessSourceRequestDto
  extends FundBusinessSourceProfileRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_INT32 })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  @Max(MAX_INT32, { message: 'expectedVersion 超出范围' })
  expectedVersion!: number
}

export class FundPostingRuleLegDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) position!: number
  @ApiProperty({ type: 'string', enum: FUND_ACCOUNT_TARGETS }) accountTarget!: FundAccountTarget
  @ApiProperty({ type: 'string', enum: FUND_DIRECTION_POLICIES }) directionPolicy!: FundDirectionPolicy
  @ApiProperty({ type: 'string', enum: FUND_AMOUNT_STRATEGIES }) amountStrategy!: FundAmountStrategy
  @ApiProperty({ type: 'string', enum: FUND_ADJUSTMENT_MODES, nullable: true }) adjustmentMode!: FundAdjustmentMode | null
}

export class FundPostingRuleVersionDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) revision!: number
  @ApiProperty({ type: 'string', enum: ['DRAFT', 'ACTIVE', 'RETIRED'] }) status!: FundPostingRuleStatus
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) createdByUserId!: string | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) publishedByUserId!: string | null
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) publishedAt!: string | null
  @ApiProperty({ type: () => [FundPostingRuleLegDto] }) legs!: readonly FundPostingRuleLegDto[]
}

export class FundPostingTypeDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string
  @ApiProperty({ type: 'string' }) code!: string
  @ApiProperty({ type: 'string' }) name!: string
  @ApiProperty({ type: 'string', nullable: true }) description!: string | null
  @ApiProperty({ type: 'string', enum: FUND_BUSINESS_CATEGORIES }) businessCategory!: FundBusinessCategory
  @ApiProperty({ type: 'boolean' }) requiresUser!: boolean
  @ApiProperty({ type: 'string', enum: FUND_AMOUNT_SIGN_POLICIES }) amountSignPolicy!: FundAmountSignPolicy
  @ApiProperty({ type: 'string', enum: FUND_RULE_INPUT_MODES }) inputMode!: FundRuleInputMode
  @ApiProperty({ type: 'boolean' }) enabled!: boolean
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) currentRuleVersionId!: string | null
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number
  @ApiProperty({ type: () => FundPostingRuleVersionDto, nullable: true }) activeRule!: FundPostingRuleVersionDto | null
  @ApiProperty({ type: () => FundPostingRuleVersionDto, nullable: true }) draftRule!: FundPostingRuleVersionDto | null
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string
}

export class FundPostingTypePageDto {
  @ApiProperty({ type: () => [FundPostingTypeDto] }) items!: readonly FundPostingTypeDto[]
  @ApiProperty({ type: 'integer', minimum: 1 }) page!: number
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 }) pageSize!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) total!: number
}

export class FundPostingTypeMutationResultDto {
  @ApiProperty({ type: 'boolean' }) changed!: boolean
  @ApiProperty({ type: () => FundPostingTypeDto }) postingType!: FundPostingTypeDto
}

export class FundBusinessSourceAllowedPostingTypeDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string
  @ApiProperty({ type: 'string' }) code!: string
  @ApiProperty({ type: 'string' }) name!: string
  @ApiProperty({ type: 'string', enum: FUND_BUSINESS_CATEGORIES }) businessCategory!: FundBusinessCategory
  @ApiProperty({ type: 'boolean' }) enabled!: boolean
  @ApiProperty({ type: 'string', format: 'date-time' }) allowedAt!: string
}

export class FundBusinessSourceDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string
  @ApiProperty({ type: 'string' }) code!: string
  @ApiProperty({ type: 'string' }) name!: string
  @ApiProperty({ type: 'string', nullable: true }) description!: string | null
  @ApiProperty({ type: 'boolean' }) enabled!: boolean
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number
  @ApiProperty({ type: () => [FundBusinessSourceAllowedPostingTypeDto] }) allowedPostingTypes!: readonly FundBusinessSourceAllowedPostingTypeDto[]
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string
}

export class FundBusinessSourcePageDto {
  @ApiProperty({ type: () => [FundBusinessSourceDto] }) items!: readonly FundBusinessSourceDto[]
  @ApiProperty({ type: 'integer', minimum: 1 }) page!: number
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 }) pageSize!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) total!: number
}

export class FundBusinessSourceMutationResultDto {
  @ApiProperty({ type: 'boolean' }) changed!: boolean
  @ApiProperty({ type: () => FundBusinessSourceDto }) businessSource!: FundBusinessSourceDto
}
