import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

import {
  AuditEventType,
  type AuditEventType as AuditEventTypeValue,
  AuditOutcome,
  type AuditOutcome as AuditOutcomeValue,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export const AUDIT_PAGE_SIZE_MAXIMUM = 100
export const AUDIT_REQUEST_ID_MAXIMUM_LENGTH = 64

export class AuditEventListQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    default: 1,
  })
  @Type(() => Number)
  @ValidateIf((_object: AuditEventListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: AUDIT_PAGE_SIZE_MAXIMUM,
    default: 20,
  })
  @Type(() => Number)
  @ValidateIf((_object: AuditEventListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsInt()
  @Min(1)
  @Max(AUDIT_PAGE_SIZE_MAXIMUM)
  pageSize?: number

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: AUDIT_REQUEST_ID_MAXIMUM_LENGTH,
  })
  @ValidateIf((_object: AuditEventListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString()
  @IsUnicodeCodePointLength(1, AUDIT_REQUEST_ID_MAXIMUM_LENGTH)
  requestId?: string

  @ApiPropertyOptional({
    type: 'string',
    enum: Object.values(AuditEventType),
  })
  @ValidateIf((_object: AuditEventListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(AuditEventType)
  eventType?: AuditEventTypeValue

  @ApiPropertyOptional({
    type: 'string',
    enum: [AuditOutcome.SUCCESS, AuditOutcome.FAILURE],
  })
  @ValidateIf((_object: AuditEventListQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsEnum(AuditOutcome)
  outcome?: AuditOutcomeValue
}
