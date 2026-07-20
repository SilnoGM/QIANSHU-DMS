import { ApiProperty } from '@nestjs/swagger'

import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  type AuditActorType as AuditActorTypeValue,
  type AuditEventType as AuditEventTypeValue,
  type AuditOutcome as AuditOutcomeValue,
} from '../../../generated/prisma/enums'

export type AuditMetadataScalar = string | number | boolean | null
export type AuditPublicMetadata = Record<string, AuditMetadataScalar>

export class AuditEventDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ enum: AuditEventType })
  eventType!: AuditEventTypeValue

  @ApiProperty({ enum: AuditOutcome })
  outcome!: AuditOutcomeValue

  @ApiProperty({ type: 'string', format: 'date-time' })
  occurredAt!: string

  @ApiProperty({ enum: AuditActorType })
  actorType!: AuditActorTypeValue

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  actorUserId!: string | null

  @ApiProperty({ type: 'string', maxLength: 128, nullable: true })
  actorDisplayName!: string | null

  @ApiProperty({ type: 'string', maxLength: 128, nullable: true })
  targetType!: string | null

  @ApiProperty({ type: 'string', maxLength: 128, nullable: true })
  targetId!: string | null

  @ApiProperty({ type: 'string', maxLength: 64 })
  requestId!: string

  @ApiProperty({ type: 'string', maxLength: 128, nullable: true })
  correlationId!: string | null

  @ApiProperty({ type: 'string', maxLength: 128, nullable: true })
  reasonCode!: string | null

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      oneOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
      ],
      nullable: true,
    },
  })
  metadata!: AuditPublicMetadata
}

export class AuditEventPageDto {
  @ApiProperty({ type: [AuditEventDto] })
  items!: AuditEventDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}
