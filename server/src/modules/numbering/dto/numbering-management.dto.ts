import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export const NumberingRuleStatus = {
  DRAFT: 'DRAFT',
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
} as const

export type NumberingRuleStatus =
  (typeof NumberingRuleStatus)[keyof typeof NumberingRuleStatus]

export const NumberingRuleSortBy = {
  UPDATED_AT: 'updatedAt',
} as const

export type NumberingRuleSortBy =
  (typeof NumberingRuleSortBy)[keyof typeof NumberingRuleSortBy]

export const NumberingRuleSortOrder = {
  ASC: 'asc',
  DESC: 'desc',
} as const

export type NumberingRuleSortOrder =
  (typeof NumberingRuleSortOrder)[keyof typeof NumberingRuleSortOrder]

export const NumberingGeneratedNumberMatch = {
  EXACT: 'EXACT',
  PREFIX: 'PREFIX',
} as const

export type NumberingGeneratedNumberMatch =
  (typeof NumberingGeneratedNumberMatch)[
    keyof typeof NumberingGeneratedNumberMatch
  ]

export class NumberingRuleIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: 'ruleId 必须是有效的 UUID' })
  ruleId!: string
}

export class NumberingPaginationQueryDto {
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
}

export class NumberingRuleListQueryDto extends NumberingPaginationQueryDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((_object: NumberingRuleListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: 'keyword 必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, {
    message: 'keyword 长度必须为 1 到 128 个字符',
  })
  @Matches(/\S/u, { message: 'keyword 不能为空白文本' })
  keyword?: string

  @ApiPropertyOptional({ type: 'string', enum: NumberingRuleStatus })
  @ValidateIf((_object: NumberingRuleListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsIn(Object.values(NumberingRuleStatus), {
    message: 'status 不在白名单内',
  })
  status?: NumberingRuleStatus

  @ApiPropertyOptional({
    type: 'string',
    enum: NumberingRuleSortBy,
    default: NumberingRuleSortBy.UPDATED_AT,
  })
  @IsIn(Object.values(NumberingRuleSortBy), {
    message: 'sortBy 只允许 updatedAt',
  })
  sortBy: NumberingRuleSortBy = NumberingRuleSortBy.UPDATED_AT

  @ApiPropertyOptional({
    type: 'string',
    enum: NumberingRuleSortOrder,
    default: NumberingRuleSortOrder.DESC,
  })
  @IsIn(Object.values(NumberingRuleSortOrder), {
    message: 'sortOrder 只允许 asc 或 desc',
  })
  sortOrder: NumberingRuleSortOrder = NumberingRuleSortOrder.DESC
}

export class NumberingRuleVersionListQueryDto
  extends NumberingPaginationQueryDto {}

export class NumberingIssuanceListQueryDto
  extends NumberingPaginationQueryDto {
  @ApiPropertyOptional({
    type: 'string',
    pattern: '^(?:ALL|\\d{4}|\\d{6}|\\d{8})$',
  })
  @ValidateIf((_object: NumberingIssuanceListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @Matches(/^(?:ALL|\d{4}|\d{6}|\d{8})$/u, {
    message: 'periodKey 格式不合法',
  })
  periodKey?: string

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 64 })
  @ValidateIf((_object: NumberingIssuanceListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @Matches(/^[A-Z][A-Z0-9._-]{0,63}$/u, {
    message: 'consumerCode 格式不合法',
  })
  consumerCode?: string

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 64 })
  @ValidateIf((object: NumberingIssuanceListQueryDto, value: unknown) =>
    value !== undefined || object.generatedNumberMatch !== undefined,
  )
  @IsString({ message: 'generatedNumber 必须是字符串' })
  @Matches(/^[A-Z0-9._/-]{1,64}$/u, {
    message: 'generatedNumber 格式不合法',
  })
  generatedNumber?: string

  @ApiPropertyOptional({
    type: 'string',
    enum: NumberingGeneratedNumberMatch,
    description: '省略时由查询服务按 EXACT 处理',
  })
  @ValidateIf((_object: NumberingIssuanceListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsIn(Object.values(NumberingGeneratedNumberMatch), {
    message: 'generatedNumberMatch 只允许 EXACT 或 PREFIX',
  })
  generatedNumberMatch?: NumberingGeneratedNumberMatch
}
