import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, ValidateIf } from 'class-validator'

import { IsUnicodeCodePointLength } from './unicode-code-point-length.validator'

export class ChangePasswordRequestDto {
  @ApiPropertyOptional({
    type: 'string',
    format: 'password',
    maxLength: 128,
    writeOnly: true,
  })
  // `@IsOptional` 会同时放过 null；这里只把真正缺失的 undefined 视为可选。
  @ValidateIf((_object: ChangePasswordRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsString()
  @IsUnicodeCodePointLength(0, 128)
  currentPassword?: string

  @ApiProperty({
    type: 'string',
    format: 'password',
    minLength: 15,
    maxLength: 128,
    writeOnly: true,
  })
  @IsString()
  @IsUnicodeCodePointLength(0, 128)
  newPassword!: string
}
