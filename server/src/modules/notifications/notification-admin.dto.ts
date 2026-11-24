import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
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

const TEMPLATE_DOMAINS = ['SALES', 'PURCHASE', 'SHIPMENT', 'FINANCE', 'INVOICE', 'RECONCILIATION', 'OPERATIONS', 'SYSTEM'] as const

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
  @ApiProperty({ type: 'string', nullable: true }) defaultTemplateKey!: string | null
  @ApiProperty() implemented!: boolean
  /** 已验收过附件能力的事件返回上限与类型；空表示该事件未接入附件。 */
  @ApiProperty({ type: () => NotificationEventMediaDto, nullable: true }) media!: NotificationEventMediaDto | null
}

export class NotificationTemplateMediaPolicyDto {
  @ApiProperty() enabled!: boolean
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 3 }) maxCount!: number
  @ApiProperty({ enum: ['IMAGE'], isArray: true }) kinds!: string[]
  @ApiProperty({ type: [String], description: '允许的附件来源键；空表示不区分来源' }) sources!: string[]
}

export class NotificationTemplateMediaPolicyInputDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 3 }) @IsOptional() @IsInt() @Min(1) @Max(3) maxCount?: number
  @ApiPropertyOptional({ enum: ['IMAGE'], isArray: true }) @IsOptional() @IsArray() @IsIn(['IMAGE'], { each: true }) kinds?: ('IMAGE')[]
  @ApiPropertyOptional({ type: [String], maxItems: 20 }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Matches(/^[A-Za-z0-9._-]+$/u, { each: true }) @MaxLength(64, { each: true }) sources?: string[]
}

export class NotificationTemplateVariableDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @Matches(/^[a-zA-Z0-9_]+$/u) name!: string
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 1500 }) @IsOptional() @IsInt() @Min(1) @Max(1500) maxLength?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sensitive?: boolean
}

export const NOTIFICATION_CHANNEL_VALUES = ['IN_APP', 'ASSISTANT', 'WECOM'] as const
export type NotificationChannelValue = (typeof NOTIFICATION_CHANNEL_VALUES)[number]

export class NotificationTemplateDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() key!: string
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES }) channel!: string
  @ApiProperty() name!: string
  @ApiProperty({ enum: TEMPLATE_DOMAINS }) domain!: string
  @ApiProperty({ type: 'string', nullable: true }) titleTemplate!: string | null
  @ApiProperty() bodyTemplate!: string
  @ApiProperty({ type: 'string', nullable: true }) linkUrlTemplate!: string | null
  @ApiProperty({ type: () => [NotificationTemplateVariableDto] }) variables!: NotificationTemplateVariableDto[]
  @ApiProperty({ type: () => NotificationTemplateMediaPolicyDto }) mediaPolicy!: NotificationTemplateMediaPolicyDto
  @ApiProperty({ type: 'integer' }) maxLength!: number
  @ApiProperty({ type: 'integer', nullable: true }) maxBytes!: number | null
  @ApiProperty() enabled!: boolean
  @ApiProperty({ type: 'integer' }) version!: number
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
  @ApiProperty({ type: 'string', nullable: true }) updatedByName!: string | null
}

export class NotificationTemplateCreateDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @Matches(/^[a-zA-Z0-9._-]+$/u) key!: string
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES }) @IsIn(NOTIFICATION_CHANNEL_VALUES) channel!: NotificationChannelValue
  @ApiProperty({ maxLength: 128 }) @IsString() @Matches(/\S/u) name!: string
  @ApiPropertyOptional({ enum: TEMPLATE_DOMAINS, default: 'SYSTEM' }) @IsOptional() @IsIn(TEMPLATE_DOMAINS) domain?: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) @IsOptional() @IsString() titleTemplate?: string | null
  @ApiProperty() @IsString() @Matches(/\S/u) bodyTemplate!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) @IsOptional() @IsString() linkUrlTemplate?: string | null
  @ApiProperty({ type: () => [NotificationTemplateVariableDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => NotificationTemplateVariableDto) variables!: NotificationTemplateVariableDto[]
  @ApiPropertyOptional({ type: () => NotificationTemplateMediaPolicyInputDto }) @IsOptional() @ValidateNested() @Type(() => NotificationTemplateMediaPolicyInputDto) mediaPolicy?: NotificationTemplateMediaPolicyInputDto
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 5000, default: 2000 }) @IsOptional() @IsInt() @Min(1) @Max(5000) maxLength?: number
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 4096, description: 'WECOM 文本模板的 UTF-8 字节上限' }) @IsOptional() @IsInt() @Min(1) @Max(4096) maxBytes?: number
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() enabled?: boolean
}

export class NotificationTemplateUpdateDto {
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() name?: string
  @ApiPropertyOptional({ enum: TEMPLATE_DOMAINS }) @IsOptional() @IsIn(TEMPLATE_DOMAINS) domain?: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) @IsOptional() @IsString() titleTemplate?: string | null
  @ApiPropertyOptional() @IsOptional() @IsString() bodyTemplate?: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) @IsOptional() @IsString() linkUrlTemplate?: string | null
  @ApiPropertyOptional({ type: () => [NotificationTemplateVariableDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => NotificationTemplateVariableDto) variables?: NotificationTemplateVariableDto[]
  @ApiPropertyOptional({ type: () => NotificationTemplateMediaPolicyInputDto }) @IsOptional() @ValidateNested() @Type(() => NotificationTemplateMediaPolicyInputDto) mediaPolicy?: NotificationTemplateMediaPolicyInputDto
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 5000 }) @IsOptional() @IsInt() @Min(1) @Max(5000) maxLength?: number
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 4096 }) @IsOptional() @IsInt() @Min(1) @Max(4096) maxBytes?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean
  @ApiProperty({ type: 'integer', minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number
}

export class NotificationTemplatePreviewDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() variables!: Record<string, string | number | null>
}

export class NotificationTemplatePreviewResultDto {
  @ApiProperty() content!: string
  @ApiProperty({ type: 'string', nullable: true }) linkUrl!: string | null
  @ApiProperty() truncated!: boolean
  @ApiProperty({ type: [String] }) warnings!: string[]
}

export class NotificationChannelPolicyDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() eventType!: string
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES }) channel!: string
  @ApiProperty({ enum: ['COMMAND_TARGET', 'USERS', 'ROLE', 'PERMISSION', 'GROUP'] }) targetMode!: string
  @ApiProperty({ type: 'object', additionalProperties: true }) targetConfig!: Record<string, unknown>
  @ApiProperty({ type: 'string', nullable: true }) templateKey!: string | null
  @ApiProperty({ enum: ['NORMAL', 'HIGH'] }) priority!: string
  @ApiProperty({ nullable: true, type: 'integer' }) ttlSeconds!: number | null
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true }) quietHours!: Record<string, unknown> | null
  @ApiProperty() allowSensitive!: boolean
  @ApiProperty() enabled!: boolean
  @ApiProperty({ type: 'integer' }) version!: number
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
  @ApiProperty({ type: 'string', nullable: true }) updatedByName!: string | null
}

export class NotificationChannelPolicyUpdateDto {
  @ApiProperty({ enum: ['COMMAND_TARGET', 'USERS', 'ROLE', 'PERMISSION', 'GROUP'] }) @IsIn(['COMMAND_TARGET', 'USERS', 'ROLE', 'PERMISSION', 'GROUP']) targetMode!: string
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() targetConfig!: Record<string, unknown>
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 64 }) @IsOptional() @IsString() templateKey?: string | null
  @ApiProperty({ enum: ['NORMAL', 'HIGH'] }) @IsIn(['NORMAL', 'HIGH']) priority!: string
  @ApiPropertyOptional({ nullable: true, type: 'integer', minimum: 60, maximum: 604800 }) @IsOptional() @ValidateIf((_object, value: unknown) => value !== null) @IsInt() @Min(60) @Max(604800) ttlSeconds?: number | null
  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true }) @IsOptional() @ValidateIf((_object, value: unknown) => value !== null) @IsObject() quietHours?: Record<string, unknown> | null
  @ApiProperty() @IsBoolean() allowSensitive!: boolean
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty({ type: 'integer', minimum: 0 }) @IsInt() @Min(0) expectedVersion!: number
}

export class NotificationChannelPolicyPathDto {
  @ApiProperty() @IsString() @Matches(/\S/u) eventType!: string
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES }) @IsIn(NOTIFICATION_CHANNEL_VALUES) channel!: NotificationChannelValue
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
  @ApiPropertyOptional({ enum: ['ASSISTANT', 'WECOM'], description: '历史记录未标记时按 ASSISTANT 处理' }) channel?: string
  @ApiProperty({ type: 'string', nullable: true }) recipientName!: string | null
  @ApiProperty({ type: 'string', nullable: true }) targetName!: string | null
  @ApiProperty({ enum: ['PENDING', 'SENDING', 'ACCEPTED', 'PARTIAL', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED'] }) status!: string
  @ApiProperty({ type: 'integer' }) attemptCount!: number
  @ApiProperty() templateKey!: string
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
    description: '非空表示附件被模板策略或校验拦截，未进入投递',
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
  @ApiProperty() templateKey!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) expiresAt!: string | null
  @ApiProperty({ format: 'date-time' }) publishedAt!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) completedAt!: string | null
  @ApiProperty({ type: 'string', nullable: true }) requestedByName!: string | null
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_VALUES, isArray: true }) channels!: NotificationChannelValue[]
  @ApiProperty({ type: 'integer', description: '站内收件箱条目数' }) inAppItemCount!: number
  @ApiProperty({ type: 'integer', description: '站内未读条目数' }) inAppUnreadCount!: number
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' }, description: '小助理 AssistantDelivery 按状态计数' }) deliveryCounts!: Record<string, number>
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'integer' }, description: '企业微信 WecomDelivery 按状态计数' }) wecomDeliveryCounts?: Record<string, number>
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
  @ApiProperty() channelEnabled!: boolean
  @ApiProperty() tokenConfigured!: boolean
  @ApiProperty({ type: 'string', nullable: true }) accountName!: string | null
  @ApiProperty({ type: 'string', nullable: true }) accountStatus!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) lastOnlineAt!: string | null
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } }) last24Hours!: Record<string, number>
  @ApiProperty({ type: 'object', additionalProperties: true }) queue!: Record<string, string | number | null>
}

export class NotificationRecordIdParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string
}

export class NotificationUuidParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string
}
