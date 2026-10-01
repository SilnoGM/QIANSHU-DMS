import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import {
  FUND_ACCOUNT_OWNER_TYPES,
  FUND_ACCOUNT_SORT_FIELDS,
  type FundAccountOwnerType,
  type FundAccountSortField,
  type FundAccountSortOrder,
} from '../application/fund-account.contract'
import { FUND_ADJUSTMENT_MODES, type FundAdjustmentMode } from '../domain'

export const FUND_NON_ZERO_AMOUNT_INPUT_PATTERN =
  '^-?(?:0\\.(?=\\d{1,2}$)\\d*[1-9]\\d*|[1-9]\\d{0,25}(?:\\.\\d{1,2})?)$'
export const FUND_POSITIVE_AMOUNT_INPUT_PATTERN =
  '^(?:0\\.(?=\\d{1,2}$)\\d*[1-9]\\d*|[1-9]\\d{0,25}(?:\\.\\d{1,2})?)$'
export const FUND_SHARE_RATE_INPUT_PATTERN =
  '^(?:100(?:\\.0{1,2})?|(?:0|[1-9]\\d?)(?:\\.\\d{1,2})?)$'
export const FUND_DECIMAL_OUTPUT_PATTERN =
  '^-?(?:0|[1-9]\\d*)\\.\\d{2}$'

export class FundAccountIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: 'accountId 必须是有效的 UUID' })
  accountId!: string
}

export class FundAccountListQueryDto {
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
  @ValidateIf((_object: FundAccountListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: 'search 必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, {
    message: 'search 长度必须为 1 到 128 个字符',
  })
  @Matches(/\S/u, { message: 'search 不能为空白文本' })
  search?: string

  @ApiPropertyOptional({ type: 'string', enum: FUND_ACCOUNT_OWNER_TYPES })
  @ValidateIf((_object: FundAccountListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsIn(FUND_ACCOUNT_OWNER_TYPES, { message: 'ownerType 不在白名单内' })
  ownerType?: FundAccountOwnerType

  @ApiPropertyOptional({
    type: 'string',
    enum: FUND_ACCOUNT_SORT_FIELDS,
    default: 'updatedAt',
  })
  @IsIn(FUND_ACCOUNT_SORT_FIELDS, { message: 'sortBy 不在白名单内' })
  sortBy: FundAccountSortField = 'updatedAt'

  @ApiPropertyOptional({
    type: 'string',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsIn(['asc', 'desc'], { message: 'sortOrder 只允许 asc 或 desc' })
  sortOrder: FundAccountSortOrder = 'desc'
}

export class CreateFundAccountRequestDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: 'userId 必须是有效的 UUID' })
  userId!: string

  @ApiProperty({
    type: 'string',
    pattern: FUND_SHARE_RATE_INPUT_PATTERN,
    example: '30.00',
  })
  @IsString({ message: 'userShareRate 必须是字符串' })
  @Matches(new RegExp(FUND_SHARE_RATE_INPUT_PATTERN, 'u'), {
    message: 'userShareRate 必须是 0 到 100 的两位以内小数',
  })
  userShareRate!: string
}

export class UpdateFundShareRateRequestDto {
  @ApiProperty({
    type: 'string',
    pattern: FUND_SHARE_RATE_INPUT_PATTERN,
    example: '30.00',
  })
  @IsString({ message: 'userShareRate 必须是字符串' })
  @Matches(new RegExp(FUND_SHARE_RATE_INPUT_PATTERN, 'u'), {
    message: 'userShareRate 必须是 0 到 100 的两位以内小数',
  })
  userShareRate!: string

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  @Max(2_147_483_647, { message: 'expectedVersion 超出范围' })
  expectedVersion!: number

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString({ message: 'reason 必须是字符串' })
  @IsUnicodeCodePointLength(1, 500, {
    message: 'reason 长度必须为 1 到 500 个字符',
  })
  @Matches(/\S/u, { message: 'reason 不能为空白文本' })
  reason!: string
}

export class CreateFundManualAdjustmentRequestDto {
  @ApiProperty({
    type: 'string',
    pattern: FUND_NON_ZERO_AMOUNT_INPUT_PATTERN,
    example: '-100.00',
  })
  @IsString({ message: 'amount 必须是字符串' })
  @Matches(new RegExp(FUND_NON_ZERO_AMOUNT_INPUT_PATTERN, 'u'), {
    message: 'amount 必须是非零且最多两位小数的十进制字符串',
  })
  amount!: string

  @ApiProperty({ type: 'string', enum: FUND_ADJUSTMENT_MODES })
  @IsIn(FUND_ADJUSTMENT_MODES, { message: 'adjustmentMode 不在白名单内' })
  adjustmentMode!: FundAdjustmentMode

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString({ message: 'reason 必须是字符串' })
  @IsUnicodeCodePointLength(1, 500, {
    message: 'reason 长度必须为 1 到 500 个字符',
  })
  @Matches(/\S/u, { message: 'reason 不能为空白文本' })
  reason!: string

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      oneOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'null' },
      ],
    },
  })
  @IsOptional()
  @IsObject({ message: 'metadata 必须是对象' })
  metadata?: Readonly<Record<string, string | number | boolean | null>>
}

export class FundAccountUserDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string' })
  username!: string

  @ApiProperty({ type: 'string' })
  displayName!: string

  @ApiProperty({ type: 'string', enum: ['ACTIVE', 'DISABLED'] })
  status!: 'ACTIVE' | 'DISABLED'
}

export class FundAccountDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', enum: FUND_ACCOUNT_OWNER_TYPES })
  ownerType!: FundAccountOwnerType

  @ApiProperty({ type: () => FundAccountUserDto, nullable: true })
  user!: FundAccountUserDto | null

  @ApiProperty({ type: 'string', enum: ['CNY'] })
  currency!: 'CNY'

  @ApiProperty({ type: 'string', pattern: FUND_DECIMAL_OUTPUT_PATTERN })
  balance!: string

  @ApiProperty({
    type: 'string',
    pattern: FUND_DECIMAL_OUTPUT_PATTERN,
    nullable: true,
  })
  userShareRate!: string | null

  @ApiProperty({
    type: 'string',
    pattern: FUND_DECIMAL_OUTPUT_PATTERN,
    nullable: true,
  })
  companyShareRate!: string | null

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  shareRateUpdatedAt!: string | null

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class FundAccountPageDto {
  @ApiProperty({ type: () => [FundAccountDto] })
  items!: readonly FundAccountDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

/** 新建账户下拉的候选归属人；只暴露选择所需的四个字段。 */
export class FundAccountOwnerCandidateListDto {
  @ApiProperty({ type: () => [FundAccountUserDto] })
  items!: readonly FundAccountUserDto[]
}

export class FundAccountMutationResultDto {
  @ApiProperty({ type: 'boolean' })
  changed!: boolean

  @ApiProperty({ type: () => FundAccountDto })
  account!: FundAccountDto
}
