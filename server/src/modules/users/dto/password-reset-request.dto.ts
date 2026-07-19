import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsString } from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class PasswordResetRequestDto {
  @ApiProperty({
    type: 'string',
    format: 'password',
    minLength: 8,
    maxLength: 20,
    writeOnly: true,
  })
  @IsString()
  @IsUnicodeCodePointLength(8, 20)
  newPassword!: string

  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  mustChangePassword!: boolean
}
