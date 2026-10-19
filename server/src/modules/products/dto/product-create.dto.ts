import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsDefined,
  IsEnum,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import { ProductStatus } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const DECIMAL_INPUT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u

export class ProductTwdSalePriceInputDto {
  @ApiProperty({
    type: 'string',
    nullable: true,
    pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d+)?$',
  })
  @ValidateIf((_object: ProductTwdSalePriceInputDto, value: unknown) =>
    value !== null,
  )
  @IsString({ message: '必须是十进制字符串或 null' })
  @Matches(DECIMAL_INPUT_PATTERN, { message: '十进制金额格式不合法' })
  amount!: string | null

  @ApiProperty({ type: 'string', enum: ['TWD'] })
  @Equals('TWD', { message: '台币销售价币种必须为 TWD' })
  currency!: 'TWD'
}

export class ProductMyrSalePriceInputDto {
  @ApiProperty({
    type: 'string',
    nullable: true,
    pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d+)?$',
  })
  @ValidateIf((_object: ProductMyrSalePriceInputDto, value: unknown) =>
    value !== null,
  )
  @IsString({ message: '必须是十进制字符串或 null' })
  @Matches(DECIMAL_INPUT_PATTERN, { message: '十进制金额格式不合法' })
  amount!: string | null

  @ApiProperty({ type: 'string', enum: ['MYR'] })
  @Equals('MYR', { message: '马币销售价币种必须为 MYR' })
  currency!: 'MYR'
}

export class ProductPurchaseCostInputDto {
  @ApiProperty({
    type: 'string',
    nullable: true,
    pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d+)?$',
  })
  @ValidateIf((_object: ProductPurchaseCostInputDto, value: unknown) =>
    value !== null,
  )
  @IsString({ message: '必须是十进制字符串或 null' })
  @Matches(DECIMAL_INPUT_PATTERN, { message: '十进制金额格式不合法' })
  amount!: string | null

  @ApiProperty({ type: 'string', pattern: '^[A-Z]{3}$', example: 'CNY' })
  @IsString({ message: '必须是字符串' })
  @Matches(CURRENCY_CODE_PATTERN, { message: '必须是三位大写英文字母' })
  currency!: string
}

export class ProductAttributeInputDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value)
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  title!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 512 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value)
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 512, { message: '长度必须为 1 到 512 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  value!: string
}

/** 创建 DTO 只包含当前 Product 可写字段；媒体字段由全局 whitelist 明确拒绝。 */
export class CreateProductRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value)
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, { message: '长度必须为 1 到 128 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  name!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value)
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  categoryName!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value)
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  productHeadName!: string

  @ApiPropertyOptional({
    type: 'string',
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
  })
  @ValidateIf((_object: CreateProductRequestDto, value: unknown) =>
    value !== undefined)
  @IsEnum(ProductStatus, { message: '产品状态不在白名单内' })
  status?: ProductStatus

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  supplierValue!: string

  @ApiProperty({ type: () => ProductTwdSalePriceInputDto })
  @IsDefined({ message: '不能为空' })
  @ValidateNested()
  @Type(() => ProductTwdSalePriceInputDto)
  twdSalePrice!: ProductTwdSalePriceInputDto

  @ApiProperty({ type: () => ProductMyrSalePriceInputDto })
  @IsDefined({ message: '不能为空' })
  @ValidateNested()
  @Type(() => ProductMyrSalePriceInputDto)
  myrSalePrice!: ProductMyrSalePriceInputDto

  @ApiProperty({ type: () => ProductPurchaseCostInputDto })
  @IsDefined({ message: '不能为空' })
  @ValidateNested()
  @Type(() => ProductPurchaseCostInputDto)
  purchaseCost!: ProductPurchaseCostInputDto

  @ApiProperty({
    type: () => ProductAttributeInputDto,
    isArray: true,
    maxItems: 50,
  })
  @IsArray({ message: '必须是数组' })
  @ArrayMaxSize(50, { message: '不能超过 50 项' })
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeInputDto)
  attributes!: ProductAttributeInputDto[]

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    maxLength: 512,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value)
  @ValidateIf((_object: CreateProductRequestDto, value: unknown) =>
    value !== undefined && value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsUnicodeCodePointLength(1, 512, { message: '长度必须为 1 到 512 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  remark?: string | null
}
