import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import { ProductStatus } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import {
  ProductAttributeInputDto,
  ProductMyrSalePriceInputDto,
  ProductPurchaseCostInputDto,
  ProductTwdSalePriceInputDto,
} from './product-create.dto'

const MAX_INT32 = 2_147_483_647

export class ProductIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4', { message: 'productId 必须是 UUID v4' })
  productId!: string
}

/**
 * 产品编辑只暴露本阶段获准修改的业务字段。媒体、编号、审计字段和 version
 * 不在 DTO 中，因此会被全局 whitelist 直接拒绝，防止调用方越过业务边界。
 */
export class UpdateProductRequestDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value)
  @ValidateIf((object: UpdateProductRequestDto, value: unknown) =>
    value !== undefined
    || (
      object.status === undefined
      && object.supplierValue === undefined
      && object.twdSalePrice === undefined
      && object.myrSalePrice === undefined
      && object.purchaseCost === undefined
      && object.attributes === undefined
    ),
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, { message: '长度必须为 1 到 128 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  name?: string

  @ApiPropertyOptional({ type: 'string', enum: ProductStatus })
  @ValidateIf((_object: UpdateProductRequestDto, value: unknown) =>
    value !== undefined)
  @IsEnum(ProductStatus, { message: '产品状态不在白名单内' })
  status?: ProductStatus

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    minLength: 1,
    maxLength: 64,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_object: UpdateProductRequestDto, value: unknown) =>
    value !== undefined && value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  supplierValue?: string | null

  @ApiPropertyOptional({ type: () => ProductTwdSalePriceInputDto })
  @ValidateIf((_object: UpdateProductRequestDto, value: unknown) =>
    value !== undefined)
  @ValidateNested()
  @Type(() => ProductTwdSalePriceInputDto)
  twdSalePrice?: ProductTwdSalePriceInputDto

  @ApiPropertyOptional({ type: () => ProductMyrSalePriceInputDto })
  @ValidateIf((_object: UpdateProductRequestDto, value: unknown) =>
    value !== undefined)
  @ValidateNested()
  @Type(() => ProductMyrSalePriceInputDto)
  myrSalePrice?: ProductMyrSalePriceInputDto

  @ApiPropertyOptional({ type: () => ProductPurchaseCostInputDto })
  @ValidateIf((_object: UpdateProductRequestDto, value: unknown) =>
    value !== undefined)
  @ValidateNested()
  @Type(() => ProductPurchaseCostInputDto)
  purchaseCost?: ProductPurchaseCostInputDto

  @ApiPropertyOptional({
    type: () => ProductAttributeInputDto,
    isArray: true,
    maxItems: 50,
  })
  @ValidateIf((_object: UpdateProductRequestDto, value: unknown) =>
    value !== undefined)
  @IsArray({ message: '必须是数组' })
  @ArrayMaxSize(50, { message: '不能超过 50 项' })
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeInputDto)
  attributes?: ProductAttributeInputDto[]

  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_INT32 })
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  expectedVersion!: number
}
