import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
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
  type NotificationChannel,
  type NotificationPublishWarningCode,
  type NotificationSkipReason,
  type NotificationTarget,
  type SystemNotificationPublishCommand,
  type SystemNotificationPublishOptions,
  type SystemNotificationPublishResult,
} from './notification.types'

type Transaction = Prisma.TransactionClient

interface ResolvedChannelResult {
  readonly channel: NotificationChannel
  readonly status: 'CREATED' | 'PENDING' | 'SKIPPED'
  readonly recipientCount: number
  readonly skippedCount: number
  readonly skipReason?: NotificationSkipReason
}

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
    const primaryPolicy = selectedPolicies.find(policy => policy.channel === 'ASSISTANT') ?? selectedPolicies[0]
    const expiresAt = primaryPolicy?.channel === 'ASSISTANT'
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
        command,
        now,
        warnings,
      })
      channelResults.push(channelResult)
    }

    const total = await transaction.assistantDelivery.count({ where: { notificationId: notification.id } })
    const pending = await transaction.assistantDelivery.count({
      where: { notificationId: notification.id, status: 'PENDING' },
    })
    const inboxTotal = await transaction.notificationInboxItem.count({ where: { notificationId: notification.id } })
    const status = pending > 0
      ? 'PENDING'
      : total > 0
        ? inboxTotal > 0 ? 'PARTIAL' : 'SKIPPED'
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
    const userIds = await this.resolveUsers(transaction, target)
    if (userIds.length === 0) {
      input.warnings.push({ code: 'NO_RECIPIENT', message: '没有解析到站内收件人' })
      return { channel: 'IN_APP', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'NO_RECIPIENT' }
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
    return { channel: 'IN_APP', status: 'CREATED', recipientCount: userIds.length, skippedCount: 0 }
  }

  private async createAssistantDeliveries(
    transaction: Transaction,
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
      await tx.assistantDelivery.createMany({
        data: targets.map(target => ({
          notificationId: input.notificationId,
          recipientUserId: null,
          targetId: target.id,
          accountId: account.id,
          status: input.policy.allowSensitive && !target.internalOnly ? 'SKIPPED' as const : 'PENDING' as const,
          failureCode: input.policy.allowSensitive && !target.internalOnly ? 'TARGET_DISABLED' : null,
          failureMessage: input.policy.allowSensitive && !target.internalOnly ? '群未标记为仅内部成员，敏感内容不发送' : null,
          templateKey: input.templateKey,
          templateVersion: input.templateVersion,
          renderedContent: input.content,
          nextAttemptAt: input.now,
        })),
      })
      if (skipped === targets.length) {
        input.warnings.push({ code: 'NO_RECIPIENT', message: '所有群目标都不允许接收敏感内容' })
        return { channel: 'ASSISTANT', status: 'SKIPPED', recipientCount: targets.length, skippedCount: skipped, skipReason: 'TARGET_DISABLED' }
      }
      return { channel: 'ASSISTANT', status: 'PENDING', recipientCount: targets.length, skippedCount: skipped }
    }

    const target = input.policy.targetMode === 'COMMAND_TARGET'
      ? input.command.target
      : this.targetFromPolicy(input.policy)
    const userIds = target === null ? [] : await this.resolveUsers(tx, target)
    if (userIds.length === 0) {
      input.warnings.push({ code: 'NO_RECIPIENT', message: '没有解析到收件人' })
      return { channel: 'ASSISTANT', status: 'SKIPPED', recipientCount: 0, skippedCount: 0, skipReason: 'NO_RECIPIENT' }
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
    await tx.assistantDelivery.createMany({
      data: userIds.map(userId => {
        const accountId = bindingByUser.get(userId) ?? null
        return {
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
      }),
    })
    if (skipped === userIds.length) {
      input.warnings.push({ code: 'NO_RECIPIENT', message: '所有收件人都未完成绑定' })
      return { channel: 'ASSISTANT', status: 'SKIPPED', recipientCount: userIds.length, skippedCount: skipped, skipReason: 'NOT_BOUND' }
    }
    return { channel: 'ASSISTANT', status: 'PENDING', recipientCount: userIds.length, skippedCount: skipped }
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
