import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsInt,
  IsEnum,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { ProductStatus } from '../../../generated/prisma/enums'

export class ProductListQueryDto {
  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 128,
    description: '产品名称或产品编号，不区分大小写的包含匹配',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_object: ProductListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 128, { message: '长度必须为 1 到 128 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  keyword?: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 64,
    description: '精确供应商字典 raw value，不执行 trim 或大小写转换',
  })
  @ValidateIf((_object: ProductListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(1, 64, { message: '长度必须为 1 到 64 个字符' })
  @Matches(/\S/u, { message: '不能为空白文本' })
  supplierValue?: string

  @ApiPropertyOptional({
    type: 'string',
    enum: ProductStatus,
    description: '产品状态精确匹配',
  })
  @ValidateIf((_object: ProductListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(ProductStatus, { message: '产品状态不在白名单内' })
  status?: ProductStatus

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    default: 1,
  })
  @Type(() => Number)
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  page = 1

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @Type(() => Number)
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  @Max(100, { message: '不能超过 100' })
  pageSize = 20
}
