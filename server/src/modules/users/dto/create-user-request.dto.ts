import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsString } from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class CreateUserRequestDto {
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  username!: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128 })
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  displayName!: string

  @ApiProperty({
    type: 'string',
    format: 'password',
    minLength: 8,
    maxLength: 20,
    writeOnly: true,
  })
  @IsString()
  @IsUnicodeCodePointLength(8, 20)
  password!: string

  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  mustChangePassword!: boolean
}
