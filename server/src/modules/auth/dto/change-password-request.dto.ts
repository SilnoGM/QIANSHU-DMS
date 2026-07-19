import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, ValidateIf } from 'class-validator'

import { IsUnicodeCodePointLength } from './unicode-code-point-length.validator'

export class ChangePasswordRequestDto {
  @ApiPropertyOptional({
    type: 'string',
    format: 'password',
    minLength: 8,
    maxLength: 20,
    writeOnly: true,
  })
  // `@IsOptional` 会同时放过 null；这里只把真正缺失的 undefined 视为可选。
  @ValidateIf((_object: ChangePasswordRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsString()
  // 短输入交给业务层保持 CURRENT_PASSWORD_INVALID，DTO 只拦截超长输入。
  @IsUnicodeCodePointLength(0, 20)
  currentPassword?: string

  @ApiProperty({
    type: 'string',
    format: 'password',
    minLength: 8,
    maxLength: 20,
    writeOnly: true,
  })
  @IsString()
  // 最小长度由 PasswordPolicyProvider 统一映射为 PASSWORD_POLICY_VIOLATION。
  @IsUnicodeCodePointLength(0, 20)
  newPassword!: string
}
