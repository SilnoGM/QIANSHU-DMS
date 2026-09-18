import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateIf } from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class PurchaseOrderWarehouseReceiptRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 1000, uniqueItems: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  partIds!: string[]

  @ApiProperty({ type: 'string', format: 'date-time', required: false, description: '实际入仓时间；省略时使用服务器当前时间，不能早于发货或晚于当前时间。' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u)
  receivedAt?: string

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(0, 500)
  remark?: string | null
}
