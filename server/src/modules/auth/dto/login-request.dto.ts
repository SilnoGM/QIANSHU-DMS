import { ApiProperty } from '@nestjs/swagger'
import { IsString } from 'class-validator'

import { IsUnicodeCodePointLength } from './unicode-code-point-length.validator'

export class LoginRequestDto {
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: 128,
  })
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  username!: string

  @ApiProperty({
    type: 'string',
    format: 'password',
    maxLength: 128,
    writeOnly: true,
  })
  @IsString()
  @IsUnicodeCodePointLength(0, 128)
  password!: string
}
