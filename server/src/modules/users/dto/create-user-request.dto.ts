import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { FUND_SHARE_RATE_INPUT_PATTERN } from '../../fund-accounts/dto/fund-account.dto'

/**
 * 新建用户时可选开通的资金账户。
 *
 * 比例格式必须与资金域开户接口保持一致：0–100、最多两位小数的字符串，
 * 不接受 number 或 0–1 小数比例；服务端会再次规范化后写入 NUMERIC(7,2)。
 */
export class CreateUserFundAccountRequestDto {
  @ApiProperty({
    type: 'string',
    pattern: FUND_SHARE_RATE_INPUT_PATTERN,
    example: '30.00',
    description: '用户分成比例；公司比例自动取剩余部分。',
  })
  @IsString({ message: 'userShareRate 必须是字符串' })
  @Matches(new RegExp(FUND_SHARE_RATE_INPUT_PATTERN, 'u'), {
    message: 'userShareRate 必须是 0 到 100 的两位以内小数',
  })
  userShareRate!: string
}

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

  @ApiPropertyOptional({ type: () => CreateUserFundAccountRequestDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateUserFundAccountRequestDto)
  fundAccount?: CreateUserFundAccountRequestDto
}
