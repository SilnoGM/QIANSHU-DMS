import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, Matches, ValidateIf } from 'class-validator'

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
        || (object.mobileE164 === undefined && object.avatarUrl === undefined && object.issuerPrefix === undefined)
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

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 3,
    nullable: true,
    description: '出单人前缀；最多 3 个汉字',
  })
  @ValidateIf((_object: UpdateCurrentUserProfileRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, 3)
  @Matches(/^\p{Script=Han}{1,3}$/u, { message: '出单人前缀最多 3 个汉字' })
  issuerPrefix?: string | null
}
