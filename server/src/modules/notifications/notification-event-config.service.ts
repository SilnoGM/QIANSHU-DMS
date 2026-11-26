import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { MediaAssetService } from '../media/media-asset.service'
import { MediaAssetRetentionService } from '../media/media-retention.service'
import {
  extractNotificationContentAssetIds,
  parseNotificationImageMediaPolicy,
  renderMpnewsHtml,
  validateNotificationContentGroup,
  type NotificationMessageKindValue,
  type NotificationSendMethodValue,
} from './notification-content'
import { parseNotificationQuietHours } from './notification-quiet-hours'
import { renderNotificationTemplate } from './notification-template.renderer'
import type {
  NotificationEventChannelConfigDto,
  NotificationEventChannelConfigInputDto,
  NotificationEventChannelMessageDto,
  NotificationEventConfigDto,
  NotificationEventConfigPreviewDto,
  NotificationEventConfigPreviewItemDto,
  NotificationEventConfigPreviewResultDto,
  NotificationEventConfigSummaryDto,
  NotificationEventConfigUpdateDto,
} from './notification-admin.dto'
import {
  IMPLEMENTED_NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_EVENT_DOMAIN,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TYPES,
  notificationEventDynamicTargetLabel,
  notificationEventMediaCapability,
  notificationEventVariableDefinitions,
  notificationEventVariables,
} from './notification.types'

export interface NotificationEventConfigContext {
  readonly actorUserId: string
  readonly requestId: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toMessageDto(message: {
  readonly id: string
  readonly sortOrder: number
  readonly kind: string
  readonly payload: Prisma.JsonValue
  readonly mediaPolicy: Prisma.JsonValue
  readonly enabled: boolean
  readonly contentHash: string | null
}): NotificationEventChannelMessageDto {
  return {
    id: message.id,
    sortOrder: message.sortOrder,
    kind: message.kind,
    payload: asRecord(message.payload),
    mediaPolicy: asRecord(message.mediaPolicy),
    enabled: message.enabled,
    contentHash: message.contentHash,
  }
}

function toChannelDto(channel: {
  readonly id: string
  readonly channel: string
  readonly sendMethod: string
  readonly enabled: boolean
  readonly targetMode: string
  readonly targetConfig: Prisma.JsonValue
  readonly ttlSeconds: number | null
  readonly quietHours: Prisma.JsonValue | null
  readonly allowSensitive: boolean
  readonly version: number
  readonly updatedAt: Date
  readonly updatedBy: { readonly displayName: string } | null
  readonly messages: readonly {
    readonly id: string
    readonly sortOrder: number
    readonly kind: string
    readonly payload: Prisma.JsonValue
    readonly mediaPolicy: Prisma.JsonValue
    readonly enabled: boolean
    readonly contentHash: string | null
  }[]
}): NotificationEventChannelConfigDto {
  return {
    id: channel.id,
    channel: channel.channel,
    sendMethod: channel.sendMethod,
    enabled: channel.enabled,
    targetMode: channel.targetMode,
    targetConfig: asRecord(channel.targetConfig),
    ttlSeconds: channel.ttlSeconds,
    quietHours: channel.quietHours === null ? null : asRecord(channel.quietHours),
    allowSensitive: channel.allowSensitive,
    version: channel.version,
    updatedAt: channel.updatedAt.toISOString(),
    updatedByName: channel.updatedBy?.displayName ?? null,
    messages: channel.messages.map(toMessageDto),
  }
}

function eventLabel(eventType: string): string {
  return NOTIFICATION_EVENT_LABELS[eventType as keyof typeof NOTIFICATION_EVENT_LABELS] ?? eventType
}

function eventDomain(eventType: string): string {
  return NOTIFICATION_EVENT_DOMAIN[eventType as keyof typeof NOTIFICATION_EVENT_DOMAIN] ?? 'system'
}

function assertEventType(eventType: string): void {
  if (!(NOTIFICATION_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new ApiException(404, 'NOTIFICATION_EVENT_NOT_FOUND', '通知事件不存在')
  }
}

function isChannelMethodPairAllowed(channel: string, sendMethod: string): boolean {
  return (channel === 'IN_APP' && sendMethod === 'IN_APP')
    || (channel === 'WECOM' && (sendMethod === 'APP' || sendMethod === 'ROBOT'))
}

function normalizeTargetConfig(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * 事件渠道配置与渠道独享内容的读写。
 *
 * 这里是新内容模型的唯一管理端入口：不存在模板 key、模板库或模板选择器。
 * 保存时先做方法和内容校验，再在单事务内替换消息项，避免半套配置落库。
 */
@Injectable()
export class NotificationEventConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mediaAsset: MediaAssetService,
    private readonly retention: MediaAssetRetentionService,
  ) {}

  async list(): Promise<NotificationEventConfigSummaryDto[]> {
    const channels = await this.prisma.notificationEventChannel.findMany({
      orderBy: [{ eventType: 'asc' }, { channel: 'asc' }],
      include: {
        updatedBy: { select: { displayName: true } },
        _count: { select: { messages: true } },
      },
    })
    const byEvent = new Map<string, typeof channels>()
    for (const channel of channels) {
      const list = byEvent.get(channel.eventType) ?? []
      list.push(channel)
      byEvent.set(channel.eventType, list)
    }
    return NOTIFICATION_EVENT_TYPES.map((eventType) => ({
      eventType,
      label: eventLabel(eventType),
      domain: eventDomain(eventType).toUpperCase(),
      implemented: (IMPLEMENTED_NOTIFICATION_EVENT_TYPES as readonly string[]).includes(eventType),
      channels: (byEvent.get(eventType) ?? []).map(channel => ({
        channel: channel.channel,
        sendMethod: channel.sendMethod,
        enabled: channel.enabled,
        targetMode: channel.targetMode,
        targetConfig: asRecord(channel.targetConfig),
        messageCount: channel._count.messages,
        updatedAt: channel.updatedAt.toISOString(),
        updatedByName: channel.updatedBy?.displayName ?? null,
      })),
    }))
  }

  async get(eventType: string): Promise<NotificationEventConfigDto> {
    assertEventType(eventType)
    const channels = await this.prisma.notificationEventChannel.findMany({
      where: { eventType },
      orderBy: { channel: 'asc' },
      include: {
        updatedBy: { select: { displayName: true } },
        messages: { orderBy: { sortOrder: 'asc' } },
      },
    })
    const variables = notificationEventVariables(eventType)
    const definitions = notificationEventVariableDefinitions(eventType)
    return {
      eventType,
      label: eventLabel(eventType),
      domain: eventDomain(eventType).toUpperCase(),
      variables: variables === null ? [] : [...variables],
      variableDefinitions: definitions === null
        ? []
        : definitions.map(definition => ({
            name: definition.name,
            label: definition.label,
            description: definition.description,
            example: definition.example,
            sensitive: definition.sensitive,
            maxLength: definition.maxLength,
            required: definition.required,
          })),
      variablesKnown: variables !== null,
      implemented: (IMPLEMENTED_NOTIFICATION_EVENT_TYPES as readonly string[]).includes(eventType),
      dynamicTargetLabel: notificationEventDynamicTargetLabel(eventType),
      media: notificationEventMediaCapability(eventType) === null
        ? null
        : {
            maxCount: notificationEventMediaCapability(eventType)!.maxCount,
            kinds: [...notificationEventMediaCapability(eventType)!.kinds],
            sources: notificationEventMediaCapability(eventType)!.sources.map(source => ({ key: source.key, label: source.label })),
          },
      channels: channels.map(toChannelDto),
    }
  }

  async preview(
    eventType: string,
    input: NotificationEventConfigPreviewDto,
  ): Promise<NotificationEventConfigPreviewResultDto> {
    assertEventType(eventType)
    const variables = input.variables ?? {}
    const allowed = this.contentVariableDefinitions(eventType)
    const channels = await this.prisma.notificationEventChannel.findMany({
      where: { eventType },
      orderBy: { channel: 'asc' },
      include: {
        messages: {
          where: { enabled: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
    return {
      eventType,
      channels: channels.map(channel => ({
        channel: channel.channel,
        sendMethod: channel.sendMethod,
        items: channel.messages.map(message => this.previewMessage({
          eventType,
          channel,
          message,
          variables,
          allowed,
        })),
      })),
    }
  }

  private previewMessage(input: {
    readonly eventType: string
    readonly channel: { readonly channel: string, readonly allowSensitive: boolean }
    readonly message: {
      readonly kind: string
      readonly payload: Prisma.JsonValue
      readonly mediaPolicy: Prisma.JsonValue
    }
    readonly variables: Readonly<Record<string, string | number | null>>
    readonly allowed: readonly {
      readonly name: string
      readonly required: boolean
      readonly maxLength: number
      readonly sensitive: boolean
    }[]
  }): NotificationEventConfigPreviewItemDto {
    const payload = asRecord(input.message.payload)
    if (input.message.kind === 'TEXT') {
      const rawTitle = typeof payload.title === 'string' ? payload.title : null
      const rawContent = typeof payload.content === 'string' ? payload.content : ''
      const rawLink = typeof payload.linkUrl === 'string' ? payload.linkUrl : null
      const title = rawTitle !== null && rawTitle.trim().length > 0
        ? renderNotificationTemplate({
            body: rawTitle,
            variables: input.variables,
            allowed: input.allowed,
            allowSensitive: input.channel.allowSensitive,
            maxLength: 200,
          })
        : null
      const body = renderNotificationTemplate({
        body: rawContent,
        linkUrlTemplate: rawLink,
        variables: input.variables,
        allowed: input.allowed,
        allowSensitive: input.channel.allowSensitive,
        maxLength: 2_000,
      })
      const warnings: string[] = []
      if (title !== null && !title.ok) warnings.push(title.message)
      if (!body.ok) warnings.push(body.message)
      if (title?.ok === true) warnings.push(...title.warnings)
      if (body.ok) warnings.push(...body.warnings)
      return {
        kind: input.message.kind,
        payload: body.ok
          ? {
              title: title?.ok === true ? title.content : null,
              content: body.content,
              linkUrl: body.linkUrl,
            }
          : {
              title: rawTitle,
              content: rawContent,
              linkUrl: rawLink,
            },
        warnings: [...new Set(warnings)],
      }
    }

    if (input.message.kind === 'MPNEWS') {
      const cover = asRecord(payload.cover)
      const mediaAssetId = typeof cover.mediaAssetId === 'string' ? cover.mediaAssetId : null
      const rawTitle = typeof payload.title === 'string' ? payload.title : ''
      const rawAuthor = typeof payload.author === 'string' ? payload.author : null
      const rawDigest = typeof payload.digest === 'string' ? payload.digest : null
      const rawContentSourceUrl = typeof payload.contentSourceUrl === 'string' ? payload.contentSourceUrl : null
      const rawContent = typeof payload.content === 'string' ? payload.content : ''
      const title = renderNotificationTemplate({
        body: rawTitle,
        variables: input.variables,
        allowed: input.allowed,
        allowSensitive: input.channel.allowSensitive,
        maxLength: 128,
        maxBytes: 128,
      })
      const author = rawAuthor === null ? null : renderNotificationTemplate({
        body: rawAuthor,
        variables: input.variables,
        allowed: input.allowed,
        allowSensitive: input.channel.allowSensitive,
        maxLength: 64,
        maxBytes: 64,
      })
      const digest = rawDigest === null ? null : renderNotificationTemplate({
        body: rawDigest,
        variables: input.variables,
        allowed: input.allowed,
        allowSensitive: input.channel.allowSensitive,
        maxLength: 512,
        maxBytes: 512,
      })
      const sourceUrl = rawContentSourceUrl === null ? null : renderNotificationTemplate({
        body: '',
        linkUrlTemplate: rawContentSourceUrl,
        variables: input.variables,
        allowed: input.allowed,
        allowSensitive: input.channel.allowSensitive,
        maxLength: 1,
      })
      const content = renderMpnewsHtml({
        html: rawContent,
        variables: input.variables,
        allowed: input.allowed,
        allowSensitive: input.channel.allowSensitive,
      })
      const warnings: string[] = []
      for (const result of [title, author, digest, sourceUrl]) {
        if (result !== null && !result.ok) warnings.push(result.message)
      }
      for (const [label, result, maxBytes] of [
        ['标题', title, 128],
        ['作者', author, 64],
        ['摘要', digest, 512],
      ] as const) {
        if (result !== null && result.ok && result.truncated) {
          warnings.push(`mpnews ${label}渲染后超过 ${maxBytes} 字节，已截断`)
        }
      }
      if (!content.ok) warnings.push(content.message)
      if (content.ok) warnings.push(...content.warnings)
      const assetIds = new Set<string>()
      if (mediaAssetId !== null) assetIds.add(mediaAssetId)
      for (const match of (content.ok ? content.content : rawContent).matchAll(/\bdata-asset-id\s*=\s*["']([^"']+)["']/giu)) {
        if (match[1] !== undefined) assetIds.add(match[1])
      }
      return {
        kind: input.message.kind,
        payload: {
          cover: mediaAssetId === null ? null : { mediaAssetId },
          title: title.ok ? title.content : rawTitle,
          author: author === null ? null : author.ok ? author.content : rawAuthor,
          digest: digest === null ? null : digest.ok ? digest.content : rawDigest,
          contentSourceUrl: sourceUrl === null ? null : sourceUrl.ok ? sourceUrl.linkUrl : rawContentSourceUrl,
          content: content.ok ? content.content : rawContent,
        },
        warnings: [...new Set(warnings)],
        assetIds: [...assetIds],
      }
    }

    if (input.message.kind === 'IMAGE') {
      const policy = parseNotificationImageMediaPolicy(input.message.mediaPolicy)
      return {
        kind: input.message.kind,
        payload: { mediaPolicy: policy },
        warnings: policy === null ? ['图片附件策略无效'] : [],
      }
    }

    return {
      kind: input.message.kind,
      payload,
      warnings: [`消息类型 ${input.message.kind} 尚未接入预览`],
    }
  }

  private contentVariableDefinitions(eventType: string): readonly {
    readonly name: string
    readonly required: boolean
    readonly maxLength: number
    readonly sensitive: boolean
  }[] {
    const definitions = notificationEventVariableDefinitions(eventType)
    return definitions === null
      ? []
      : definitions.map(definition => ({
          name: definition.name,
          required: definition.required,
          maxLength: definition.maxLength,
          sensitive: definition.sensitive,
        }))
  }

  async update(
    context: NotificationEventConfigContext,
    eventType: string,
    input: NotificationEventConfigUpdateDto,
  ): Promise<NotificationEventConfigDto> {
    assertEventType(eventType)
    const seenChannels = new Set<string>()
    for (const channel of input.channels) {
      if (seenChannels.has(channel.channel)) {
        throw new ApiException(422, 'NOTIFICATION_EVENT_CHANNEL_DUPLICATE', `同一事件不能重复配置渠道：${channel.channel}`)
      }
      seenChannels.add(channel.channel)
      this.validateChannelShape(channel)
    }

    const variables = notificationEventVariables(eventType)
    const normalizedChannels = input.channels.map(channel => ({
      input: channel,
      items: this.validateContent(eventType, channel, variables),
    }))

    await this.prisma.$transaction(async (transaction) => {
      for (const channel of normalizedChannels) {
        const current = await transaction.notificationEventChannel.findUnique({
          where: {
            eventType_channel: {
              eventType,
              channel: channel.input.channel as 'IN_APP' | 'WECOM',
            },
          },
        })
        if (current === null && channel.input.expectedVersion !== 0) {
          throw new ApiException(409, 'NOTIFICATION_EVENT_CONFIG_STATE_CHANGED', '渠道配置已变化，请刷新后重试')
        }
        if (current !== null && current.version !== channel.input.expectedVersion) {
          throw new ApiException(409, 'NOTIFICATION_EVENT_CONFIG_STATE_CHANGED', '渠道配置已变化，请刷新后重试')
        }

        const quietHours = channel.input.quietHours === null || channel.input.quietHours === undefined
          ? null
          : parseNotificationQuietHours(channel.input.quietHours)
        if (channel.input.quietHours !== null && channel.input.quietHours !== undefined && quietHours === null) {
          throw new ApiException(422, 'NOTIFICATION_EVENT_QUIET_HOURS_INVALID', '静默时段格式不正确')
        }

        const saved = await transaction.notificationEventChannel.upsert({
          where: {
            eventType_channel: {
              eventType,
              channel: channel.input.channel as 'IN_APP' | 'WECOM',
            },
          },
          update: {
            sendMethod: channel.input.sendMethod as NotificationSendMethodValue,
            enabled: channel.input.enabled ?? true,
            targetMode: channel.input.targetMode as 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP',
            targetConfig: normalizeTargetConfig(channel.input.targetConfig) as Prisma.InputJsonValue,
            ttlSeconds: channel.input.ttlSeconds ?? null,
            quietHours: quietHours === null ? Prisma.DbNull : quietHours as unknown as Prisma.InputJsonValue,
            allowSensitive: channel.input.allowSensitive ?? false,
            updatedByUserId: context.actorUserId,
            version: { increment: 1 },
          },
          create: {
            eventType,
            channel: channel.input.channel as 'IN_APP' | 'WECOM',
            sendMethod: channel.input.sendMethod as NotificationSendMethodValue,
            enabled: channel.input.enabled ?? true,
            targetMode: channel.input.targetMode as 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP',
            targetConfig: normalizeTargetConfig(channel.input.targetConfig) as Prisma.InputJsonValue,
            ttlSeconds: channel.input.ttlSeconds ?? null,
            quietHours: quietHours === null ? Prisma.DbNull : quietHours as unknown as Prisma.InputJsonValue,
            allowSensitive: channel.input.allowSensitive ?? false,
            updatedByUserId: context.actorUserId,
          },
        })

        const previousMediaAssetIds = await transaction.notificationEventChannelMessageMedia.findMany({
          where: { message: { channelConfigId: saved.id } },
          select: { mediaAssetId: true },
        })
        await transaction.notificationEventChannelMessage.deleteMany({
          where: { channelConfigId: saved.id },
        })
        const messageRows = channel.items.map(item => ({
          id: randomUUID(),
          channelConfigId: saved.id,
          sortOrder: item.sortOrder,
          kind: item.kind,
          payload: item.payload as unknown as Prisma.InputJsonValue,
          mediaPolicy: item.mediaPolicy as Prisma.InputJsonValue,
          contentHash: item.contentHash,
          enabled: item.enabled,
        }))
        const assetIds = new Set<string>()
        for (const item of channel.items) {
          const extracted = extractNotificationContentAssetIds({ kind: item.kind, payload: item.payload })
          if (extracted.coverAssetId !== null) assetIds.add(extracted.coverAssetId)
          for (const assetId of extracted.inlineAssetIds) assetIds.add(assetId)
        }
        const assets = assetIds.size === 0
          ? []
          : await transaction.mediaAsset.findMany({
              where: { id: { in: [...assetIds] } },
              select: {
                id: true,
                mediaType: true,
                status: true,
                deletedAt: true,
                objectKey: true,
                sizeBytes: true,
                createdByUserId: true,
                uploadExpiresAt: true,
              },
            })
        const assetById = new Map(assets.map(asset => [asset.id, asset]))
        const now = new Date()
        const activationAssetIds = new Set<string>()
        const mediaRows: Array<{
          messageId: string
          mediaAssetId: string
          role: 'COVER' | 'INLINE'
          sortOrder: number
        }> = []
        for (const [index, item] of channel.items.entries()) {
          const extracted = extractNotificationContentAssetIds({ kind: item.kind, payload: item.payload })
          const refs: Array<{ assetId: string, role: 'COVER' | 'INLINE' }> = []
          if (extracted.coverAssetId !== null) {
            refs.push({ assetId: extracted.coverAssetId, role: 'COVER' })
          }
          for (const assetId of extracted.inlineAssetIds) {
            refs.push({ assetId, role: 'INLINE' })
          }
          for (const [sortOrder, ref] of refs.entries()) {
            const asset = assetById.get(ref.assetId)
            const maxBytes = ref.role === 'COVER' ? 10n * 1_024n * 1_024n : 2n * 1_024n * 1_024n
            // UPLOADING 只接受本次操作者刚上传且未过期的草稿；别人的在途上传不能被激活挪用。
            const uploadedByActor = asset !== undefined
              && asset.status === 'UPLOADING'
              && asset.createdByUserId === context.actorUserId
              && asset.uploadExpiresAt !== null
              && asset.uploadExpiresAt.getTime() > now.getTime()
            if (
              asset === undefined
              || asset.mediaType !== 'IMAGE'
              || asset.deletedAt !== null
              || asset.objectKey === null
              || asset.sizeBytes === null
              || asset.sizeBytes > maxBytes
              || (asset.status !== 'READY' && !uploadedByActor)
            ) {
              throw new ApiException(
                422,
                'NOTIFICATION_EVENT_CONTENT_MEDIA_INVALID',
                `内容图片不可用或超过大小限制：${ref.assetId}`,
              )
            }
            if (asset.status === 'UPLOADING') activationAssetIds.add(asset.id)
            mediaRows.push({
              messageId: messageRows[index].id,
              mediaAssetId: ref.assetId,
              role: ref.role,
              sortOrder,
            })
          }
        }
        // 草稿上传的资产在保存事务内激活；事务回滚时资产仍停留在 UPLOADING 并按上传过期清理。
        for (const assetId of activationAssetIds) {
          await this.mediaAsset.activate(transaction, assetId)
        }
        if (messageRows.length > 0) {
          await transaction.notificationEventChannelMessage.createMany({ data: messageRows })
        }
        if (mediaRows.length > 0) {
          await transaction.notificationEventChannelMessageMedia.createMany({ data: mediaRows })
        }
        // 被移除的旧图片只有在没有任何事件内容引用时才回收，避免误删其他事件复用的资产。
        const nextAssetIds = new Set(mediaRows.map(row => row.mediaAssetId))
        for (const previous of previousMediaAssetIds) {
          if (!nextAssetIds.has(previous.mediaAssetId)) {
            await this.retention.markUnreferencedForTrash(transaction, previous.mediaAssetId)
          }
        }
        await this.audit.record(transaction, {
          eventType: 'NOTIFICATION_POLICY_UPDATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'NOTIFICATION_EVENT_CHANNEL',
          targetId: saved.id,
          metadata: {
            eventType,
            channel: saved.channel,
            sendMethod: saved.sendMethod,
            version: saved.version,
            messageCount: channel.items.length,
          },
        })
      }
    })

    return this.get(eventType)
  }

  private validateChannelShape(channel: NotificationEventChannelConfigInputDto): void {
    if (!isChannelMethodPairAllowed(channel.channel, channel.sendMethod)) {
      throw new ApiException(422, 'NOTIFICATION_EVENT_CHANNEL_METHOD_INVALID', '渠道与发送方式不匹配')
    }
    if (channel.channel === 'IN_APP') {
      if (channel.targetMode === 'GROUP') {
        throw new ApiException(422, 'NOTIFICATION_EVENT_TARGET_MODE_INVALID', '站内通知不能使用群目标')
      }
      if (channel.ttlSeconds !== null && channel.ttlSeconds !== undefined) {
        throw new ApiException(422, 'NOTIFICATION_EVENT_TTL_UNSUPPORTED', '站内通知不支持 TTL')
      }
      if (channel.quietHours !== null && channel.quietHours !== undefined) {
        throw new ApiException(422, 'NOTIFICATION_EVENT_QUIET_HOURS_UNSUPPORTED', '站内通知不支持静默时段')
      }
      if (channel.allowSensitive === true) {
        throw new ApiException(422, 'NOTIFICATION_EVENT_SENSITIVE_UNSUPPORTED', '站内通知不支持敏感内容开关')
      }
      return
    }
    if (channel.sendMethod === 'ROBOT' && channel.targetMode !== 'GROUP') {
      throw new ApiException(422, 'NOTIFICATION_EVENT_TARGET_MODE_INVALID', '群机器人必须使用群目标')
    }
    if (channel.sendMethod === 'APP' && channel.targetMode === 'GROUP') {
      throw new ApiException(422, 'NOTIFICATION_EVENT_TARGET_MODE_INVALID', '应用消息不能使用群目标')
    }
  }

  private validateContent(
    eventType: string,
    channel: NotificationEventChannelConfigInputDto,
    variables: readonly string[] | null,
  ) {
    if (channel.enabled === false && channel.messages.length === 0) {
      return []
    }
    const mediaCapability = notificationEventMediaCapability(eventType)
    const result = validateNotificationContentGroup({
      method: channel.sendMethod as NotificationSendMethodValue,
      items: channel.messages.map(message => ({
        kind: message.kind as NotificationMessageKindValue,
        payload: message.payload,
        mediaPolicy: message.mediaPolicy,
        enabled: message.enabled,
      })),
      allowedVariables: variables,
      mediaSources: mediaCapability?.sources.map(source => source.key) ?? null,
      mediaMaxCount: mediaCapability?.maxCount ?? 0,
    })
    if (!result.ok) {
      throw new ApiException(
        422,
        'NOTIFICATION_EVENT_CONTENT_INVALID',
        result.issues.map(issue => issue.message).join('；'),
        undefined,
        result.issues.map(issue => ({
          code: issue.code,
          message: issue.message,
          channel: channel.channel,
          ...(issue.itemIndex === undefined ? {} : { itemIndex: issue.itemIndex }),
          ...(issue.field === undefined ? {} : { field: issue.field }),
        })),
      )
    }
    return result.items
  }
}
