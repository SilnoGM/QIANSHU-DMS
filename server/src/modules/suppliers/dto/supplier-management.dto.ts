import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator'

import {
  SupplierEntityType,
  type SupplierEntityType as SupplierEntityTypeValue,
} from '../../../generated/prisma/enums'
import { isNormalizableSupplierSearchQuery } from '../supplier.normalizer'

export const SupplierStatusFilter = {
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
} as const

export type SupplierStatusFilter =
  (typeof SupplierStatusFilter)[keyof typeof SupplierStatusFilter]

export const SupplierSortBy = {
  CODE: 'code',
  LEGAL_NAME: 'legalName',
  UPDATED_AT: 'updatedAt',
} as const

export type SupplierSortBy =
  (typeof SupplierSortBy)[keyof typeof SupplierSortBy]

export const SupplierSortOrder = {
  ASC: 'asc',
  DESC: 'desc',
} as const

export type SupplierSortOrder =
  (typeof SupplierSortOrder)[keyof typeof SupplierSortOrder]

function IsNormalizableSupplierQuery(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalizableSupplierQuery',
    validator: {
      validate: isNormalizableSupplierSearchQuery,
      defaultMessage: () => '规范化后长度必须为 1 到 200 个字符',
    },
  })
}

export class SupplierIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  supplierId!: string
}

export class SupplierListQueryDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 200 })
  @ValidateIf((_object: SupplierListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsNormalizableSupplierQuery()
  query?: string

  @ApiPropertyOptional({ type: 'string', enum: SupplierStatusFilter })
  @ValidateIf((_object: SupplierListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(SupplierStatusFilter, { message: '必须是有效的供应商状态' })
  status?: SupplierStatusFilter

  @ApiPropertyOptional({ type: 'string', enum: SupplierEntityType })
  @ValidateIf((_object: SupplierListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(SupplierEntityType, { message: '必须是有效的供应商主体类型' })
  entityType?: SupplierEntityTypeValue

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
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

  @ApiPropertyOptional({ type: 'string', enum: SupplierSortBy })
  @ValidateIf((_object: SupplierListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(SupplierSortBy, { message: '必须是有效的排序字段' })
  sortBy?: SupplierSortBy

  @ApiPropertyOptional({ type: 'string', enum: SupplierSortOrder })
  @ValidateIf((_object: SupplierListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(SupplierSortOrder, { message: '必须是有效的排序方向' })
  sortOrder?: SupplierSortOrder
}
