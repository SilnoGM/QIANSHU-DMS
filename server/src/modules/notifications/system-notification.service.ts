import { createHash, randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  DISABLED_NOTIFICATION_MEDIA_POLICY,
  parseNotificationMediaPolicy,
} from './notification-media'
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
  NOTIFICATION_EVENT_TYPES,
  notificationEventMediaCapability,
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

function parseTemplateVariables(value: Prisma.JsonValue): NotificationTemplateVariable[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(item => {
    const record = asRecord(item)
    const name = typeof record?.name === 'string' ? record.name : null
    if (name === null) {
      return []
    }
    return [{
      name,
      required: record?.required !== false,
      maxLength: typeof record?.maxLength === 'number' ? record.maxLength : MAX_NOTIFICATION_VARIABLE_LENGTH,
      sensitive: record?.sensitive === true,
    }]
  })
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

function notificationFailureCode(
  code: 'TEMPLATE_VARIABLE_MISSING' | 'TEMPLATE_TOO_LONG',
): NotificationPublishWarningCode {
  return code === 'TEMPLATE_VARIABLE_MISSING' ? 'TEMPLATE_VARIABLE_MISSING' : 'TEMPLATE_NOT_FOUND'
}

/**
 * 业务侧唯一发布入口。
 *
 * 只写数据库：解析事件 × 渠道策略、收件人、模板和幂等键，创建逻辑通知与站外交付；
 * 不调用 GeWe、不做重试。配置或模板问题不抛异常，避免通知问题回滚业务事务。
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
    const policies = eventType === null
      ? []
      : await transaction.notificationChannelPolicy.findMany({
        where: { eventType, enabled: true },
      })
    const requestedChannels = command.channels === undefined ? null : new Set(command.channels)
    const selectedPolicies = requestedChannels === null
      ? policies
      : policies.filter(policy => requestedChannels.has(policy.channel))
    const primaryPolicy = selectedPolicies.find(
      policy => policy.channel === 'ASSISTANT' || policy.channel === 'WECOM',
    ) ?? selectedPolicies[0]
    const expiresAt = primaryPolicy?.channel === 'ASSISTANT' || primaryPolicy?.channel === 'WECOM'
      ? this.resolveExpiresAt(command, primaryPolicy.ttlSeconds, now)
      : null
    // 优先级由事件×渠道策略统一维护，避免业务代码硬编码 HIGH 覆盖管理端配置。
    const priority = primaryPolicy?.priority ?? command.priority ?? 'NORMAL'
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
        templateKey: command.templateKey.slice(0, 64),
        requestedChannels: selectedPolicies.map(policy => policy.channel),
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
    if (selectedPolicies.length === 0) {
      warnings.push({ code: 'EVENT_NOT_CONFIGURED', message: '事件没有启用的渠道策略' })
      await this.finishNotification(transaction, notification.id, 'FAILED', now)
      return { notificationId: notification.id, duplicated: false, channels: [], warnings }
    }
    if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
      await this.finishNotification(transaction, notification.id, 'EXPIRED', now)
      return { notificationId: notification.id, duplicated: false, channels: [], warnings }
    }

    // 附件归属整条通知，与渠道循环分离：被策略拦下的附件也要留痕，供记录页排障。
    const media = await this.prepareNotificationMedia(transaction, {
      notificationId: notification.id,
      command,
      policies: selectedPolicies,
      warnings,
    })

    const channelResults: ResolvedChannelResult[] = []
    for (const policy of selectedPolicies) {
      const templateKey = this.resolveTemplateKey(policy.templateKey, command.templateKey)
      if (policy.channel === 'IN_APP') {
        const channelResult = await this.createInAppItems(transaction, {
          notificationId: notification.id,
          policy,
          templateKey,
          command,
          variables,
          now,
          warnings,
        })
        channelResults.push(channelResult)
        continue
      }
      if (policy.channel === 'WECOM') {
        const channelResult = await this.createWecomDeliveries(transaction, {
          notificationId: notification.id,
          policy,
          templateKey,
          command,
          variables,
          now,
          warnings,
        })
        channelResults.push(channelResult)
        continue
      }
      if (policy.channel !== 'ASSISTANT') {
        warnings.push({ code: 'CHANNEL_NOT_CONFIGURED', message: `渠道 ${String(policy.channel)} 尚未实现` })
        continue
      }

      const setting = await transaction.notificationChannelSettings.findUnique({
        where: { channel: 'ASSISTANT' },
        select: { enabled: true },
      })
      if (setting === null || !setting.enabled) {
        warnings.push({ code: 'CHANNEL_NOT_CONFIGURED', message: '千树小助理渠道未启用' })
        channelResults.push({
          channel: 'ASSISTANT',
          status: 'SKIPPED',
          recipientCount: 0,
          skippedCount: 0,
          skipReason: 'CHANNEL_DISABLED',
        })
        continue
      }

      const template = await transaction.notificationTemplate.findUnique({
        where: { key_channel: { key: templateKey, channel: 'ASSISTANT' } },
      })
      if (template === null || !template.enabled) {
        warnings.push({ code: 'TEMPLATE_NOT_FOUND', message: '站外模板不存在或已停用' })
        await this.finishNotification(transaction, notification.id, 'FAILED', now)
        return { notificationId: notification.id, duplicated: false, channels: channelResults, warnings }
      }

      const render = renderNotificationTemplate({
        body: template.bodyTemplate,
        linkUrlTemplate: template.linkUrlTemplate,
        variables,
        allowed: parseTemplateVariables(template.variables),
        allowSensitive: policy.allowSensitive,
        maxLength: template.maxLength,
      })
      if (!render.ok) {
        warnings.push({ code: notificationFailureCode(render.code), message: render.message })
        await this.finishNotification(transaction, notification.id, 'FAILED', now)
        return { notificationId: notification.id, duplicated: false, channels: channelResults, warnings }
      }
      if (render.warnings.includes('SENSITIVE_VARIABLE_MASKED')) {
        warnings.push({ code: 'SENSITIVE_VARIABLE_MASKED', message: '敏感变量已脱敏' })
      }

      const channelResult = await this.createAssistantDeliveries(transaction, {
        notificationId: notification.id,
        policy,
        templateKey,
        templateVersion: template.version,
        content: render.content,
        media,
        command,
        now,
        warnings,
      })
      channelResults.push(channelResult)
    }

    const [assistantTotal, assistantPending, wecomTotal, wecomPending, inboxTotal] = await Promise.all([
      transaction.assistantDelivery.count({ where: { notificationId: notification.id } }),
      transaction.assistantDelivery.count({
        where: { notificationId: notification.id, status: 'PENDING' },
      }),
      // 兼容只 mock 小助理表的既有单测；真实 Prisma transaction 一定有 wecomDelivery。
      'wecomDelivery' in transaction
        ? transaction.wecomDelivery.count({ where: { notificationId: notification.id } })
        : Promise.resolve(0),
      'wecomDelivery' in transaction
        ? transaction.wecomDelivery.count({ where: { notificationId: notification.id, status: 'PENDING' } })
        : Promise.resolve(0),
      transaction.notificationInboxItem.count({ where: { notificationId: notification.id } }),
    ])
    const total = assistantTotal + wecomTotal
    const pending = assistantPending + wecomPending
    // 全员关闭时投递与收件箱计数都是 0，按常规规则会被误判为 FAILED；
    // 只有「所有渠道都跳过、且其中至少一个是用户主动关闭」才归为 SKIPPED，
    // 其余全跳过（模板缺失、目标不可用等）仍保留 FAILED 以暴露配置问题。
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
   * 渠道策略显式绑定模板时以策略为准；显式绑定但模板不存在时不做回退，
   * 否则配置错误会被命令默认键静默掩盖。
   */
  private resolveTemplateKey(policyKey: string | null, fallbackKey: string): string {
    const trimmed = policyKey?.trim()
    return trimmed !== undefined && trimmed.length > 0 ? trimmed : fallbackKey
  }

  /**
   * 站内渠道在业务事务内写收件箱快照；不依赖 worker、不设置 TTL。
   * 目标解析与站外一致：GROUP 对 IN_APP 非法，其余模式复用同一套用户解析。
   */
  private async createInAppItems(
    transaction: Transaction,
    input: {
      readonly notificationId: string
      readonly policy: {
        readonly targetMode: 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP'
        readonly targetConfig: Prisma.JsonValue
        readonly allowSensitive: boolean
      }
      readonly templateKey: string
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
    if (input.policy.targetMode === 'GROUP') {
      input.warnings.push({ code: 'NO_RECIPIENT', message: '站内通知不能使用群目标' })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'TARGET_DISABLED' }
    }

    const template = await transaction.notificationTemplate.findUnique({
      where: { key_channel: { key: input.templateKey, channel: 'IN_APP' } },
    })
    if (template === null || !template.enabled) {
      input.warnings.push({ code: 'TEMPLATE_NOT_FOUND', message: '站内模板不存在或已停用' })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CHANNEL_NOT_CONFIGURED' }
    }

    const allowed = parseTemplateVariables(template.variables)
    const title = renderNotificationTemplate({
      body: template.titleTemplate?.trim() || template.name,
      variables: input.variables,
      allowed,
      allowSensitive: input.policy.allowSensitive,
      maxLength: 200,
    })
    const body = renderNotificationTemplate({
      body: template.bodyTemplate,
      linkUrlTemplate: template.linkUrlTemplate,
      variables: input.variables,
      allowed,
      allowSensitive: input.policy.allowSensitive,
      maxLength: template.maxLength,
    })
    if (!title.ok || !body.ok) {
      input.warnings.push({
        code: 'TEMPLATE_VARIABLE_MISSING',
        message: !title.ok ? title.message : !body.ok ? body.message : '站内模板渲染失败',
      })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CHANNEL_NOT_CONFIGURED' }
    }
    if (body.warnings.includes('SENSITIVE_VARIABLE_MASKED')) {
      input.warnings.push({ code: 'SENSITIVE_VARIABLE_MASKED', message: '敏感变量已脱敏' })
    }

    const target = input.policy.targetMode === 'COMMAND_TARGET'
      ? input.command.target
      : this.targetFromPolicy(input.policy)
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
        templateKey: input.templateKey,
        templateVersion: template.version,
        titleSnapshot: title.content,
        bodySnapshot: body.content,
        linkUrlSnapshot: body.linkUrl,
        createdAt: input.now,
      })),
      skipDuplicates: true,
    })
    return { channel: 'IN_APP', status: 'CREATED', recipientCount: userIds.length, skippedCount: muted }
  }

  /**
   * 裁决业务附件：模板策略、数量上限、资产状态与敏感开关都在这里统一处理。
   *
   * 被拦下的附件同样写入 `notification_media` 并记录原因；发布本身不抛异常，
   * 保证通知配置问题不会回滚业务事务。
   */
  private async prepareNotificationMedia(
    transaction: Transaction,
    input: {
      readonly notificationId: string
      readonly command: SystemNotificationPublishCommand
      readonly policies: readonly {
        readonly channel: NotificationChannel
        readonly templateKey: string | null
        readonly allowSensitive: boolean
      }[]
      readonly warnings: Array<{ code: NotificationPublishWarningCode, message: string }>
    },
  ): Promise<readonly NotificationMediaAttachment[]> {
    const requested = this.uniqueMediaItems(input.command.media)
    if (requested.length === 0) {
      return []
    }

    const policy = input.policies.find(candidate => candidate.channel === 'ASSISTANT')
    const templateKey = policy === undefined
      ? null
      : this.resolveTemplateKey(policy.templateKey, input.command.templateKey)
    const template = templateKey === null
      ? null
      : await transaction.notificationTemplate.findUnique({
        where: { key_channel: { key: templateKey, channel: 'ASSISTANT' } },
        select: { enabled: true, mediaPolicy: true },
      })
    const mediaPolicy = template !== null && template.enabled
      ? parseNotificationMediaPolicy(template.mediaPolicy)
      : DISABLED_NOTIFICATION_MEDIA_POLICY
    // 来源键必须由事件契约声明；模板再从中挑选真正要发的来源。
    const declaredSources = new Set(
      (notificationEventMediaCapability(input.command.eventType)?.sources ?? []).map(source => source.key),
    )
    const selectedSources = new Set(mediaPolicy.sources)

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

    const rows: Array<NotificationMediaAttachment & {
      readonly sourceKey: string | null
      readonly blockedReason: string | null
    }> = []
    let allowedCount = 0
    requested.forEach((item, sortOrder) => {
      const asset = assetById.get(item.assetId)
      const sourceKey = item.sourceKey
      let blockedReason: string | null = null
      if (policy === undefined || templateKey === null) {
        blockedReason = 'CHANNEL_DISABLED'
      }
      else if (template === null) {
        blockedReason = 'TEMPLATE_NOT_FOUND'
      }
      else if (!template.enabled) {
        blockedReason = 'TEMPLATE_DISABLED'
      }
      else if (!mediaPolicy.enabled) {
        blockedReason = 'POLICY_DISABLED'
      }
      else if (!policy.allowSensitive) {
        // 图片无法像文本变量一样脱敏，敏感内容策略不通过时只能整张不发。
        blockedReason = 'SENSITIVE_BLOCKED'
      }
      else if (sourceKey !== null && (sourceKey.length > 64 || !declaredSources.has(sourceKey))) {
        blockedReason = 'SOURCE_NOT_DECLARED'
      }
      else if (selectedSources.size > 0 && (sourceKey === null || !selectedSources.has(sourceKey))) {
        blockedReason = 'SOURCE_NOT_SELECTED'
      }
      else if (allowedCount >= mediaPolicy.maxCount) {
        blockedReason = 'LIMIT_EXCEEDED'
      }
      else if (asset === undefined) {
        blockedReason = 'ASSET_NOT_FOUND'
      }
      else if (asset.status !== 'READY' || asset.deletedAt !== null || asset.objectKey === null) {
        blockedReason = 'ASSET_NOT_READY'
      }
      else if (!(mediaPolicy.kinds as readonly string[]).includes(asset.mediaType)) {
        blockedReason = 'KIND_NOT_ALLOWED'
      }
      if (blockedReason === null) {
        allowedCount += 1
      }
      rows.push({ mediaAssetId: item.assetId, sortOrder, sourceKey, blockedReason })
    })

    await transaction.notificationMedia.createMany({
      data: rows.map(row => ({
        notificationId: input.notificationId,
        mediaAssetId: row.mediaAssetId,
        sortOrder: row.sortOrder,
        sourceKey: row.sourceKey,
        blockedReason: row.blockedReason,
      })),
    })
    const blocked = rows.filter(row => row.blockedReason !== null).length
    if (blocked > 0) {
      input.warnings.push({ code: 'MEDIA_ATTACHMENT_BLOCKED', message: `${blocked} 个附件未发送` })
    }
    return rows
      .filter(row => row.blockedReason === null)
      .map(row => ({ mediaAssetId: row.mediaAssetId, sortOrder: row.sortOrder }))
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

  /** 只为真正会发送的投递创建附件项；已跳过或未绑定的投递不产生无意义的重试行。 */
  private async createDeliveryMedia(
    transaction: Transaction,
    deliveries: readonly { readonly id: string, readonly status: 'PENDING' | 'SKIPPED' }[],
    media: readonly NotificationMediaAttachment[],
  ): Promise<void> {
    if (media.length === 0) {
      return
    }
    const sendable = deliveries.filter(delivery => delivery.status === 'PENDING')
    if (sendable.length === 0) {
      return
    }
    await transaction.assistantDeliveryMedia.createMany({
      data: sendable.flatMap(delivery => media.map(item => ({
        deliveryId: delivery.id,
        mediaAssetId: item.mediaAssetId,
        sortOrder: item.sortOrder,
      }))),
    })
  }

  /**
   * WECOM 发布分支：模板按字节预算渲染，群目标走机器人，1:1 走事件路由应用。
   *
   * 一期文本路径不创建附件投递；图片在后续增量补齐。模板缺失/超字节只跳过
   * WECOM 渠道，不把其他渠道一起判失败。
   */
  private async createWecomDeliveries(
    transaction: Transaction,
    input: {
      readonly notificationId: string
      readonly policy: {
        readonly targetMode: 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP'
        readonly targetConfig: Prisma.JsonValue
        readonly allowSensitive: boolean
      }
      readonly templateKey: string
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

    const template = await transaction.notificationTemplate.findUnique({
      where: { key_channel: { key: input.templateKey, channel: 'WECOM' } },
    })
    if (template === null || !template.enabled) {
      input.warnings.push({ code: 'TEMPLATE_NOT_FOUND', message: '企业微信模板不存在或已停用' })
      return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CHANNEL_NOT_CONFIGURED' }
    }

    const allowed = parseTemplateVariables(template.variables)
    const title = template.titleTemplate?.trim()
      ? renderNotificationTemplate({
        body: template.titleTemplate,
        variables: input.variables,
        allowed,
        allowSensitive: input.policy.allowSensitive,
        maxLength: 200,
      })
      : null
    const body = renderNotificationTemplate({
      body: template.bodyTemplate,
      linkUrlTemplate: template.linkUrlTemplate,
      variables: input.variables,
      allowed,
      allowSensitive: input.policy.allowSensitive,
      maxLength: template.maxLength,
    })
    if ((title !== null && !title.ok) || !body.ok) {
      input.warnings.push({
        code: 'TEMPLATE_VARIABLE_MISSING',
        message: !body.ok ? body.message : title !== null && !title.ok ? title.message : '企业微信模板渲染失败',
      })
      return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CHANNEL_NOT_CONFIGURED' }
    }
    const content = title !== null && title.content.trim().length > 0
      ? `${title.content}\n${body.content}`
      : body.content
    const maxBytes = template.maxBytes ?? WECOM_DEFAULT_MAX_BYTES
    if (utf8Bytes(content) > maxBytes) {
      input.warnings.push({
        code: 'TEXT_TOO_LONG',
        message: `企业微信模板渲染后 ${utf8Bytes(content)} 字节，超过 ${maxBytes} 字节上限`,
      })
      return { channel: 'WECOM', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'TEXT_TOO_LONG' }
    }
    if (body.warnings.includes('SENSITIVE_VARIABLE_MASKED')) {
      input.warnings.push({ code: 'SENSITIVE_VARIABLE_MASKED', message: '敏感变量已脱敏' })
    }

    const mention = this.wecomMentionFromPolicy(input.policy.targetConfig)

    if (input.policy.targetMode === 'GROUP') {
      const targetKeys = parseTargetConfig(input.policy.targetConfig).targetKeys ?? []
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
      const deliveryRows = targets.map(target => ({
        id: randomUUID(),
        notificationId: input.notificationId,
        appId: null,
        transport: 'ROBOT' as const,
        recipientUserId: null,
        targetId: target.id,
        status: 'PENDING' as const,
        templateKey: input.templateKey,
        templateVersion: template.version,
        renderedContent: content,
        nextAttemptAt: input.now,
        mentionMode: mention.mode,
        mentionedCount: 0,
        mentionSkipped: 0,
      }))
      await transaction.wecomDelivery.createMany({ data: deliveryRows })
      await this.createWecomMediaRows(transaction, {
        notificationId: input.notificationId,
        template,
        policy: input.policy,
        command: input.command,
        deliveries: deliveryRows,
      })
      return { channel: 'WECOM', status: 'PENDING', recipientCount: targets.length, skippedCount: 0 }
    }

    const target = input.policy.targetMode === 'COMMAND_TARGET'
      ? input.command.target
      : this.targetFromPolicy(input.policy)
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
    const deliveries = userIds.map((userId) => {
      const failureCode = !bound.has(userId)
        ? 'NOT_BOUND'
        : !inScope.has(userId) ? 'NOT_IN_APP_SCOPE' : null
      return {
        id: randomUUID(),
        notificationId: input.notificationId,
        appId,
        transport: 'APP' as const,
        recipientUserId: userId,
        targetId: null,
        status: failureCode === null ? 'PENDING' as const : 'SKIPPED' as const,
        templateKey: input.templateKey,
        templateVersion: template.version,
        renderedContent: content,
        nextAttemptAt: input.now,
        mentionMode: null,
        mentionedCount: 0,
        mentionSkipped: 0,
        failureCode,
        failureMessage: failureCode === 'NOT_BOUND'
          ? '员工未完成企业微信绑定'
          : failureCode === 'NOT_IN_APP_SCOPE' ? '员工不在该应用可见范围或未验证' : null,
      }
    })
    await transaction.wecomDelivery.createMany({ data: deliveries })
    await this.createWecomMediaRows(transaction, {
      notificationId: input.notificationId,
      template,
      policy: input.policy,
      command: input.command,
      deliveries,
    })
    const skipped = muted + deliveries.filter(delivery => delivery.status === 'SKIPPED').length
    if (skipped >= userIds.length + muted) {
      const reason = deliveries.every(delivery => delivery.failureCode === 'NOT_IN_APP_SCOPE')
        ? 'NOT_IN_APP_SCOPE'
        : 'NOT_BOUND'
      input.warnings.push({ code: 'NO_RECIPIENT', message: '所有收件人都不满足企业微信绑定或应用可见范围' })
      return { channel: 'WECOM', status: 'SKIPPED', recipientCount: userIds.length, skippedCount: skipped, skipReason: reason }
    }
    return { channel: 'WECOM', status: 'PENDING', recipientCount: userIds.length, skippedCount: skipped }
  }

  private async createWecomMediaRows(
    transaction: Transaction,
    input: {
      readonly notificationId: string
      readonly template: { readonly mediaPolicy: Prisma.JsonValue }
      readonly policy: { readonly allowSensitive: boolean }
      readonly command: SystemNotificationPublishCommand
      readonly deliveries: readonly { readonly id: string, readonly status: 'PENDING' | 'SKIPPED' }[]
    },
  ): Promise<void> {
    const sendable = input.deliveries.filter(delivery => delivery.status === 'PENDING')
    if (sendable.length === 0 || !input.policy.allowSensitive) {
      return
    }
    const mediaPolicy = parseNotificationMediaPolicy(input.template.mediaPolicy)
    if (!mediaPolicy.enabled) {
      return
    }
    const declaredSources = new Set(
      (notificationEventMediaCapability(input.command.eventType)?.sources ?? []).map(source => source.key),
    )
    const selectedSources = new Set(mediaPolicy.sources)
    const rows = await transaction.notificationMedia.findMany({
      where: { notificationId: input.notificationId },
      orderBy: { sortOrder: 'asc' },
      include: {
        mediaAsset: {
          select: {
            mediaType: true,
            status: true,
            deletedAt: true,
            objectKey: true,
          },
        },
      },
    })
    const allowed: Array<{ readonly mediaAssetId: string, readonly sortOrder: number }> = []
    for (const row of rows) {
      if (allowed.length >= mediaPolicy.maxCount) {
        break
      }
      const sourceKey = row.sourceKey
      if (sourceKey !== null && !declaredSources.has(sourceKey)) {
        continue
      }
      if (selectedSources.size > 0 && (sourceKey === null || !selectedSources.has(sourceKey))) {
        continue
      }
      const asset = row.mediaAsset
      if (asset.status !== 'READY' || asset.deletedAt !== null || asset.objectKey === null) {
        continue
      }
      if (!(mediaPolicy.kinds as readonly string[]).includes(asset.mediaType)) {
        continue
      }
      allowed.push({ mediaAssetId: row.mediaAssetId, sortOrder: row.sortOrder })
    }
    if (allowed.length === 0) {
      return
    }
    await transaction.wecomDeliveryMedia.createMany({
      data: sendable.flatMap(delivery => allowed.map(item => ({
        deliveryId: delivery.id,
        mediaAssetId: item.mediaAssetId,
        sortOrder: item.sortOrder,
      }))),
    })
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

  private async createAssistantDeliveries(    transaction: Transaction,
    input: {
      readonly notificationId: string
      readonly policy: {
        readonly targetMode: 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP'
        readonly targetConfig: Prisma.JsonValue
        readonly allowSensitive: boolean
      }
      readonly templateKey: string
      readonly templateVersion: number
      readonly content: string
      readonly media: readonly NotificationMediaAttachment[]
      readonly command: SystemNotificationPublishCommand
      readonly now: Date
      readonly warnings: Array<{ code: NotificationPublishWarningCode, message: string }>
    },
  ): Promise<ResolvedChannelResult> {
    const tx = transaction

    if (input.policy.targetMode === 'GROUP') {
      const targetKeys = parseTargetConfig(input.policy.targetConfig).targetKeys ?? []
      const targets = targetKeys.length === 0
        ? []
        : await tx.assistantTarget.findMany({
          where: { key: { in: targetKeys }, enabled: true },
          select: { id: true, internalOnly: true },
        })
      if (targets.length === 0) {
        input.warnings.push({ code: 'NO_RECIPIENT', message: '群目标不存在或已停用' })
        return { channel: 'ASSISTANT', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'NO_RECIPIENT' }
      }
      const account = await tx.assistantAccount.findFirst({
        where: { enabled: true, appId: { not: { startsWith: 'pending-' } } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      if (account === null) {
        input.warnings.push({ code: 'CHANNEL_NOT_CONFIGURED', message: '没有可用的公司号' })
        return { channel: 'ASSISTANT', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'CHANNEL_DISABLED' }
      }

      const skipped = targets.filter(target => input.policy.allowSensitive && !target.internalOnly).length
      const deliveries = targets.map(target => {
        const sendable = !(input.policy.allowSensitive && !target.internalOnly)
        return {
          id: randomUUID(),
          notificationId: input.notificationId,
          recipientUserId: null,
          targetId: target.id,
          accountId: account.id,
          status: sendable ? 'PENDING' as const : 'SKIPPED' as const,
          failureCode: sendable ? null : 'TARGET_DISABLED',
          failureMessage: sendable ? null : '群未标记为仅内部成员，敏感内容不发送',
          templateKey: input.templateKey,
          templateVersion: input.templateVersion,
          renderedContent: input.content,
          nextAttemptAt: input.now,
        }
      })
      await tx.assistantDelivery.createMany({ data: deliveries })
      await this.createDeliveryMedia(tx, deliveries, input.media)
      if (skipped === targets.length) {
        input.warnings.push({ code: 'NO_RECIPIENT', message: '所有群目标都不允许接收敏感内容' })
        return { channel: 'ASSISTANT', status: 'SKIPPED', recipientCount: targets.length, skippedCount: skipped, skipReason: 'TARGET_DISABLED' }
      }
      return { channel: 'ASSISTANT', status: 'PENDING', recipientCount: targets.length, skippedCount: skipped }
    }

    const target = input.policy.targetMode === 'COMMAND_TARGET'
      ? input.command.target
      : this.targetFromPolicy(input.policy)
    const resolvedUserIds = target === null ? [] : await this.resolveUsers(tx, target)
    if (resolvedUserIds.length === 0) {
      input.warnings.push({ code: 'NO_RECIPIENT', message: '没有解析到收件人' })
      return { channel: 'ASSISTANT', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'NO_RECIPIENT' }
    }
    // 用户关闭优先于绑定检查：关闭者不计入 NOT_BOUND，也不再生成投递行。
    const { allowed: userIds, muted } = await this.filterMutedUsers(
      tx,
      resolvedUserIds,
      input.command.eventType,
      'ASSISTANT',
    )
    if (muted > 0) {
      input.warnings.push({ code: 'USER_MUTED', message: `${muted} 名收件人已关闭该事件的小助理提醒` })
    }
    if (userIds.length === 0) {
      return { channel: 'ASSISTANT', status: 'SKIPPED', recipientCount: 0, skippedCount: muted, skipReason: 'USER_MUTED' }
    }

    const bindings = await tx.assistantBinding.findMany({
      where: {
        userId: { in: userIds },
        status: 'ACTIVE',
        verifiedAt: { not: null },
        account: { enabled: true, appId: { not: { startsWith: 'pending-' } } },
      },
      select: { userId: true, accountId: true },
      orderBy: { boundAt: 'asc' },
    })
    const bindingByUser = new Map<string, string>()
    for (const binding of bindings) {
      if (!bindingByUser.has(binding.userId)) {
        bindingByUser.set(binding.userId, binding.accountId)
      }
    }
    const skipped = userIds.filter(userId => !bindingByUser.has(userId)).length
    const deliveries = userIds.map(userId => {
      const accountId = bindingByUser.get(userId) ?? null
      return {
        id: randomUUID(),
        notificationId: input.notificationId,
        recipientUserId: userId,
        targetId: null,
        accountId,
        status: accountId === null ? 'SKIPPED' as const : 'PENDING' as const,
        failureCode: accountId === null ? 'NOT_BOUND' : null,
        failureMessage: accountId === null ? '员工未完成已验证绑定' : null,
        templateKey: input.templateKey,
        templateVersion: input.templateVersion,
        renderedContent: input.content,
        nextAttemptAt: input.now,
      }
    })
    await tx.assistantDelivery.createMany({ data: deliveries })
    await this.createDeliveryMedia(tx, deliveries, input.media)
    if (skipped === userIds.length) {
      input.warnings.push({ code: 'NO_RECIPIENT', message: '所有收件人都未完成绑定' })
      return { channel: 'ASSISTANT', status: 'SKIPPED', recipientCount: userIds.length, skippedCount: muted + skipped, skipReason: 'NOT_BOUND' }
    }
    return { channel: 'ASSISTANT', status: 'PENDING', recipientCount: userIds.length, skippedCount: muted + skipped }
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
