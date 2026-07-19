import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsString, Max, Min, ValidateIf } from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class UserListQueryDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((_object: UserListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  username?: string
}
