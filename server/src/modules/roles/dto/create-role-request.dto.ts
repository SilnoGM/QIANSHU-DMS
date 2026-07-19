import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, Matches, ValidateIf } from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

/** 普通角色使用小写 snake_case 技术标识，与内置 system_admin 规则一致。 */
export const ROLE_CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u
export const ROLE_DESCRIPTION_MAX_CODE_POINTS = 2_000

export class CreateRoleRequestDto {
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: 128,
    pattern: ROLE_CODE_PATTERN.source,
  })
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  @Matches(ROLE_CODE_PATTERN)
  code!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  @Matches(/\S/u)
  name!: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: ROLE_DESCRIPTION_MAX_CODE_POINTS,
  })
  @ValidateIf((_object: CreateRoleRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, ROLE_DESCRIPTION_MAX_CODE_POINTS)
  @Matches(/\S/u)
  description?: string
}
