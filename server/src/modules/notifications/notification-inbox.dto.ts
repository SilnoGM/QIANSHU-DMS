import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'

import { NOTIFICATION_DOMAINS, type NotificationDomain } from './notification.types'

const STATUSES = ['all', 'unread', 'archived'] as const

export class NotificationInboxQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, default: 'all' })
  @IsOptional()
  @IsIn(STATUSES)
  status: (typeof STATUSES)[number] = 'all'

  @ApiPropertyOptional({ enum: NOTIFICATION_DOMAINS })
  @IsOptional()
  @IsIn(NOTIFICATION_DOMAINS)
  domain?: NotificationDomain

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20
}

export class NotificationInboxNewQueryDto {
  @ApiPropertyOptional({ type: 'string' })
  @IsOptional()
  @IsString()
  cursor?: string

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20
}

export class NotificationInboxReadAllDto {
  @ApiPropertyOptional({ enum: NOTIFICATION_DOMAINS })
  @IsOptional()
  @IsIn(NOTIFICATION_DOMAINS)
  domain?: NotificationDomain
}

export class NotificationInboxItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() eventType!: string
  @ApiProperty({ type: 'string', nullable: true }) domain!: string | null
  @ApiProperty() title!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readAt!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) archivedAt!: string | null
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string
}

export class NotificationInboxDetailDto extends NotificationInboxItemDto {
  @ApiProperty() body!: string
  @ApiProperty({ type: 'string', nullable: true }) linkUrl!: string | null
}

export class NotificationInboxPageDto {
  @ApiProperty({ type: () => [NotificationInboxItemDto] }) items!: NotificationInboxItemDto[]
  @ApiProperty({ type: 'integer' }) page!: number
  @ApiProperty({ type: 'integer' }) pageSize!: number
  @ApiProperty({ type: 'integer' }) total!: number
}

export class NotificationInboxUnreadCountDto {
  @ApiProperty({ type: 'integer' }) total!: number
}

export class NotificationInboxNewItemDto extends NotificationInboxDetailDto {}

export class NotificationInboxNewDto {
  @ApiProperty({ type: () => [NotificationInboxNewItemDto] }) items!: NotificationInboxNewItemDto[]
  @ApiProperty({ type: 'integer' }) unreadTotal!: number
  @ApiProperty() nextCursor!: string
  @ApiProperty() hasMore!: boolean
  @ApiProperty({ type: 'string', format: 'date-time' }) serverTime!: string
}

export class NotificationInboxReadAllResultDto {
  @ApiProperty({ type: 'integer' }) updated!: number
  @ApiProperty({ type: 'integer' }) unreadTotal!: number
}

export class NotificationInboxIdParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string
}
