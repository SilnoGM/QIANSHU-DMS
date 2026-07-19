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
    minLength: 8,
    maxLength: 20,
    writeOnly: true,
  })
  @IsString()
  // 短输入交给认证服务统一映射为 INVALID_CREDENTIALS；这里只在 Argon2 前拦截超长输入。
  @IsUnicodeCodePointLength(0, 20)
  password!: string
}
