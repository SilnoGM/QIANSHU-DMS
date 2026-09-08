import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsString, IsUUID, Matches, Max, Min, ValidateIf } from 'class-validator'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'

export const SHIPPING_MARK_AVAILABILITIES = ['AVAILABLE', 'UNBOUND', 'SUPPLIER_UNAVAILABLE', 'RULE_MISSING', 'WRONG_PURPOSE', 'RULE_DISABLED', 'NO_ACTIVE_VERSION'] as const
export type ShippingMarkAvailability = typeof SHIPPING_MARK_AVAILABILITIES[number]

export class ShippingMarkOptionsQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 1, minimum: 1, maximum: 1_000_000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1

  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  @Matches(/\S/u)
  keyword?: string
}

export class ShippingMarkBindingQueryDto extends ShippingMarkOptionsQueryDto {
  @ApiPropertyOptional({ type: 'string', enum: ['BOUND', 'UNBOUND'] })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['BOUND', 'UNBOUND'])
  bindingStatus?: 'BOUND' | 'UNBOUND'
}

export class ShippingMarkSupplierParamDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u)
  supplierValue!: string
}

export class SaveShippingMarkBindingDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID()
  ruleId!: string

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2_147_483_646, description: '首次设置为 0，改绑传当前版本；不接受隐式覆盖。' })
  @IsInt()
  @Min(0)
  @Max(2_147_483_646)
  expectedVersion!: number
}

export class ShippingMarkRuleSummaryDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string' })
  ruleCode!: string

  @ApiProperty({ type: 'string' })
  name!: string

  @ApiProperty({ type: 'string', enum: ['BUSINESS', 'SHIPPING_MARK'] })
  purpose!: 'BUSINESS' | 'SHIPPING_MARK'

  @ApiProperty({ type: 'string', enum: ['DRAFT', 'ENABLED', 'DISABLED'] })
  status!: 'DRAFT' | 'ENABLED' | 'DISABLED'

  @ApiProperty({ type: 'integer', nullable: true })
  activeRevision!: number | null
}

export class ShippingMarkRuleResolutionDto {
  @ApiProperty({ type: () => ShippingMarkRuleSummaryDto, nullable: true })
  rule!: ShippingMarkRuleSummaryDto | null

  @ApiProperty({ type: 'string', enum: SHIPPING_MARK_AVAILABILITIES })
  availability!: ShippingMarkAvailability
}

export class ShippingMarkBindingDto extends ShippingMarkRuleResolutionDto {
  @ApiProperty({ type: 'string' })
  supplierValue!: string

  @ApiProperty({ type: 'string' })
  supplierLabel!: string

  @ApiProperty({ type: 'boolean' })
  supplierEnabled!: boolean

  @ApiProperty({ type: 'integer', minimum: 0, description: '未绑定时为 0。' })
  version!: number

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  updatedAt!: string | null
}

export class ShippingMarkOptionsPageDto {
  @ApiProperty({ type: () => ShippingMarkRuleSummaryDto, isArray: true })
  items!: ShippingMarkRuleSummaryDto[]

  @ApiProperty({ type: 'integer' })
  page!: number

  @ApiProperty({ type: 'integer' })
  pageSize!: number

  @ApiProperty({ type: 'integer' })
  total!: number
}

export class ShippingMarkBindingPageDto {
  @ApiProperty({ type: () => ShippingMarkBindingDto, isArray: true })
  items!: ShippingMarkBindingDto[]

  @ApiProperty({ type: 'integer' })
  page!: number

  @ApiProperty({ type: 'integer' })
  pageSize!: number

  @ApiProperty({ type: 'integer' })
  total!: number

  @ApiProperty({ type: () => ShippingMarkRuleResolutionDto, description: '固定 CUSTOM_MARK；不受供应商搜索或分页影响。' })
  customRule!: ShippingMarkRuleResolutionDto
}
