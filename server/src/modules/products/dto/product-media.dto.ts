import { ApiProperty } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator'

import { ProductMediaKind } from '../../../generated/prisma/enums'
import {
  ProductListItemDto,
  ProductMediaItemDto,
} from './product-response.dto'

const EXPECTED_VERSION_PATTERN = '^[1-9]\\d*$'

export class ProductMediaIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4', { message: 'productId 必须是 UUID v4' })
  readonly productId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4', { message: 'productMediaId 必须是 UUID v4' })
  readonly productMediaId!: string
}

/**
 * multipart 的 file 只用于 OpenAPI；运行时由流式 parser 提供 Readable。
 * 两个小字段必须先于 file part 发送，使 Server 无需缓存整个大文件。
 */
export class ProductMediaUploadRequestDto {
  @ApiProperty({
    enum: [ProductMediaKind.IMAGE, ProductMediaKind.VIDEO],
    description: '必须在 file part 之前发送',
  })
  @IsEnum({
    IMAGE: ProductMediaKind.IMAGE,
    VIDEO: ProductMediaKind.VIDEO,
  }, { message: 'kind 只允许 IMAGE 或 VIDEO' })
  readonly kind!: ProductMediaKind

  @ApiProperty({
    type: 'string',
    pattern: EXPECTED_VERSION_PATTERN,
    description: '必须在 file part 之前发送',
  })
  @Matches(new RegExp(EXPECTED_VERSION_PATTERN, 'u'), {
    message: 'expectedVersion 必须是正整数字符串',
  })
  readonly expectedVersion!: string

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: '必须在 kind 和 expectedVersion part 之后发送',
  })
  @IsString({ message: 'file 必须是文件' })
  readonly file!: string
}

export class ProductMediaLayoutRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  readonly expectedVersion!: number

  @ApiProperty({ type: [String], format: 'uuid', maxItems: 20 })
  @IsArray({ message: 'imageIds 必须是数组' })
  @ArrayMaxSize(20, { message: 'imageIds 不能超过 20 项' })
  @ArrayUnique({ message: 'imageIds 不能重复' })
  @IsUUID('4', { each: true, message: 'imageIds 必须是 UUID v4' })
  readonly imageIds!: readonly string[]

  @ApiProperty({ type: [String], format: 'uuid', maxItems: 5 })
  @IsArray({ message: 'videoIds 必须是数组' })
  @ArrayMaxSize(5, { message: 'videoIds 不能超过 5 项' })
  @ArrayUnique({ message: 'videoIds 不能重复' })
  @IsUUID('4', { each: true, message: 'videoIds 必须是 UUID v4' })
  readonly videoIds!: readonly string[]

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID('4', { message: 'primaryImageId 必须是 UUID v4 或 null' })
  readonly primaryImageId!: string | null
}

export class ProductMediaDetachRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt({ message: 'expectedVersion 必须是整数' })
  @Min(1, { message: 'expectedVersion 不能小于 1' })
  readonly expectedVersion!: number
}

export class ProductMediaUploadResponseDto {
  @ApiProperty({ type: () => ProductListItemDto })
  readonly product!: ProductListItemDto

  @ApiProperty({ type: () => ProductMediaItemDto })
  readonly media!: ProductMediaItemDto
}
