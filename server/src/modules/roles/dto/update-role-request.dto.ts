import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { ROLE_DESCRIPTION_MAX_CODE_POINTS } from './create-role-request.dto'

export class UpdateRoleRequestDto {
  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 128 })
  @ValidateIf((object: UpdateRoleRequestDto, value: unknown) =>
    value !== undefined || object.description === undefined,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  @Matches(/\S/u)
  name?: string

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: ROLE_DESCRIPTION_MAX_CODE_POINTS,
    nullable: true,
  })
  @ValidateIf((_object: UpdateRoleRequestDto, value: unknown) =>
    value !== undefined && value !== null,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, ROLE_DESCRIPTION_MAX_CODE_POINTS)
  @Matches(/\S/u)
  description?: string | null

}
