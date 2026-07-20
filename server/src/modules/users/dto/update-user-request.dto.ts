import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, ValidateIf } from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class UpdateUserRequestDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((object: UpdateUserRequestDto, value: unknown) =>
    value !== undefined
      || (
        object.email === undefined
        && object.mobileE164 === undefined
        && object.avatarUrl === undefined
        && object.remark === undefined
      ),
  )
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  displayName?: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 254,
    nullable: true,
  })
  @ValidateIf((_object: UpdateUserRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, 254)
  email?: string | null

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 16,
    nullable: true,
  })
  @ValidateIf((_object: UpdateUserRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, 16)
  mobileE164?: string | null

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 2048,
    nullable: true,
  })
  @ValidateIf((_object: UpdateUserRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, 2048)
  avatarUrl?: string | null

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 2000,
    nullable: true,
  })
  @ValidateIf((_object: UpdateUserRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, 2000)
  remark?: string | null
}
