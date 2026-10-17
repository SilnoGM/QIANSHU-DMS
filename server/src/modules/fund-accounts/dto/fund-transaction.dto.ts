import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import {
  FUND_TRANSACTION_REVERSAL_STATUSES,
  FUND_TRANSACTION_SORT_FIELDS,
  type FundPostingBatchKind,
  type FundTransactionReversalStatus,
  type FundTransactionSortField,
} from '../application/fund-transaction.contract'
import {
  FUND_ACCOUNT_TARGETS,
  FUND_ADJUSTMENT_MODES,
  FUND_AMOUNT_STRATEGIES,
  FUND_BUSINESS_CATEGORIES,
  FUND_ENTRY_DIRECTIONS,
  type FundAccountTarget,
  type FundAdjustmentMode,
  type FundAmountStrategy,
  type FundBusinessCategory,
  type FundEntryDirection,
} from '../domain'
import {
  FUND_DECIMAL_OUTPUT_PATTERN,
  FUND_POSITIVE_AMOUNT_INPUT_PATTERN,
  FundAccountUserDto,
} from './fund-account.dto'

export class FundPostingBatchIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: 'batchId 必须是有效的 UUID' })
  batchId!: string
}

export class FundTransactionListQueryDto {
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

  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsUUID(undefined, { message: 'accountId 必须是有效的 UUID' })
  accountId?: string

  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsUUID(undefined, { message: 'userId 必须是有效的 UUID' })
  userId?: string

  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsUUID(undefined, { message: 'postingTypeId 必须是有效的 UUID' })
  postingTypeId?: string

  @ApiPropertyOptional({ type: 'string', enum: FUND_BUSINESS_CATEGORIES })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsIn(FUND_BUSINESS_CATEGORIES, {
    message: 'businessCategory 不在白名单内',
  })
  businessCategory?: FundBusinessCategory

  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsUUID(undefined, { message: 'businessSourceId 必须是有效的 UUID' })
  businessSourceId?: string

  @ApiPropertyOptional({ type: 'string', enum: FUND_ENTRY_DIRECTIONS })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsIn(FUND_ENTRY_DIRECTIONS, { message: 'direction 不在白名单内' })
  direction?: FundEntryDirection

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: 'businessNo 必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, {
    message: 'businessNo 长度必须为 1 到 128 个字符',
  })
  @Matches(/\S/u, { message: 'businessNo 不能为空白文本' })
  businessNo?: string

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsISO8601({ strict: true, strictSeparator: true }, {
    message: 'occurredFrom 必须是 ISO 8601 时间',
  })
  occurredFrom?: string

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsISO8601({ strict: true, strictSeparator: true }, {
    message: 'occurredTo 必须是 ISO 8601 时间',
  })
  occurredTo?: string

  @ApiPropertyOptional({
    type: 'string',
    enum: FUND_TRANSACTION_REVERSAL_STATUSES,
  })
  @ValidateIf((_object: FundTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsIn(FUND_TRANSACTION_REVERSAL_STATUSES, {
    message: 'reversalStatus 不在白名单内',
  })
  reversalStatus?: FundTransactionReversalStatus

  @ApiPropertyOptional({
    type: 'string',
    enum: FUND_TRANSACTION_SORT_FIELDS,
    default: 'postedAt',
  })
  @IsIn(FUND_TRANSACTION_SORT_FIELDS, { message: 'sortBy 不在白名单内' })
  sortBy: FundTransactionSortField = 'postedAt'

  @ApiPropertyOptional({
    type: 'string',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsIn(['asc', 'desc'], { message: 'sortOrder 只允许 asc 或 desc' })
  sortOrder: 'asc' | 'desc' = 'desc'
}

/**
 * 运营本人流水查询：只开放方向、业务发生时间与业务类型三类筛选。
 *
 * accountId 与 userId 由服务端按会话解析；全局 forbidNonWhitelisted
 * 会拒绝客户端额外传入的越权范围字段。
 */
export class FundSelfTransactionListQueryDto {
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

  @ApiPropertyOptional({ type: 'string', enum: FUND_ENTRY_DIRECTIONS })
  @ValidateIf((_object: FundSelfTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsIn(FUND_ENTRY_DIRECTIONS, { message: 'direction 不在白名单内' })
  direction?: FundEntryDirection

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  @ValidateIf((_object: FundSelfTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsISO8601({ strict: true, strictSeparator: true }, {
    message: 'occurredFrom 必须是 ISO 8601 时间',
  })
  occurredFrom?: string

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  @ValidateIf((_object: FundSelfTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsISO8601({ strict: true, strictSeparator: true }, {
    message: 'occurredTo 必须是 ISO 8601 时间',
  })
  occurredTo?: string

  @ApiPropertyOptional({ type: 'string', format: 'uuid' })
  @ValidateIf((_object: FundSelfTransactionListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsUUID(undefined, { message: 'postingTypeId 必须是有效的 UUID' })
  postingTypeId?: string

  @ApiPropertyOptional({
    type: 'string',
    enum: FUND_TRANSACTION_SORT_FIELDS,
    default: 'postedAt',
  })
  @IsIn(FUND_TRANSACTION_SORT_FIELDS, { message: 'sortBy 不在白名单内' })
  sortBy: FundTransactionSortField = 'postedAt'

  @ApiPropertyOptional({
    type: 'string',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsIn(['asc', 'desc'], { message: 'sortOrder 只允许 asc 或 desc' })
  sortOrder: 'asc' | 'desc' = 'desc'
}

export class CreateFundReversalRequestDto {
  @ApiProperty({
    type: 'string',
    pattern: FUND_POSITIVE_AMOUNT_INPUT_PATTERN,
    example: '50.00',
  })
  @IsString({ message: 'amount 必须是字符串' })
  @Matches(new RegExp(FUND_POSITIVE_AMOUNT_INPUT_PATTERN, 'u'), {
    message: 'amount 必须是大于零且最多两位小数的十进制字符串',
  })
  amount!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString({ message: 'reason 必须是字符串' })
  @IsUnicodeCodePointLength(1, 500, {
    message: 'reason 长度必须为 1 到 500 个字符',
  })
  @Matches(/\S/u, { message: 'reason 不能为空白文本' })
  reason!: string
}

export class FundTransactionAccountDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', enum: ['USER', 'COMPANY'] })
  ownerType!: 'USER' | 'COMPANY'

  @ApiProperty({ type: () => FundAccountUserDto, nullable: true })
  user!: FundAccountUserDto | null
}

export class FundTransactionDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  entryId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  batchId!: string

  @ApiProperty({ type: 'string' })
  batchNo!: string

  @ApiProperty({
    type: 'string',
    enum: ['BUSINESS', 'MANUAL_ADJUSTMENT', 'REVERSAL'],
  })
  batchKind!: FundPostingBatchKind

  @ApiProperty({ type: () => FundTransactionAccountDto })
  account!: FundTransactionAccountDto

  @ApiProperty({ type: 'string', enum: FUND_ACCOUNT_TARGETS })
  accountTarget!: FundAccountTarget

  @ApiProperty({ type: 'string', format: 'uuid' })
  postingTypeId!: string

  @ApiProperty({ type: 'string' })
  postingTypeCode!: string

  @ApiProperty({ type: 'string' })
  postingTypeName!: string

  @ApiProperty({ type: 'string', enum: FUND_BUSINESS_CATEGORIES })
  businessCategory!: FundBusinessCategory

  @ApiProperty({ type: 'string', format: 'uuid' })
  businessSourceId!: string

  @ApiProperty({ type: 'string' })
  businessSourceCode!: string

  @ApiProperty({ type: 'string' })
  businessSourceName!: string

  @ApiProperty({ type: 'string', enum: FUND_ENTRY_DIRECTIONS })
  direction!: FundEntryDirection

  @ApiProperty({ type: 'string', enum: FUND_AMOUNT_STRATEGIES })
  amountStrategy!: FundAmountStrategy

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  amount!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  balanceBefore!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  balanceAfter!: string

  @ApiProperty({ type: 'string', pattern: '^[1-9]\\d*$' })
  accountSequence!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  businessAmount!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN, nullable: true })
  userShareRateSnapshot!: string | null

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN, nullable: true })
  companyShareRateSnapshot!: string | null

  @ApiProperty({ type: 'string' })
  businessId!: string

  @ApiProperty({ type: 'string', nullable: true })
  businessNo!: string | null

  @ApiProperty({ type: 'string' })
  summary!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  businessOccurredAt!: string

  @ApiProperty({ type: 'string', enum: FUND_ADJUSTMENT_MODES, nullable: true })
  adjustmentMode!: FundAdjustmentMode | null

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  reversalOfBatchId!: string | null

  @ApiProperty({ type: 'string', enum: FUND_TRANSACTION_REVERSAL_STATUSES })
  reversalStatus!: FundTransactionReversalStatus

  @ApiProperty({ type: 'string', format: 'date-time' })
  postedAt!: string
}

export class FundTransactionPageDto {
  @ApiProperty({ type: () => [FundTransactionDto] })
  items!: readonly FundTransactionDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

/**
 * 运营本人流水视图：来源说明随行返回，公司比例、内部批次/账户标识与
 * 规则金额策略不下发。
 */
export class FundSelfTransactionDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  entryId!: string

  @ApiProperty({ type: 'string' })
  batchNo!: string

  @ApiProperty({
    type: 'string',
    enum: ['BUSINESS', 'MANUAL_ADJUSTMENT', 'REVERSAL'],
  })
  batchKind!: FundPostingBatchKind

  @ApiProperty({ type: 'string', format: 'uuid' })
  postingTypeId!: string

  @ApiProperty({ type: 'string' })
  postingTypeName!: string

  @ApiProperty({ type: 'string', enum: FUND_BUSINESS_CATEGORIES })
  businessCategory!: FundBusinessCategory

  @ApiProperty({ type: 'string' })
  businessSourceName!: string

  @ApiProperty({ type: 'string', enum: FUND_ENTRY_DIRECTIONS })
  direction!: FundEntryDirection

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  amount!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  balanceBefore!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  balanceAfter!: string

  @ApiProperty({ type: 'string', pattern: '^[1-9]\\d*$' })
  accountSequence!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  businessAmount!: string

  @ApiProperty({
    type: 'string',
    pattern: FUND_DECIMAL_OUTPUT_PATTERN,
    nullable: true,
  })
  userShareRateSnapshot!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  businessNo!: string | null

  @ApiProperty({ type: 'string' })
  summary!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  businessOccurredAt!: string

  @ApiProperty({ type: 'string', enum: FUND_TRANSACTION_REVERSAL_STATUSES })
  reversalStatus!: FundTransactionReversalStatus

  @ApiProperty({ type: 'string', format: 'date-time' })
  postedAt!: string
}

export class FundSelfTransactionPageDto {
  @ApiProperty({ type: () => [FundSelfTransactionDto] })
  items!: readonly FundSelfTransactionDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

/** 本人流水出现过的业务类型，供筛选下拉使用。 */
export class FundSelfPostingTypeOptionDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string' })
  name!: string
}

export class FundSelfPostingTypeOptionListDto {
  @ApiProperty({ type: () => [FundSelfPostingTypeOptionDto] })
  items!: readonly FundSelfPostingTypeOptionDto[]
}

export class FundPostingBatchEntryDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  entryId!: string

  @ApiProperty({ type: 'integer', minimum: 1 })
  lineNo!: number

  @ApiProperty({ type: () => FundTransactionAccountDto })
  account!: FundTransactionAccountDto

  @ApiProperty({ type: 'string', enum: FUND_ACCOUNT_TARGETS })
  accountTarget!: FundAccountTarget

  @ApiProperty({ type: 'string', enum: FUND_ENTRY_DIRECTIONS })
  direction!: FundEntryDirection

  @ApiProperty({ type: 'string', enum: FUND_AMOUNT_STRATEGIES })
  amountStrategy!: FundAmountStrategy

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  amount!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  balanceBefore!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  balanceAfter!: string

  @ApiProperty({ type: 'string', pattern: '^[1-9]\\d*$' })
  accountSequence!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  postedAt!: string
}

export class FundPostingBatchReversalDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  batchId!: string

  @ApiProperty({ type: 'string' })
  batchNo!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  amount!: string

  @ApiProperty({ type: 'string' })
  reason!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  actorUserId!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  postedAt!: string
}

export class FundPostingBatchReversalChainDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  originalBatchId!: string

  @ApiProperty({ type: 'string' })
  originalBatchNo!: string

  @ApiProperty({ type: 'string', enum: ['NONE', 'PARTIAL', 'FULL'] })
  status!: 'NONE' | 'PARTIAL' | 'FULL'

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  originalAmount!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  reversedAmount!: string

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  remainingAmount!: string

  @ApiProperty({ type: () => [FundPostingBatchReversalDto] })
  reversals!: readonly FundPostingBatchReversalDto[]
}

export class FundPostingBatchDetailDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) id!: string
  @ApiProperty({ type: 'string' }) batchNo!: string
  @ApiProperty({
    type: 'string',
    enum: ['BUSINESS', 'MANUAL_ADJUSTMENT', 'REVERSAL'],
  }) kind!: FundPostingBatchKind
  @ApiProperty({ type: 'string', format: 'uuid' }) postingTypeId!: string
  @ApiProperty({ type: 'string' }) postingTypeCode!: string
  @ApiProperty({ type: 'string' }) postingTypeName!: string
  @ApiProperty({ type: 'string', enum: FUND_BUSINESS_CATEGORIES }) businessCategory!: FundBusinessCategory
  @ApiProperty({ type: 'string', format: 'uuid' }) businessSourceId!: string
  @ApiProperty({ type: 'string' }) businessSourceCode!: string
  @ApiProperty({ type: 'string' }) businessSourceName!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) ruleVersionId!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) ruleRevision!: number
  @ApiProperty({ type: () => FundAccountUserDto, nullable: true }) user!: FundAccountUserDto | null
  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN }) businessAmount!: string
  @ApiProperty({ type: 'string', enum: ['CNY'] }) currency!: 'CNY'
  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN, nullable: true }) userShareRateSnapshot!: string | null
  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN, nullable: true }) companyShareRateSnapshot!: string | null
  @ApiProperty({ type: 'string' }) businessId!: string
  @ApiProperty({ type: 'string', nullable: true }) businessNo!: string | null
  @ApiProperty({ type: 'string' }) summary!: string
  @ApiProperty({ type: 'object', additionalProperties: true }) metadata!: Readonly<Record<string, string | number | boolean | null>>
  @ApiProperty({ type: 'string', format: 'date-time' }) businessOccurredAt!: string
  @ApiProperty({ type: 'string', enum: FUND_ADJUSTMENT_MODES, nullable: true }) adjustmentMode!: FundAdjustmentMode | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) reversalOfBatchId!: string | null
  @ApiProperty({ type: 'string', nullable: true }) reversalReason!: string | null
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) actorUserId!: string | null
  @ApiProperty({ type: 'string' }) requestId!: string
  @ApiProperty({ type: 'string', nullable: true }) correlationId!: string | null
  @ApiProperty({ type: 'string', format: 'date-time' }) postedAt!: string
  @ApiProperty({ type: () => [FundPostingBatchEntryDto] }) entries!: readonly FundPostingBatchEntryDto[]
  @ApiProperty({ type: () => FundPostingBatchReversalChainDto }) reversalChain!: FundPostingBatchReversalChainDto
}

export class FundPostingResultEntryDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) entryId!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) accountId!: string
  @ApiProperty({ type: 'string', enum: FUND_ACCOUNT_TARGETS }) accountTarget!: FundAccountTarget
  @ApiProperty({ type: 'string', enum: FUND_ENTRY_DIRECTIONS }) direction!: FundEntryDirection
  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN }) amount!: string
  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN }) balanceBefore!: string
  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN }) balanceAfter!: string
  @ApiProperty({ type: 'string', pattern: '^[1-9]\\d*$' }) accountSequence!: string
}

export class FundPostingResultDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) batchId!: string
  @ApiProperty({ type: 'string' }) postingTypeCode!: string
  @ApiProperty({ type: 'string', enum: FUND_BUSINESS_CATEGORIES }) businessCategory!: FundBusinessCategory
  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN }) businessAmount!: string
  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN, nullable: true }) userShareRateSnapshot!: string | null
  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN, nullable: true }) companyShareRateSnapshot!: string | null
  @ApiProperty({ type: () => [FundPostingResultEntryDto] }) entries!: readonly FundPostingResultEntryDto[]
  @ApiProperty({ type: 'string', format: 'date-time' }) postedAt!: string
  @ApiProperty({ type: 'boolean' }) idempotentReplay!: boolean
}
