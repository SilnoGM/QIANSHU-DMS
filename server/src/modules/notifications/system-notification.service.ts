import { createHash, randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  extractMpnewsMediaSourceSlots,
  extractNotificationContentAssetIds,
  mpnewsHasStaticTextOutsideImages,
  parseNotificationImageMediaPolicy,
  renderMpnewsHtml,
} from './notification-content'
import { renderNotificationTemplate, type NotificationTemplateVariable } from './notification-template.renderer'
import {
  hashNotificationNumberIdempotencyKey,
  hashNotificationNumberRequestFingerprint,
  NOTIFICATION_NUMBER_CONSUMER_CODE,
  NOTIFICATION_NUMBER_RULE_CODE,
} from './notification-number'
import {
  DEFAULT_NOTIFICATION_TTL_SECONDS,
  MAX_NOTIFICATION_DEDUPE_KEY_LENGTH,
  MAX_NOTIFICATION_TTL_SECONDS,
  MAX_NOTIFICATION_VARIABLES,
  MAX_NOTIFICATION_VARIABLE_LENGTH,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TYPES,
  notificationEventMediaCapability,
  notificationEventVariableDefinitions,
  type NotificationChannel,
  type NotificationPublishWarningCode,
  type NotificationSkipReason,
  type NotificationTarget,
  type SystemNotificationPublishCommand,
  type SystemNotificationPublishOptions,
  type SystemNotificationPublishResult,
} from './notification.types'
import {
  parseWecomMentionConfig,
  utf8Bytes,
  WECOM_DEFAULT_MAX_BYTES,
  type WecomMentionConfig,
} from './wecom.types'

type Transaction = Prisma.TransactionClient

type EventChannelConfig = Prisma.NotificationEventChannelGetPayload<{
  include: { messages: true }
}>

type EventChannelMessage = EventChannelConfig['messages'][number]

interface ResolvedChannelResult {
  readonly channel: NotificationChannel
  readonly status: 'CREATED' | 'PENDING' | 'SKIPPED'
  readonly recipientCount: number
  readonly skippedCount: number
  readonly skipReason?: NotificationSkipReason
}

interface NotificationMediaAttachment {
  readonly mediaAssetId: string
  readonly sortOrder: number
  readonly messageSortOrder: number
}

interface NotificationInlineMediaAssignment {
  readonly slotIndex: number
  readonly mediaAssetId: string
  readonly sourceKey: string
}

interface ResolvedEventMediaPlan {
  readonly attachments: readonly NotificationMediaAttachment[]
  readonly inlineByMessageId: ReadonlyMap<string, readonly NotificationInlineMediaAssignment[]>
}

/** 非 UUID 输入不能进 SQL：PostgreSQL 会以 22P02 中止整个业务事务。 */
const USER_SUPPLIED_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function parseTargetConfig(value: Prisma.JsonValue): {
  readonly userIds?: string[]
  readonly roleCodes?: string[]
  readonly permissionCode?: string
  readonly targetKeys?: string[]
} {
  const record = asRecord(value)
  if (record === null) {
    return {}
  }
  return {
    ...(Array.isArray(record.userIds) ? { userIds: asStringArray(record.userIds) } : {}),
    ...(Array.isArray(record.roleCodes) ? { roleCodes: asStringArray(record.roleCodes) } : {}),
    ...(typeof record.permissionCode === 'string' ? { permissionCode: record.permissionCode } : {}),
    ...(Array.isArray(record.targetKeys) ? { targetKeys: asStringArray(record.targetKeys) } : {}),
  }
}

function sanitizeVariables(input: Readonly<Record<string, string | number | null>>): Record<string, string | number | null> {
  const entries = Object.entries(input).slice(0, MAX_NOTIFICATION_VARIABLES)
  const result: Record<string, string | number | null> = {}
  for (const [key, value] of entries) {
    result[key] = typeof value === 'string'
      ? value.slice(0, MAX_NOTIFICATION_VARIABLE_LENGTH)
      : typeof value === 'number' && Number.isFinite(value)
        ? value
        : null
  }
  return result
}

/**
 * 内容渲染阶段可传递的内部警告；发布层再映射为 NotificationPublishWarningCode。
 */
type NotificationRenderWarning = 'SENSITIVE_VARIABLE_MASKED' | 'MPNEWS_METADATA_TRUNCATED'

/**
 * 业务侧唯一发布入口。
 *
 * 只写数据库：解析事件渠道配置、收件人、内容与幂等键，创建逻辑通知与站外交付；
 * 不调用企业微信、不做重试。配置或内容问题不抛异常，避免通知问题回滚业务事务。
 * 通知编号是唯一例外：新通知必须在同一事务取得编号，编号域不可用时失败关闭。
 */
@Injectable()
export class SystemNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingGeneratorService,
  ) {}

  async publish(
    command: SystemNotificationPublishCommand,
    options: SystemNotificationPublishOptions = {},
  ): Promise<SystemNotificationPublishResult> {
    const now = options.now ?? new Date()
    const dedupeKey = this.effectiveDedupeKey(command)
    if (options.transaction !== undefined) {
      return this.publishInTransaction(options.transaction, command, now, dedupeKey)
    }
    return this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      return this.publishInTransaction(transaction, command, now, dedupeKey)
    }, { timeout: 30_000 })
  }

  private effectiveDedupeKey(command: SystemNotificationPublishCommand): string {
    const explicit = command.dedupeKey?.trim()
    const raw = `${command.eventType}:${explicit !== undefined && explicit.length > 0
      ? explicit
      : `${command.source.type}:${command.source.id}`}`
    if (raw.length <= MAX_NOTIFICATION_DEDUPE_KEY_LENGTH) {
      return raw
    }
    return `${command.eventType}:${createHash('sha256').update(raw).digest('hex')}`
  }

  private async publishInTransaction(
    transaction: Transaction,
    command: SystemNotificationPublishCommand,
    now: Date,
    dedupeKey: string,
  ): Promise<SystemNotificationPublishResult> {
    const existing = await transaction.notification.findUnique({
      where: { dedupeKey },
      select: { id: true },
    })
    if (existing !== null) {
      return {
        notificationId: existing.id,
        duplicated: true,
        channels: [],
        warnings: [{ code: 'DUPLICATE_IGNORED', message: '同一幂等键已存在通知，未重复入队' }],
      }
    }

    const eventType = (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(command.eventType)
      ? command.eventType
      : null
    const warnings: Array<{ code: NotificationPublishWarningCode, message: string }> = []
    const eventChannels = eventType === null
      ? []
      : await transaction.notificationEventChannel.findMany({
          where: { eventType },
          include: {
            messages: {
              where: { enabled: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        })
    const requestedChannels = command.channels === undefined ? null : new Set(command.channels)
    const selectedEventChannels = eventChannels.filter(channel => channel.enabled
      && (requestedChannels === null || requestedChannels.has(channel.channel)))
    const primaryEventChannel = selectedEventChannels.find(channel => channel.channel === 'WECOM')
    const expiresAt = primaryEventChannel === undefined
      ? null
      : this.resolveExpiresAt(command, primaryEventChannel.ttlSeconds, now)
    const priority = command.priority ?? 'NORMAL'
    const variables = sanitizeVariables(command.variables)

    // 编号与通知同事务：重复通知在入口已返回，不会消耗编号；业务回滚会一并回滚发号。
    const issuance = await this.numbering.generateScopedInTransaction(transaction, {
      consumerCode: NOTIFICATION_NUMBER_CONSUMER_CODE,
      idempotencyKey: hashNotificationNumberIdempotencyKey(dedupeKey),
      requestFingerprint: hashNotificationNumberRequestFingerprint(dedupeKey),
      ruleCode: NOTIFICATION_NUMBER_RULE_CODE,
    })

    const notification = await transaction.notification.create({
      data: {
        eventType: command.eventType,
        notificationNo: issuance.number,
        numberingIssuanceId: issuance.issuanceId,
        sourceType: command.source.type.slice(0, 64),
        sourceId: command.source.id.slice(0, 128),
        dedupeKey,
        priority,
        status: 'PENDING',
        templateKey: (eventType ?? command.eventType).slice(0, 64),
        requestedChannels: selectedEventChannels.map(channel => channel.channel),
        variables,
        expiresAt,
        publishedAt: now,
        requestedByUserId: command.requestedByUserId ?? null,
      },
      select: { id: true },
    })

    if (eventType === null) {
      warnings.push({ code: 'EVENT_NOT_CONFIGURED', message: '事件类型未登记' })
      await this.finishNotification(transaction, notification.id, 'FAILED', now)
      return { notificationId: notification.id, duplicated: false, channels: [], warnings }
    }
    if (selectedEventChannels.length === 0) {
      warnings.push({ code: 'EVENT_NOT_CONFIGURED', message: '事件没有启用的渠道配置' })
      await this.finishNotification(transaction, notification.id, 'FAILED', now)
      return { notificationId: notification.id, duplicated: false, channels: [], warnings }
    }
    if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
      await this.finishNotification(transaction, notification.id, 'EXPIRED', now)
      return { notificationId: notification.id, duplicated: false, channels: [], warnings }
    }

    const channelResults: ResolvedChannelResult[] = []
    for (const channelConfig of selectedEventChannels) {
      if (channelConfig.channel === 'IN_APP') {
        channelResults.push(await this.createInAppItemsFromEventConfig(transaction, {
          notificationId: notification.id,
          channelConfig,
          command,
          variables,
          now,
          warnings,
        }))
        continue
      }
      if (channelConfig.channel === 'WECOM') {
        channelResults.push(await this.createWecomDeliveriesFromEventConfig(transaction, {
          notificationId: notification.id,
          channelConfig,
          command,
          variables,
          now,
          warnings,
        }))
      }
    }

    const [wecomTotal, wecomPending, inboxTotal] = await Promise.all([
      transaction.wecomDelivery.count({ where: { notificationId: notification.id } }),
      transaction.wecomDelivery.count({ where: { notificationId: notification.id, status: 'PENDING' } }),
      transaction.notificationInboxItem.count({ where: { notificationId: notification.id } }),
    ])
    const total = wecomTotal
    const pending = wecomPending
    // 全员关闭时投递与收件箱计数都是 0，按常规规则会被误判为 FAILED；
    // 只有「所有渠道都跳过、且其中至少一个是用户主动关闭」才归为 SKIPPED，
    // 其余全跳过（内容缺失、目标不可用等）仍保留 FAILED 以暴露配置问题。
    const allChannelsSkipped = channelResults.length > 0
      && channelResults.every(result => result.status === 'SKIPPED')
    const mutedByUser = channelResults.some(result => result.skipReason === 'USER_MUTED')
    const status = pending > 0
      ? 'PENDING'
      : total > 0
        ? inboxTotal > 0 ? 'PARTIAL' : 'SKIPPED'
        : allChannelsSkipped && mutedByUser ? 'SKIPPED'
          : inboxTotal > 0 ? 'COMPLETED' : 'FAILED'
    if (status === 'PENDING') {
      await transaction.notification.update({
        where: { id: notification.id },
        data: { status: 'PENDING' },
      })
    }
    else {
      await this.finishNotification(transaction, notification.id, status, now)
    }

    return {
      notificationId: notification.id,
      duplicated: false,
      channels: channelResults,
      warnings,
    }
  }

  /**
   * 新内容模型的站内发布：渠道配置自带唯一 TEXT，不再查模板。
   */
  private async createInAppItemsFromEventConfig(
    transaction: Transaction,
    input: {
      readonly notificationId: string
      readonly channelConfig: EventChannelConfig
      readonly command: SystemNotificationPublishCommand
      readonly variables: Readonly<Record<string, string | number | null>>
      readonly now: Date
      readonly warnings: Array<{ code: NotificationPublishWarningCode, message: string }>
    },
  ): Promise<ResolvedChannelResult> {
    const setting = await transaction.notificationChannelSettings.findUnique({
      where: { channel: 'IN_APP' },
      select: { enabled: true },
    })
    if (setting === null || !setting.enabled) {
      input.warnings.push({ code: 'CHANNEL_NOT_CONFIGURED', message: '站内通知渠道未启用' })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CHANNEL_DISABLED' }
    }
    if (input.channelConfig.targetMode === 'GROUP') {
      input.warnings.push({ code: 'NO_RECIPIENT', message: '站内通知不能使用群目标' })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'TARGET_DISABLED' }
    }
    const messages = input.channelConfig.messages.filter(message => message.enabled)
    if (messages.length !== 1 || messages[0]?.kind !== 'TEXT') {
      input.warnings.push({ code: 'CONTENT_NOT_CONFIGURED', message: '站内通知必须配置且只配置一条文本消息' })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CONTENT_NOT_CONFIGURED' }
    }
    const rendered = this.renderEventTextMessage({
      command: input.command,
      channelConfig: input.channelConfig,
      message: messages[0],
      variables: input.variables,
    })
    if (!rendered.ok) {
      input.warnings.push({ code: 'CONTENT_RENDER_FAILED', message: rendered.message })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CONTENT_NOT_CONFIGURED' }
    }
    if (rendered.warnings.includes('SENSITIVE_VARIABLE_MASKED')) {
      input.warnings.push({ code: 'SENSITIVE_VARIABLE_MASKED', message: '敏感变量已脱敏' })
    }

    const target = input.channelConfig.targetMode === 'COMMAND_TARGET'
      ? input.command.target
      : this.targetFromPolicy(input.channelConfig)
    if (target === null) {
      input.warnings.push({ code: 'NO_RECIPIENT', message: '没有解析到站内收件人' })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'NO_RECIPIENT' }
    }
    const resolvedUserIds = await this.resolveUsers(transaction, target)
    if (resolvedUserIds.length === 0) {
      input.warnings.push({ code: 'NO_RECIPIENT', message: '没有解析到站内收件人' })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'NO_RECIPIENT' }
    }
    const { allowed: userIds, muted } = await this.filterMutedUsers(
      transaction,
      resolvedUserIds,
      input.command.eventType,
      'IN_APP',
    )
    if (muted > 0) {
      input.warnings.push({ code: 'USER_MUTED', message: `${muted} 名收件人已关闭该事件的站内提醒` })
    }
    if (userIds.length === 0) {
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: muted, skipReason: 'USER_MUTED' }
    }

    await transaction.notificationInboxItem.createMany({
      data: userIds.map(userId => ({
        notificationId: input.notificationId,
        userId,
        eventType: input.command.eventType.slice(0, 64),
        templateKey: input.command.eventType.slice(0, 64),
        templateVersion: input.channelConfig.version,
        titleSnapshot: rendered.title,
        bodySnapshot: rendered.content,
        linkUrlSnapshot: rendered.linkUrl,
        createdAt: input.now,
      })),
      skipDuplicates: true,
    })
    return { channel: 'IN_APP', status: 'CREATED', recipientCount: userIds.length, skippedCount: muted }
  }

  /**
   * 新内容模型的企微发布：一个渠道配置只有一种发送方式，内容项物化为通知级
   * 渲染快照与逐收件人/群的投递消息项。阶段一只支持 TEXT；其余类型明确跳过。
   */
  private async createWecomDeliveriesFromEventConfig(
    transaction: Transaction,
    input: {
      readonly notificationId: string
      readonly channelConfig: EventChannelConfig
      readonly command: SystemNotificationPublishCommand
      readonly variables: Readonly<Record<string, string | number | null>>
      readonly now: Date
      readonly warnings: Array<{ code: NotificationPublishWarningCode, message: string }>
    },
  ): Promise<ResolvedChannelResult> {
    const setting = await transaction.notificationChannelSettings.findUnique({
      where: { channel: 'WECOM' },
      select: { enabled: true },
    })
    if (setting === null || !setting.enabled) {
      input.warnings.push({ code: 'CHANNEL_NOT_CONFIGURED', message: '企业微信通知渠道未启用' })
      return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CHANNEL_DISABLED' }
    }

    const messages = input.channelConfig.messages
      .filter(message => message.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder)
    if (messages.length === 0) {
      input.warnings.push({ code: 'CONTENT_NOT_CONFIGURED', message: '企业微信渠道未配置消息内容' })
      return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CONTENT_NOT_CONFIGURED' }
    }
    if (messages.some(message => !['TEXT', 'MARKDOWN', 'MARKDOWN_V2', 'TEXTCARD', 'MPNEWS', 'IMAGE'].includes(message.kind))) {
      input.warnings.push({ code: 'MESSAGE_KIND_NOT_IMPLEMENTED', message: '当前发布链路暂不支持该消息类型' })
      return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'MESSAGE_KIND_NOT_IMPLEMENTED' }
    }

    // 附件和正文业务图片共用同一组 command.media，按渠道消息顺序统一分配。
    const mediaPlan = await this.resolveEventNotificationMedia(transaction, {
      notificationId: input.notificationId,
      eventType: input.command.eventType,
      channelConfig: input.channelConfig,
      messages,
      command: input.command,
      warnings: input.warnings,
    })
    const renderableMessages = messages.filter(message => message.kind !== 'IMAGE')
    const rendered = renderableMessages.map((message) => {
      if (message.kind === 'MPNEWS') {
        return this.renderEventMpnewsMessage({
          command: input.command,
          channelConfig: input.channelConfig,
          message,
          variables: input.variables,
          inlineMedia: mediaPlan.inlineByMessageId.get(message.id) ?? [],
        })
      }
      if (message.kind === 'MARKDOWN' || message.kind === 'MARKDOWN_V2') {
        return this.renderEventMarkdownMessage({
          command: input.command,
          channelConfig: input.channelConfig,
          message,
          variables: input.variables,
        })
      }
      if (message.kind === 'TEXTCARD') {
        return this.renderEventTextcardMessage({
          command: input.command,
          channelConfig: input.channelConfig,
          message,
          variables: input.variables,
        })
      }
      return this.renderEventTextMessage({
        command: input.command,
        channelConfig: input.channelConfig,
        message,
        variables: input.variables,
      })
    })
    const failed = rendered.find(item => !item.ok)
    if (failed !== undefined && !failed.ok) {
      input.warnings.push({ code: 'CONTENT_RENDER_FAILED', message: failed.message })
      return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CONTENT_NOT_CONFIGURED' }
    }
    const renderedItems = rendered.flatMap(item => item.ok ? [item] : [])
    if (renderedItems.some(item => item.warnings.includes('SENSITIVE_VARIABLE_MASKED'))) {
      input.warnings.push({ code: 'SENSITIVE_VARIABLE_MASKED', message: '敏感变量已脱敏' })
    }
    if (renderedItems.some(item => item.warnings.includes('MPNEWS_METADATA_TRUNCATED'))) {
      input.warnings.push({ code: 'MPNEWS_METADATA_TRUNCATED', message: 'mpnews 标题、作者或摘要超过企业微信字节限制，已截断' })
    }
    const summary = renderedItems.map((item) => {
      if (item.kind === 'TEXT') return item.content
      if (item.kind === 'MARKDOWN' || item.kind === 'MARKDOWN_V2') return item.payload.content
      if (item.kind === 'TEXTCARD') return item.payload.title
      if (item.kind === 'MPNEWS') return item.payload.title
      return ''
    }).filter(part => part.length > 0).join('\n\n')

    const targetConfig = asRecord(input.channelConfig.targetConfig)
    const mention = parseWecomMentionConfig(targetConfig?.mention)
    const deliveryBase = {
      notificationId: input.notificationId,
      templateKey: input.command.eventType.slice(0, 64),
      templateVersion: input.channelConfig.version,
      renderedContent: summary,
      nextAttemptAt: input.now,
      mentionMode: mention.mode,
      mentionedCount: 0,
      mentionSkipped: 0,
    }

    let deliveries: Array<{
      id: string
      notificationId: string
      appId: string | null
      transport: 'APP' | 'ROBOT'
      recipientUserId: string | null
      targetId: string | null
      status: 'PENDING' | 'SKIPPED'
      templateKey: string
      templateVersion: number
      renderedContent: string
      nextAttemptAt: Date
      mentionMode: string | null
      mentionedCount: number
      mentionSkipped: number
      failureCode?: string | null
      failureMessage?: string | null
    }>
    if (input.channelConfig.sendMethod === 'ROBOT') {
      const targetKeys = parseTargetConfig(input.channelConfig.targetConfig).targetKeys ?? []
      const targets = targetKeys.length === 0
        ? []
        : await transaction.wecomTarget.findMany({
            where: { key: { in: targetKeys }, enabled: true, internalOnly: true },
            select: { id: true },
          })
      if (targets.length === 0) {
        input.warnings.push({ code: 'NO_RECIPIENT', message: '企业微信群目标不存在、已停用或不是内部群' })
        return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'NO_RECIPIENT' }
      }
      deliveries = targets.map(target => ({
        id: randomUUID(),
        ...deliveryBase,
        appId: null,
        transport: 'ROBOT' as const,
        recipientUserId: null,
        targetId: target.id,
        status: 'PENDING' as const,
      }))
    }
    else {
      if (input.channelConfig.targetMode === 'GROUP') {
        input.warnings.push({ code: 'NO_RECIPIENT', message: '应用消息不能使用群目标' })
        return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'TARGET_DISABLED' }
      }
      const target = input.channelConfig.targetMode === 'COMMAND_TARGET'
        ? input.command.target
        : this.targetFromPolicy(input.channelConfig)
      const resolvedUserIds = target === null ? [] : await this.resolveUsers(transaction, target)
      if (resolvedUserIds.length === 0) {
        input.warnings.push({ code: 'NO_RECIPIENT', message: '没有解析到企业微信收件人' })
        return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'NO_RECIPIENT' }
      }
      const { allowed: userIds, muted } = await this.filterMutedUsers(
        transaction,
        resolvedUserIds,
        input.command.eventType,
        'WECOM',
      )
      if (muted > 0) {
        input.warnings.push({ code: 'USER_MUTED', message: `${muted} 名收件人已关闭该事件的企业微信提醒` })
      }
      if (userIds.length === 0) {
        return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: muted, skipReason: 'USER_MUTED' }
      }
      const app = await this.resolveWecomApp(transaction, input.command.eventType)
      if (app.app === null) {
        input.warnings.push({ code: 'CHANNEL_NOT_CONFIGURED', message: app.reason === 'APP_DISABLED' ? '事件绑定的企业微信应用已停用' : '企业微信默认应用未配置' })
        return {
          channel: 'WECOM',
          status: 'SKIPPED',
          recipientCount: 0,
          skippedCount: muted,
          skipReason: app.reason === 'APP_DISABLED' ? 'APP_DISABLED' : 'APP_NOT_CONFIGURED',
        }
      }
      const appId = app.app.id
      const [bindings, memberships] = await Promise.all([
        transaction.wecomBinding.findMany({
          where: { userId: { in: userIds }, status: 'ACTIVE', verifiedAt: { not: null } },
          select: { userId: true },
        }),
        transaction.wecomAppMembership.findMany({
          where: { appId, userId: { in: userIds }, status: 'ACTIVE', verifiedAt: { not: null } },
          select: { userId: true },
        }),
      ])
      const bound = new Set(bindings.map(binding => binding.userId))
      const inScope = new Set(memberships.map(membership => membership.userId))
      deliveries = userIds.map((userId) => {
        const failureCode = !bound.has(userId)
          ? 'NOT_BOUND'
          : !inScope.has(userId) ? 'NOT_IN_APP_SCOPE' : null
        return {
          id: randomUUID(),
          ...deliveryBase,
          appId,
          transport: 'APP' as const,
          recipientUserId: userId,
          targetId: null,
          status: failureCode === null ? 'PENDING' as const : 'SKIPPED' as const,
          failureCode,
          failureMessage: failureCode === 'NOT_BOUND'
            ? '员工未完成企业微信绑定'
            : failureCode === 'NOT_IN_APP_SCOPE' ? '员工不在该应用可见范围或未验证' : null,
        }
      })
      const skipped = muted + deliveries.filter(delivery => delivery.status === 'SKIPPED').length
      if (skipped >= userIds.length + muted) {
        input.warnings.push({ code: 'NO_RECIPIENT', message: '所有收件人都不满足企业微信绑定或应用可见范围' })
        return {
          channel: 'WECOM',
          status: 'SKIPPED',
          recipientCount: userIds.length,
          skippedCount: skipped,
          skipReason: deliveries.every(delivery => delivery.failureCode === 'NOT_IN_APP_SCOPE') ? 'NOT_IN_APP_SCOPE' : 'NOT_BOUND',
        }
      }
    }

    const renderedRows = renderedItems.map((item, index) => ({
      id: randomUUID(),
      notificationId: input.notificationId,
      channel: 'WECOM' as const,
      sendMethod: input.channelConfig.sendMethod as 'APP' | 'ROBOT',
      sortOrder: index,
      kind: item.kind,
      payloadSnapshot: item.kind === 'TEXT'
        ? {
            title: item.title,
            content: item.content,
            linkUrl: item.linkUrl,
          }
        : item.payload,
      contentHash: createHash('sha256')
        .update(JSON.stringify(item.kind === 'TEXT' ? item.content : item.payload))
        .digest('hex'),
    }))
    if (renderedRows.length > 0) {
      await transaction.notificationRenderedMessage.createMany({ data: renderedRows })
      const inlineRows = renderedRows.flatMap((row, index) => {
        const message = renderableMessages[index]
        if (message?.kind !== 'MPNEWS') {
          return []
        }
        const assignments = mediaPlan.inlineByMessageId.get(message.id) ?? []
        return assignments.map(assignment => ({
          id: randomUUID(),
          renderedMessageId: row.id,
          mediaAssetId: assignment.mediaAssetId,
          role: 'INLINE' as const,
          sourceKey: assignment.sourceKey,
          sortOrder: assignment.slotIndex,
        }))
      })
      if (inlineRows.length > 0) {
        await transaction.notificationRenderedMessageMedia.createMany({ data: inlineRows })
      }
    }
    await transaction.wecomDelivery.createMany({ data: deliveries })
    const sendable = deliveries.filter(delivery => delivery.status === 'PENDING')
    if (sendable.length > 0 && mediaPlan.attachments.length > 0) {
      await transaction.wecomDeliveryMedia.createMany({
        data: sendable.flatMap(delivery => mediaPlan.attachments.map(item => ({
          deliveryId: delivery.id,
          mediaAssetId: item.mediaAssetId,
          sortOrder: item.sortOrder,
          messageSortOrder: item.messageSortOrder,
        }))),
      })
    }
    if (sendable.length > 0 && renderedRows.length > 0) {
      await transaction.notificationDeliveryMessage.createMany({
        data: sendable.flatMap(delivery => renderedRows.map((message, index) => ({
          deliveryId: delivery.id,
          renderedMessageId: message.id,
          sortOrder: index,
          status: 'PENDING' as const,
          nextAttemptAt: input.now,
        }))),
      })
    }
    return {
      channel: 'WECOM',
      status: 'PENDING',
      recipientCount: deliveries.length,
      skippedCount: deliveries.filter(delivery => delivery.status === 'SKIPPED').length,
    }
  }

  /**
   * 按渠道消息 sortOrder 统一裁决 command.media：
   * - MPNEWS 按正文业务图片占位顺序，每个占位消费一张；
   * - IMAGE 项按自身 policy 消费剩余图片；
   * - 被拦下的附件写入 notification_media，正文内联图片由调用方写入 rendered message media。
   */
  private async resolveEventNotificationMedia(
    transaction: Transaction,
    input: {
      readonly notificationId: string
      readonly eventType: string
      readonly channelConfig: { readonly allowSensitive: boolean }
      readonly messages: readonly EventChannelMessage[]
      readonly command: SystemNotificationPublishCommand
      readonly warnings: Array<{ code: NotificationPublishWarningCode, message: string }>
    },
  ): Promise<ResolvedEventMediaPlan> {
    const requested = this.uniqueMediaItems(input.command.media)
    const inlineSlotsByMessageId = new Map<string, readonly string[]>()
    for (const message of input.messages) {
      if (message.kind !== 'MPNEWS') {
        continue
      }
      const content = asRecord(message.payload)?.content
      if (typeof content !== 'string') {
        continue
      }
      const slots = extractMpnewsMediaSourceSlots(content)
      if (slots.length > 0) {
        inlineSlotsByMessageId.set(message.id, slots)
      }
    }
    const totalInlineSlots = [...inlineSlotsByMessageId.values()]
      .reduce((total, slots) => total + slots.length, 0)
    if (requested.length === 0) {
      if (totalInlineSlots > 0) {
        input.warnings.push({
          code: 'MPNEWS_INLINE_MEDIA_SKIPPED',
          message: `${totalInlineSlots} 张正文业务图片未插入：缺少来源图片或资产不可用`,
        })
      }
      return {
        attachments: [],
        inlineByMessageId: new Map(),
      }
    }

    const declaredSources = new Set(
      (notificationEventMediaCapability(input.eventType)?.sources ?? []).map(source => source.key),
    )
    const specs = input.messages.flatMap((message) => {
      if (message.kind !== 'IMAGE') {
        return []
      }
      const policy = parseNotificationImageMediaPolicy(message.mediaPolicy)
      return policy === null ? [] : [{ policy, remaining: policy.maxCount }]
    })
    const hasInlineConsumers = inlineSlotsByMessageId.size > 0
    const queryable = requested
      .map(item => item.assetId)
      .filter(assetId => USER_SUPPLIED_UUID_PATTERN.test(assetId))
    const assets = queryable.length === 0
      ? []
      : await transaction.mediaAsset.findMany({
          where: { id: { in: queryable } },
          select: { id: true, mediaType: true, status: true, deletedAt: true, objectKey: true },
        })
    const assetById = new Map(assets.map(asset => [asset.id, asset]))

    const states = requested.map((item, sortOrder) => {
      let blockedReason: string | null = null
      if (specs.length === 0 && !hasInlineConsumers) {
        blockedReason = 'POLICY_DISABLED'
      }
      else if (!input.channelConfig.allowSensitive) {
        // 图片不能像文本变量一样脱敏；敏感开关关闭时只能整张不发。
        blockedReason = 'SENSITIVE_BLOCKED'
      }
      else if (item.sourceKey !== null && !declaredSources.has(item.sourceKey)) {
        blockedReason = 'SOURCE_NOT_DECLARED'
      }
      else {
        const asset = assetById.get(item.assetId)
        if (asset === undefined) {
          blockedReason = 'ASSET_NOT_FOUND'
        }
        else if (asset.status !== 'READY' || asset.deletedAt !== null || asset.objectKey === null) {
          blockedReason = 'ASSET_NOT_READY'
        }
        else if (asset.mediaType !== 'IMAGE') {
          blockedReason = 'KIND_NOT_ALLOWED'
        }
      }
      return {
        assetId: item.assetId,
        sourceKey: item.sourceKey,
        sortOrder,
        assignedTo: null as 'INLINE' | 'ATTACHMENT' | null,
        attachmentMessageSortOrder: null as number | null,
        blockedReason,
      }
    })

    const inlineByMessageId = new Map<string, NotificationInlineMediaAssignment[]>()
    let skippedInlineCount = 0

    for (const message of input.messages) {
      if (message.kind === 'MPNEWS') {
        const slots = inlineSlotsByMessageId.get(message.id) ?? []
        if (slots.length === 0) {
          continue
        }
        const assignments: NotificationInlineMediaAssignment[] = []
        slots.forEach((sourceKey, slotIndex) => {
          const state = states.find(candidate =>
            candidate.assignedTo === null
            && candidate.blockedReason === null
            && candidate.sourceKey === sourceKey,
          )
          if (state === undefined) {
            skippedInlineCount += 1
            return
          }
          state.assignedTo = 'INLINE'
          assignments.push({
            slotIndex,
            mediaAssetId: state.assetId,
            sourceKey,
          })
        })
        if (assignments.length > 0) {
          inlineByMessageId.set(message.id, assignments)
        }
        continue
      }

      if (message.kind !== 'IMAGE') {
        continue
      }
      const policy = parseNotificationImageMediaPolicy(message.mediaPolicy)
      if (policy === null) {
        continue
      }
      let remaining = policy.maxCount
      for (const state of states) {
        if (remaining <= 0) {
          break
        }
        if (state.assignedTo !== null || state.blockedReason !== null) {
          continue
        }
        if (policy.sourceKeys.length > 0
          && (state.sourceKey === null || !policy.sourceKeys.includes(state.sourceKey))) {
          continue
        }
        state.assignedTo = 'ATTACHMENT'
        state.attachmentMessageSortOrder = message.sortOrder
        remaining -= 1
      }
    }

    const rows: Array<{
      readonly mediaAssetId: string
      readonly sortOrder: number
      readonly sourceKey: string | null
      readonly blockedReason: string | null
    }> = []
    const attachments: NotificationMediaAttachment[] = []
    for (const state of states) {
      if (state.assignedTo === 'INLINE') {
        continue
      }
      if (state.assignedTo === 'ATTACHMENT') {
        attachments.push({
          mediaAssetId: state.assetId,
          sortOrder: state.sortOrder,
          messageSortOrder: state.attachmentMessageSortOrder ?? state.sortOrder,
        })
        rows.push({
          mediaAssetId: state.assetId,
          sortOrder: state.sortOrder,
          sourceKey: state.sourceKey,
          blockedReason: null,
        })
        continue
      }
      const matchingSpecs = specs.filter(spec => spec.policy.sourceKeys.length === 0
        || (state.sourceKey !== null && spec.policy.sourceKeys.includes(state.sourceKey)))
      const blockedReason = state.blockedReason
        ?? (matchingSpecs.length > 0 ? 'LIMIT_EXCEEDED' : 'SOURCE_NOT_SELECTED')
      rows.push({
        mediaAssetId: state.assetId,
        sortOrder: state.sortOrder,
        sourceKey: state.sourceKey,
        blockedReason,
      })
    }

    if (rows.length > 0) {
      await transaction.notificationMedia.createMany({
        data: rows.map(row => ({
          notificationId: input.notificationId,
          mediaAssetId: row.mediaAssetId,
          sortOrder: row.sortOrder,
          sourceKey: row.sourceKey,
          blockedReason: row.blockedReason,
        })),
      })
    }
    const blocked = rows.filter(row => row.blockedReason !== null).length
    if (blocked > 0) {
      input.warnings.push({ code: 'MEDIA_ATTACHMENT_BLOCKED', message: `${blocked} 个附件未发送` })
    }
    if (skippedInlineCount > 0) {
      input.warnings.push({
        code: 'MPNEWS_INLINE_MEDIA_SKIPPED',
        message: `${skippedInlineCount} 张正文业务图片未插入：缺少来源图片或资产不可用`,
      })
    }
    return {
      attachments,
      inlineByMessageId,
    }
  }

  private eventContentAllowedVariables(eventType: string): NotificationTemplateVariable[] {
    const definitions = notificationEventVariableDefinitions(eventType)
    if (definitions === null) {
      return []
    }
    return definitions.map(definition => ({
      name: definition.name,
      required: definition.required,
      maxLength: definition.maxLength,
      sensitive: definition.sensitive,
    }))
  }

  private renderEventTextMessage(input: {
    readonly command: SystemNotificationPublishCommand
    readonly channelConfig: EventChannelConfig
    readonly message: EventChannelMessage
    readonly variables: Readonly<Record<string, string | number | null>>
  }): {
    readonly ok: true
    readonly kind: 'TEXT'
    readonly title: string
    readonly content: string
    readonly linkUrl: string | null
    readonly warnings: readonly NotificationRenderWarning[]
  } | {
    readonly ok: false
    readonly message: string
  } {
    const payload = asRecord(input.message.payload)
    const rawTitle = typeof payload?.title === 'string' ? payload.title : null
    const rawContent = typeof payload?.content === 'string' ? payload.content : ''
    const rawLink = typeof payload?.linkUrl === 'string' ? payload.linkUrl : null
    const allowed = this.eventContentAllowedVariables(input.command.eventType)
    const allowSensitive = input.channelConfig.allowSensitive
    const titleResult = rawTitle !== null && rawTitle.trim().length > 0
      ? renderNotificationTemplate({
          body: rawTitle,
          variables: input.variables,
          allowed,
          allowSensitive,
          maxLength: 200,
        })
      : null
    const bodyResult = renderNotificationTemplate({
      body: rawContent,
      linkUrlTemplate: rawLink,
      variables: input.variables,
      allowed,
      allowSensitive,
      maxLength: 2_000,
    })
    if ((titleResult !== null && !titleResult.ok) || !bodyResult.ok) {
      return {
        ok: false,
        message: !bodyResult.ok
          ? bodyResult.message
          : titleResult !== null && !titleResult.ok ? titleResult.message : '文本内容渲染失败',
      }
    }
    const warnings = new Set<NotificationRenderWarning>()
    if (titleResult?.ok) {
      for (const warning of titleResult.warnings) warnings.add(warning)
    }
    for (const warning of bodyResult.warnings) warnings.add(warning)

    if (input.channelConfig.channel === 'IN_APP') {
      return {
        ok: true,
        kind: 'TEXT',
        title: titleResult?.ok && titleResult.content.trim().length > 0
          ? titleResult.content
          : NOTIFICATION_EVENT_LABELS[input.command.eventType] ?? input.command.eventType,
        content: bodyResult.content,
        linkUrl: bodyResult.linkUrl,
        warnings: [...warnings],
      }
    }

    const title = titleResult?.ok && titleResult.content.trim().length > 0 ? titleResult.content : null
    const content = [
      title,
      bodyResult.content,
      bodyResult.linkUrl,
    ].filter((part): part is string => part !== null && part.length > 0).join('\n')
    if (utf8Bytes(content) > WECOM_DEFAULT_MAX_BYTES) {
      return { ok: false, message: `企业微信文本渲染后 ${utf8Bytes(content)} 字节，超过 ${WECOM_DEFAULT_MAX_BYTES} 字节上限` }
    }
    return {
      ok: true,
      kind: 'TEXT',
      title: title ?? '',
      content,
      linkUrl: bodyResult.linkUrl,
      warnings: [...warnings],
    }
  }

  private renderEventMarkdownMessage(input: {
    readonly command: SystemNotificationPublishCommand
    readonly channelConfig: EventChannelConfig
    readonly message: EventChannelMessage
    readonly variables: Readonly<Record<string, string | number | null>>
  }): {
    readonly ok: true
    readonly kind: 'MARKDOWN' | 'MARKDOWN_V2'
    readonly payload: { readonly content: string }
    readonly warnings: readonly NotificationRenderWarning[]
  } | {
    readonly ok: false
    readonly message: string
  } {
    const payload = asRecord(input.message.payload)
    const rawContent = typeof payload?.content === 'string' ? payload.content : ''
    const allowed = this.eventContentAllowedVariables(input.command.eventType)
    const maxBytes = input.message.kind === 'MARKDOWN_V2' ? 4_096 : 2_048
    const rendered = renderNotificationTemplate({
      body: rawContent,
      variables: input.variables,
      allowed,
      allowSensitive: input.channelConfig.allowSensitive,
      maxLength: maxBytes,
      maxLengthLimit: maxBytes,
      maxBytes,
    })
    if (!rendered.ok) {
      return { ok: false, message: rendered.message }
    }
    return {
      ok: true,
      kind: input.message.kind === 'MARKDOWN_V2' ? 'MARKDOWN_V2' : 'MARKDOWN',
      payload: { content: rendered.content },
      warnings: rendered.warnings,
    }
  }

  private renderEventTextcardMessage(input: {
    readonly command: SystemNotificationPublishCommand
    readonly channelConfig: EventChannelConfig
    readonly message: EventChannelMessage
    readonly variables: Readonly<Record<string, string | number | null>>
  }): {
    readonly ok: true
    readonly kind: 'TEXTCARD'
    readonly payload: {
      readonly title: string
      readonly description: string
      readonly url: string
      readonly btntxt: string | null
    }
    readonly warnings: readonly NotificationRenderWarning[]
  } | {
    readonly ok: false
    readonly message: string
  } {
    const payload = asRecord(input.message.payload)
    const allowed = this.eventContentAllowedVariables(input.command.eventType)
    const allowSensitive = input.channelConfig.allowSensitive
    const title = renderNotificationTemplate({
      body: typeof payload?.title === 'string' ? payload.title : '',
      variables: input.variables,
      allowed,
      allowSensitive,
      maxLength: 128,
      maxBytes: 128,
    })
    const description = renderNotificationTemplate({
      body: typeof payload?.description === 'string' ? payload.description : '',
      variables: input.variables,
      allowed,
      allowSensitive,
      maxLength: 512,
      maxBytes: 512,
    })
    const url = renderNotificationTemplate({
      body: '',
      linkUrlTemplate: typeof payload?.url === 'string' ? payload.url : '',
      variables: input.variables,
      allowed,
      allowSensitive,
      maxLength: 1,
    })
    const btntxt = typeof payload?.btntxt === 'string'
      ? renderNotificationTemplate({
          body: payload.btntxt,
          variables: input.variables,
          allowed,
          allowSensitive,
          maxLength: 16,
          maxBytes: 16,
        })
      : null
    if (!title.ok) return { ok: false, message: title.message }
    if (!description.ok) return { ok: false, message: description.message }
    if (!url.ok) return { ok: false, message: url.message }
    if (btntxt !== null && !btntxt.ok) return { ok: false, message: btntxt.message }
    const renderedUrl = url.linkUrl
    if (renderedUrl === null || !/^https?:\/\//iu.test(renderedUrl)) {
      return { ok: false, message: '文本卡片链接必须是 http/https URL' }
    }
    const warnings = new Set<NotificationRenderWarning>()
    for (const warning of [...title.warnings, ...description.warnings, ...url.warnings, ...(btntxt?.ok ? btntxt.warnings : [])]) {
      warnings.add(warning)
    }
    return {
      ok: true,
      kind: 'TEXTCARD',
      payload: {
        title: title.content,
        description: description.content,
        url: renderedUrl,
        btntxt: btntxt?.ok ? btntxt.content : null,
      },
      warnings: [...warnings],
    }
  }

  private replaceMpnewsInlineMedia(
    content: string,
    assignments: readonly NotificationInlineMediaAssignment[],
  ): string {
    let slotIndex = 0
    return content.replace(
      /<img\b[^>]*\bdata-media-source\s*=\s*["'][^"']+["'][^>]*>/giu,
      (tag) => {
        const assignment = assignments.find(item => item.slotIndex === slotIndex)
        slotIndex += 1
        if (assignment === undefined) {
          return ''
        }
        const withoutSource = tag.replace(/\sdata-media-source\s*=\s*["'][^"']*["']/iu, '')
        return withoutSource.replace(/^<img\b/iu, `<img data-asset-id="${assignment.mediaAssetId}"`)
      },
    )
  }

  private renderEventMpnewsMessage(input: {
    readonly command: SystemNotificationPublishCommand
    readonly channelConfig: EventChannelConfig
    readonly message: EventChannelMessage
    readonly variables: Readonly<Record<string, string | number | null>>
    readonly inlineMedia: readonly NotificationInlineMediaAssignment[]
  }): {
    readonly ok: true
    readonly kind: 'MPNEWS'
    readonly payload: {
      readonly coverAssetId: string
      readonly title: string
      readonly author: string | null
      readonly digest: string | null
      readonly contentSourceUrl: string | null
      readonly content: string
      readonly assetIds: readonly string[]
    }
    readonly warnings: readonly NotificationRenderWarning[]
  } | {
    readonly ok: false
    readonly message: string
  } {
    const payload = asRecord(input.message.payload)
    const cover = asRecord(payload?.cover)
    const coverAssetId = typeof cover?.mediaAssetId === 'string' ? cover.mediaAssetId : ''
    const rawTitle = typeof payload?.title === 'string' ? payload.title : ''
    const rawAuthor = typeof payload?.author === 'string' ? payload.author : null
    const rawDigest = typeof payload?.digest === 'string' ? payload.digest : null
    const rawContentSourceUrl = typeof payload?.contentSourceUrl === 'string' ? payload.contentSourceUrl : null
    const rawContent = typeof payload?.content === 'string' ? payload.content : ''
    const allowed = this.eventContentAllowedVariables(input.command.eventType)
    const allowSensitive = input.channelConfig.allowSensitive

    const title = renderNotificationTemplate({
      body: rawTitle,
      variables: input.variables,
      allowed,
      allowSensitive,
      maxLength: 128,
      maxBytes: 128,
    })
    const author = rawAuthor === null ? null : renderNotificationTemplate({
      body: rawAuthor,
      variables: input.variables,
      allowed,
      allowSensitive,
      maxLength: 64,
      maxBytes: 64,
    })
    const digest = rawDigest === null ? null : renderNotificationTemplate({
      body: rawDigest,
      variables: input.variables,
      allowed,
      allowSensitive,
      maxLength: 512,
      maxBytes: 512,
    })
    const sourceUrl = rawContentSourceUrl === null ? null : renderNotificationTemplate({
      body: '',
      linkUrlTemplate: rawContentSourceUrl,
      variables: input.variables,
      allowed,
      allowSensitive,
      maxLength: 1,
    })
    const resolvedContent = this.replaceMpnewsInlineMedia(rawContent, input.inlineMedia)
    if (extractMpnewsMediaSourceSlots(rawContent).length > 0 && !mpnewsHasStaticTextOutsideImages(resolvedContent)) {
      return { ok: false, message: 'mpnews 正文业务图片缺失后没有静态文字' }
    }
    const content = renderMpnewsHtml({
      html: resolvedContent,
      variables: input.variables,
      allowed,
      allowSensitive,
    })
    if (!title.ok) return { ok: false, message: title.message }
    if (author !== null && !author.ok) return { ok: false, message: author.message }
    if (digest !== null && !digest.ok) return { ok: false, message: digest.message }
    if (sourceUrl !== null && !sourceUrl.ok) return { ok: false, message: sourceUrl.message }
    if (!content.ok) return { ok: false, message: content.message }

    let renderedSourceUrl: string | null = null
    if (sourceUrl !== null) {
      renderedSourceUrl = sourceUrl.linkUrl
      if (renderedSourceUrl === null || !/^https?:\/\//iu.test(renderedSourceUrl)) {
        return { ok: false, message: 'mpnews 阅读原文链接必须是 http/https URL' }
      }
    }
    const warnings = new Set<NotificationRenderWarning>()
    for (const warning of [...title.warnings, ...(author?.ok ? author.warnings : []), ...(digest?.ok ? digest.warnings : []), ...(sourceUrl?.ok ? sourceUrl.warnings : []), ...content.warnings]) {
      warnings.add(warning)
    }
    const metadataTruncated = title.truncated
      || (author !== null && author.ok && author.truncated)
      || (digest !== null && digest.ok && digest.truncated)
    if (metadataTruncated) {
      warnings.add('MPNEWS_METADATA_TRUNCATED')
    }
    const extracted = extractNotificationContentAssetIds({
      kind: 'MPNEWS',
      payload: {
        cover: { mediaAssetId: coverAssetId },
        content: content.content,
      },
    })
    return {
      ok: true,
      kind: 'MPNEWS',
      payload: {
        coverAssetId,
        title: title.content,
        author: author?.ok ? author.content : null,
        digest: digest?.ok ? digest.content : null,
        contentSourceUrl: renderedSourceUrl,
        content: content.content,
        assetIds: extracted.coverAssetId === null
          ? extracted.inlineAssetIds
          : [extracted.coverAssetId, ...extracted.inlineAssetIds],
      },
      warnings: [...warnings],
    }
  }

  private uniqueMediaItems(
    media: readonly { readonly assetId: string, readonly sourceKey?: string }[] | undefined,
  ): Array<{ assetId: string, sourceKey: string | null }> {
    if (media === undefined) {
      return []
    }
    const seen = new Set<string>()
    const result: Array<{ assetId: string, sourceKey: string | null }> = []
    for (const item of media) {
      const assetId = typeof item.assetId === 'string' ? item.assetId.trim() : ''
      if (assetId.length === 0) {
        continue
      }
      const rawSourceKey = typeof item.sourceKey === 'string' ? item.sourceKey.trim() : ''
      const sourceKey = rawSourceKey.length === 0 ? null : rawSourceKey
      const dedupeKey = JSON.stringify([assetId, sourceKey])
      if (seen.has(dedupeKey)) {
        continue
      }
      seen.add(dedupeKey)
      result.push({ assetId, sourceKey })
    }
    return result
  }

  private async resolveWecomApp(
    transaction: Transaction,
    eventType: string,
  ): Promise<{ readonly app: { readonly id: string } | null, readonly reason: 'APP_DISABLED' | 'APP_NOT_CONFIGURED' | null }> {
    const route = await transaction.wecomAppEventRoute.findUnique({
      where: { eventType },
      select: {
        enabled: true,
        app: { select: { id: true, enabled: true, status: true } },
      },
    })
    if (route !== null && route.enabled) {
      if (!route.app.enabled || route.app.status === 'DISABLED') {
        return { app: null, reason: 'APP_DISABLED' }
      }
      return { app: { id: route.app.id }, reason: null }
    }

    const fallback = await transaction.wecomApp.findFirst({
      where: { isDefault: true, enabled: true, status: { not: 'DISABLED' } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    return fallback === null
      ? { app: null, reason: 'APP_NOT_CONFIGURED' }
      : { app: fallback, reason: null }
  }

  private wecomMentionFromPolicy(targetConfig: Prisma.JsonValue): WecomMentionConfig {
    const record = typeof targetConfig === 'object' && targetConfig !== null && !Array.isArray(targetConfig)
      ? targetConfig as Record<string, unknown>
      : null
    return parseWecomMentionConfig(record?.mention)
  }

  /**
   * 个人关闭记录是稀疏表：只查询与本次收件人相交的关闭行。
   * 必须在发布事务内读取，避免用户刚关闭却仍收到本条通知。
   */
  private async filterMutedUsers(
    transaction: Transaction,
    userIds: readonly string[],
    eventType: string,
    channel: NotificationChannel,
  ): Promise<{ readonly allowed: string[], readonly muted: number }> {
    if (userIds.length === 0) {
      return { allowed: [], muted: 0 }
    }
    const rows = await transaction.notificationUserMute.findMany({
      where: { userId: { in: [...userIds] }, eventType, channel },
      select: { userId: true },
    })
    const mutedUserIds = new Set(rows.map(row => row.userId))
    return {
      allowed: userIds.filter(userId => !mutedUserIds.has(userId)),
      muted: mutedUserIds.size,
    }
  }

  private targetFromPolicy(policy: {
    readonly targetMode: 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP'
    readonly targetConfig: Prisma.JsonValue
  }): NotificationTarget | null {
    const config = parseTargetConfig(policy.targetConfig)
    if (policy.targetMode === 'USERS' && config.userIds !== undefined) {
      return { kind: 'USERS', userIds: config.userIds }
    }
    if (policy.targetMode === 'ROLE' && config.roleCodes !== undefined) {
      return { kind: 'ROLE', roleCodes: config.roleCodes }
    }
    if (policy.targetMode === 'PERMISSION' && config.permissionCode !== undefined) {
      return { kind: 'PERMISSION', permissionCode: config.permissionCode }
    }
    return null
  }

  private async resolveUsers(transaction: Transaction, target: NotificationTarget): Promise<string[]> {
    if (target.kind === 'USERS') {
      if (target.userIds.length === 0) {
        return []
      }
      const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "users"
        WHERE "id" IN (${Prisma.join(target.userIds.map(id => Prisma.sql`${id}::uuid`))})
          AND "status" = 'ACTIVE'
      `)
      return rows.map(row => row.id)
    }
    if (target.kind === 'ROLE') {
      if (target.roleCodes.length === 0) {
        return []
      }
      const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT DISTINCT u."id"
        FROM "users" u
        JOIN "user_roles" ur ON ur."user_id" = u."id"
        JOIN "roles" r ON r."id" = ur."role_id"
        WHERE u."status" = 'ACTIVE'
          AND r."code" IN (${Prisma.join(target.roleCodes)})
      `)
      return rows.map(row => row.id)
    }
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT u."id"
      FROM "users" u
      JOIN "user_roles" ur ON ur."user_id" = u."id"
      JOIN "role_permissions" rp ON rp."role_id" = ur."role_id"
      JOIN "permissions" p ON p."id" = rp."permission_id"
      WHERE u."status" = 'ACTIVE' AND p."code" = ${target.permissionCode}
    `)
    return rows.map(row => row.id)
  }

  private resolveExpiresAt(
    command: SystemNotificationPublishCommand,
    ttlSeconds: number | null,
    now: Date,
  ): Date | null {
    const requested = command.expiresAt === undefined ? null : new Date(command.expiresAt)
    if (requested !== null && Number.isFinite(requested.getTime())) {
      return new Date(Math.min(requested.getTime(), now.getTime() + MAX_NOTIFICATION_TTL_SECONDS * 1_000))
    }
    const ttl = ttlSeconds ?? DEFAULT_NOTIFICATION_TTL_SECONDS
    return new Date(now.getTime() + Math.min(Math.max(ttl, 60), MAX_NOTIFICATION_TTL_SECONDS) * 1_000)
  }

  private async finishNotification(
    transaction: Transaction,
    notificationId: string,
    status: 'FAILED' | 'SKIPPED' | 'EXPIRED' | 'CANCELLED' | 'COMPLETED' | 'PARTIAL',
    now: Date,
  ): Promise<void> {
    await transaction.notification.update({
      where: { id: notificationId },
      data: { status, completedAt: now },
    })
  }
}
