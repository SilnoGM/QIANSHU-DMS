import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import { NOTIFICATION_MESSAGE_KINDS, NOTIFICATION_SEND_METHODS } from './notification-content'

const TEMPLATE_DOMAINS = ['SALES', 'PURCHASE', 'SHIPMENT', 'FINANCE', 'INVOICE', 'RECONCILIATION', 'OPERATIONS', 'SYSTEM'] as const
const NOTIFICATION_TARGET_MODES = ['COMMAND_TARGET', 'USERS', 'ROLE', 'PERMISSION', 'GROUP'] as const

export const NOTIFICATION_CHANNEL_VALUES = ['IN_APP', 'WECOM'] as const
export type NotificationChannelValue = (typeof NOTIFICATION_CHANNEL_VALUES)[number]

export class NotificationEventVariableDto {
  @ApiProperty() name!: string
  @ApiProperty() label!: string
  @ApiProperty() description!: string
  @ApiProperty() example!: string
  @ApiProperty() sensitive!: boolean
  @ApiProperty({ type: 'integer' }) maxLength!: number
  @ApiProperty() required!: boolean
}

export class NotificationEventMediaSourceDto {
  @ApiProperty() key!: string
  @ApiProperty() label!: string
}

export class NotificationEventMediaDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 3 }) maxCount!: number
  @ApiProperty({ enum: ['IMAGE'], isArray: true }) kinds!: string[]
  @ApiProperty({ type: () => [NotificationEventMediaSourceDto] }) sources!: NotificationEventMediaSourceDto[]
}

export class NotificationEventDto {
  @ApiProperty() eventType!: string
  @ApiProperty() label!: string
  @ApiProperty({ enum: TEMPLATE_DOMAINS }) domain!: string
  @ApiProperty({ type: [String] }) variables!: string[]
  @ApiProperty({ type: () => [NotificationEventVariableDto] }) variableDefinitions!: NotificationEventVariableDto[]
  @ApiProperty() variablesKnown!: boolean
  @ApiProperty() implemented!: boolean
  /** 已验收过附件能力的事件返回上限与类型；空表示该事件未接入。 */
  @ApiProperty({ type: () => NotificationEventMediaDto, nullable: true }) media!: NotificationEventMediaDto | null
}

export class NotificationEventChannelMessageDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ type: 'integer', minimum: 0 }) sortOrder!: number
  @ApiProperty({ enum: NOTIFICATION_MESSAGE_KINDS }) kind!: string
  @ApiProperty({ type: 'object', additionalProperties: true }) payload!: Record<string, unknown>
  @ApiProperty({ type: 'object', additionalProperties: true }) mediaPolicy!: Record<string, unknown>
  @ApiProperty() enabled!: boolean
  @ApiProperty({ type: 'string', nullable: true }) contentHash!: string | null
}

export class NotificationEventChannelConfigDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES }) channel!: string
  @ApiProperty({ enum: NOTIFICATION_SEND_METHODS }) sendMethod!: string
  @ApiProperty() enabled!: boolean
  @ApiProperty({ enum: NOTIFICATION_TARGET_MODES }) targetMode!: string
  @ApiProperty({ type: 'object', additionalProperties: true }) targetConfig!: Record<string, unknown>
  @ApiProperty({ type: 'integer', nullable: true }) ttlSeconds!: number | null
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true }) quietHours!: Record<string, unknown> | null
  @ApiProperty() allowSensitive!: boolean
  @ApiProperty({ type: 'integer' }) version!: number
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
  @ApiProperty({ type: 'string', nullable: true }) updatedByName!: string | null
  @ApiProperty({ type: () => [NotificationEventChannelMessageDto] }) messages!: NotificationEventChannelMessageDto[]
}

export class NotificationEventConfigDto {
  @ApiProperty() eventType!: string
  @ApiProperty() label!: string
  @ApiProperty({ enum: TEMPLATE_DOMAINS }) domain!: string
  @ApiProperty({ type: [String] }) variables!: string[]
  @ApiProperty({ type: () => [NotificationEventVariableDto] }) variableDefinitions!: NotificationEventVariableDto[]
  @ApiProperty() variablesKnown!: boolean
  @ApiProperty() implemented!: boolean
  @ApiProperty({ type: () => NotificationEventMediaDto, nullable: true }) media!: NotificationEventMediaDto | null
  @ApiProperty({ type: () => [NotificationEventChannelConfigDto] }) channels!: NotificationEventChannelConfigDto[]
}

export class NotificationEventConfigSummaryChannelDto {
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES }) channel!: string
  @ApiProperty({ enum: NOTIFICATION_SEND_METHODS }) sendMethod!: string
  @ApiProperty() enabled!: boolean
  @ApiProperty({ enum: NOTIFICATION_TARGET_MODES }) targetMode!: string
  @ApiProperty({ type: 'object', additionalProperties: true }) targetConfig!: Record<string, unknown>
  @ApiProperty({ type: 'integer' }) messageCount!: number
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
  @ApiProperty({ type: 'string', nullable: true }) updatedByName!: string | null
}

export class NotificationEventConfigSummaryDto {
  @ApiProperty() eventType!: string
  @ApiProperty() label!: string
  @ApiProperty({ enum: TEMPLATE_DOMAINS }) domain!: string
  @ApiProperty() implemented!: boolean
  @ApiProperty({ type: () => [NotificationEventConfigSummaryChannelDto] }) channels!: NotificationEventConfigSummaryChannelDto[]
}

export class NotificationEventChannelMessageInputDto {
  @ApiProperty({ enum: NOTIFICATION_MESSAGE_KINDS }) @IsIn(NOTIFICATION_MESSAGE_KINDS) kind!: string
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() payload!: Record<string, unknown>
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() mediaPolicy?: Record<string, unknown>
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean
}

export class NotificationEventChannelConfigInputDto {
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES }) @IsIn(NOTIFICATION_CHANNEL_VALUES) channel!: string
  @ApiProperty({ enum: NOTIFICATION_SEND_METHODS }) @IsIn(NOTIFICATION_SEND_METHODS) sendMethod!: string
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() enabled?: boolean
  @ApiProperty({ enum: NOTIFICATION_TARGET_MODES }) @IsIn(NOTIFICATION_TARGET_MODES) targetMode!: string
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() targetConfig!: Record<string, unknown>
  @ApiPropertyOptional({ nullable: true, type: 'integer', minimum: 60, maximum: 604800 })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsInt()
  @Min(60)
  @Max(604800)
  ttlSeconds?: number | null

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsObject()
  quietHours?: Record<string, unknown> | null

  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowSensitive?: boolean
  @ApiProperty({ type: 'integer', minimum: 0 }) @IsInt() @Min(0) expectedVersion!: number
  @ApiProperty({ type: () => [NotificationEventChannelMessageInputDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => NotificationEventChannelMessageInputDto)
  messages!: NotificationEventChannelMessageInputDto[]
}

export class NotificationEventConfigUpdateDto {
  @ApiProperty({ type: () => [NotificationEventChannelConfigInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => NotificationEventChannelConfigInputDto)
  channels!: NotificationEventChannelConfigInputDto[]
}

export class NotificationEventConfigPreviewDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  variables?: Record<string, string | number | null>
}

export class NotificationEventConfigPreviewItemDto {
  @ApiProperty({ enum: NOTIFICATION_MESSAGE_KINDS }) kind!: string
  @ApiProperty({ type: 'object', additionalProperties: true }) payload!: Record<string, unknown>
  @ApiProperty({ type: [String] }) warnings!: string[]
  @ApiPropertyOptional({ type: [String], description: 'mpnews 封面与正文引用的媒体资产 ID' }) assetIds?: string[]
}

export class NotificationEventConfigPreviewChannelDto {
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES }) channel!: string
  @ApiProperty({ enum: NOTIFICATION_SEND_METHODS }) sendMethod!: string
  @ApiProperty({ type: () => [NotificationEventConfigPreviewItemDto] }) items!: NotificationEventConfigPreviewItemDto[]
}

export class NotificationEventConfigPreviewResultDto {
  @ApiProperty() eventType!: string
  @ApiProperty({ type: () => [NotificationEventConfigPreviewChannelDto] }) channels!: NotificationEventConfigPreviewChannelDto[]
}

export class NotificationEventTypeParamDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @MaxLength(64) @Matches(/^[A-Z0-9_]+$/u) eventType!: string
}

export class NotificationRecordQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) eventType?: string
  @ApiPropertyOptional({ enum: TEMPLATE_DOMAINS }) @IsOptional() @IsIn(TEMPLATE_DOMAINS) domain?: string
  @ApiPropertyOptional({ enum: NOTIFICATION_CHANNEL_VALUES }) @IsOptional() @IsIn(NOTIFICATION_CHANNEL_VALUES) channel?: string
  @ApiPropertyOptional({ enum: ['PENDING', 'COMPLETED', 'PARTIAL', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED'] })
  @IsOptional() @IsIn(['PENDING', 'COMPLETED', 'PARTIAL', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED']) status?: string
  @ApiPropertyOptional({ enum: ['NORMAL', 'HIGH'] }) @IsOptional() @IsIn(['NORMAL', 'HIGH']) priority?: string
  @ApiPropertyOptional({ type: 'string', format: 'date-time' }) @IsOptional() @IsISO8601() publishedFrom?: string
  @ApiPropertyOptional({ type: 'string', format: 'date-time' }) @IsOptional() @IsISO8601() publishedTo?: string
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @MaxLength(128) keyword?: string
  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
}

export class NotificationRecordEventOptionDto {
  @ApiProperty() eventType!: string
  @ApiProperty() label!: string
  @ApiProperty({ enum: TEMPLATE_DOMAINS }) domain!: string
}

export class NotificationRecordOptionsDto {
  @ApiProperty({ type: () => [NotificationRecordEventOptionDto] }) events!: NotificationRecordEventOptionDto[]
}

export class NotificationDeliveryDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiPropertyOptional({ enum: ['WECOM'], description: '历史记录未标记时视为企业微信' }) channel?: string
  @ApiProperty({ type: 'string', nullable: true }) recipientName!: string | null
  @ApiProperty({ type: 'string', nullable: true }) targetName!: string | null
  @ApiProperty({ enum: ['PENDING', 'SENDING', 'ACCEPTED', 'PARTIAL', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED'] }) status!: string
  @ApiProperty({ type: 'integer' }) attemptCount!: number
  @ApiProperty({ description: '内容标识：历史记录为旧模板键，新记录为事件类型' }) contentKey!: string
  @ApiProperty({ type: 'integer', description: '内容配置版本快照' }) contentVersion!: number
  @ApiProperty({ description: '实际发送的正文快照' }) renderedContent!: string
  @ApiProperty({ type: 'integer', description: '该投递的附件项总数' }) mediaTotal!: number
  @ApiProperty({ type: 'integer', description: '已接受的附件项数' }) mediaAccepted!: number
  @ApiProperty({ type: 'integer', description: '永久失败或过期的附件项数' }) mediaFailed!: number
  @ApiProperty({ type: 'string', nullable: true }) failureCode!: string | null
  @ApiProperty({ type: 'string', nullable: true }) failureMessage!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) acceptedAt!: string | null
}

export class NotificationRecordMediaDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ type: 'integer' }) sortOrder!: number
  @ApiProperty() mediaType!: string
  @ApiProperty({ type: 'string', nullable: true }) mimeType!: string | null
  @ApiProperty() originalFilename!: string
  @ApiProperty({ type: 'string', description: '字节数，避免 BigInt 序列化问题' }) sizeBytes!: string
  @ApiProperty({ type: 'string', nullable: true, description: '业务语义来源键；历史附件为空' }) sourceKey!: string | null
  @ApiProperty({ type: 'string', nullable: true, description: '来源中文名；历史附件为空' }) sourceLabel!: string | null
  @ApiProperty({
    type: 'string',
    nullable: true,
    description: '非空表示附件被事件渠道内容策略或校验拦截，未进入投递',
  })
  blockedReason!: string | null
}

export class NotificationRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ type: 'string', nullable: true, description: '历史通知可能没有编号' }) notificationNo!: string | null
  @ApiProperty() eventType!: string
  @ApiProperty() eventLabel!: string
  @ApiProperty({ enum: TEMPLATE_DOMAINS }) domain!: string
  @ApiProperty() sourceType!: string
  @ApiProperty() sourceId!: string
  @ApiProperty({ enum: ['NORMAL', 'HIGH'] }) priority!: string
  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'PARTIAL', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED'] }) status!: string
  @ApiProperty({ description: '内容标识：历史记录为旧模板键，新记录为事件类型' }) contentKey!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) expiresAt!: string | null
  @ApiProperty({ format: 'date-time' }) publishedAt!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) completedAt!: string | null
  @ApiProperty({ type: 'string', nullable: true }) requestedByName!: string | null
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES, isArray: true }) channels!: NotificationChannelValue[]
  @ApiProperty({ type: 'integer', description: '站内收件箱条目数' }) inAppItemCount!: number
  @ApiProperty({ type: 'integer', description: '站内未读条目数' }) inAppUnreadCount!: number
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' }, description: '企业微信 WecomDelivery 按状态计数' }) wecomDeliveryCounts!: Record<string, number>
  @ApiProperty({ type: 'integer', description: '业务附件数量（含被策略拦截的）' }) mediaCount!: number
}

export class NotificationRecordPageDto {
  @ApiProperty({ type: () => [NotificationRecordDto] }) items!: NotificationRecordDto[]
  @ApiProperty({ type: 'integer' }) page!: number
  @ApiProperty({ type: 'integer' }) pageSize!: number
  @ApiProperty({ type: 'integer' }) total!: number
}

export class NotificationRecordDetailDto extends NotificationRecordDto {
  @ApiProperty({ type: () => [NotificationDeliveryDto] }) deliveries!: NotificationDeliveryDto[]
  @ApiProperty({ type: () => [NotificationRecordMediaDto] }) media!: NotificationRecordMediaDto[]
}

export class NotificationCancelResultDto {
  @ApiProperty({ type: 'integer' }) cancelled!: number
  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'PARTIAL', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED'] }) status!: string
}

export class NotificationOverviewDto {
  @ApiProperty({ description: '企业微信渠道是否启用' }) channelEnabled!: boolean
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } }) last24Hours!: Record<string, number>
  @ApiProperty({ type: 'object', additionalProperties: true }) queue!: Record<string, string | number | null>
}

export class NotificationRecordIdParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string
}

export class NotificationUuidParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string
}
