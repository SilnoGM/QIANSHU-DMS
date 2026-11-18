import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'

const PRODUCT_IDS_PATTERN = /^[0-9a-fA-F-]+(?:,[0-9a-fA-F-]+)*$/u
const ALIAS_ALLOWED_PATTERN = /^[^\p{Cc}×]+$/u

export class ProductAliasProductParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  productId!: string
}

export class ProductAliasListQueryDto {
  @ApiPropertyOptional({
    type: 'string',
    description: '逗号分隔的产品 UUID，最多 100 个；省略时返回本人全部别名',
  })
  @IsOptional()
  @IsString()
  @Matches(PRODUCT_IDS_PATTERN)
  @Transform(({ value }: { value: unknown }) => (
    typeof value === 'string' && value.trim() === '' ? undefined : value
  ))
  productIds?: string
}

export class UpsertProductAliasDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 36 })
  @IsString()
  @IsUnicodeCodePointLength(1, 36)
  @Matches(ALIAS_ALLOWED_PATTERN)
  alias!: string
}

export class ProductAliasDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly productId!: string

  @ApiProperty({ type: 'string' })
  readonly alias!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  readonly updatedAt!: string
}

export class ProductAliasListDto {
  @ApiProperty({ type: () => [ProductAliasDto] })
  readonly items!: readonly ProductAliasDto[]
}
