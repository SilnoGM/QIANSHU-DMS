import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator'

import type { NotificationDomain } from './notification.types'

export const NOTIFICATION_PREFERENCE_CHANNELS = ['IN_APP', 'ASSISTANT'] as const

export type NotificationPreferenceChannel = (typeof NOTIFICATION_PREFERENCE_CHANNELS)[number]

export type NotificationPreferenceUnavailableReason =
  | 'NOT_CONFIGURED'
  | 'POLICY_DISABLED'
  | 'CHANNEL_DISABLED'
  | 'GROUP_TARGET'
  | 'TEMPLATE_MISSING'

export class NotificationPreferenceParamDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  eventType!: string

  @ApiProperty({ enum: NOTIFICATION_PREFERENCE_CHANNELS })
  @IsIn(NOTIFICATION_PREFERENCE_CHANNELS)
  channel!: NotificationPreferenceChannel
}

export class NotificationPreferenceUpdateDto {
  @ApiProperty()
  @IsBoolean()
  muted!: boolean
}

export class NotificationPreferenceChannelDto {
  @ApiProperty({ enum: NOTIFICATION_PREFERENCE_CHANNELS }) channel!: NotificationPreferenceChannel
  @ApiProperty() available!: boolean
  @ApiProperty() muted!: boolean
  @ApiProperty({ type: 'string', nullable: true })
  unavailableReason!: NotificationPreferenceUnavailableReason | null
}

export class NotificationPreferenceEventDto {
  @ApiProperty() eventType!: string
  @ApiProperty() label!: string
  @ApiProperty({ enum: ['sales', 'purchase', 'shipment', 'finance', 'invoice', 'reconciliation', 'operations', 'system'] })
  domain!: NotificationDomain
  @ApiProperty({ type: () => [NotificationPreferenceChannelDto] })
  channels!: NotificationPreferenceChannelDto[]
}

export class NotificationPreferenceListDto {
  @ApiProperty({ type: () => [NotificationPreferenceEventDto] })
  events!: NotificationPreferenceEventDto[]
}

export class NotificationPreferenceUpdateResultDto {
  @ApiProperty() eventType!: string
  @ApiProperty({ enum: NOTIFICATION_PREFERENCE_CHANNELS }) channel!: NotificationPreferenceChannel
  @ApiProperty() muted!: boolean
}
