import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, ValidateIf } from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class UpdateCurrentUserProfileRequestDto {
  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 254,
    nullable: true,
  })
  @ValidateIf((object: UpdateCurrentUserProfileRequestDto, value: unknown) =>
    value !== null
      && (
        value !== undefined
        || (object.mobileE164 === undefined && object.avatarUrl === undefined)
      ),
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
  @ValidateIf((_object: UpdateCurrentUserProfileRequestDto, value: unknown) =>
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
  @ValidateIf((_object: UpdateCurrentUserProfileRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, 2048)
  avatarUrl?: string | null
}
