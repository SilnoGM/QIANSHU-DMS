import { Type } from 'class-transformer'
import { IsInt, Max, Min, ValidateIf } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export const AUDIT_PAGE_SIZE_MAXIMUM = 100

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
}
