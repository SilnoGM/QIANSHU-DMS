import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { assistantAdminErrorToApiException } from './assistant-admin.errors'
import { parseNotificationQuietHours } from './notification-quiet-hours'
import { inspectNotificationTemplate, renderNotificationTemplate, type NotificationTemplateVariable } from './notification-template.renderer'
import {
  ASSISTANT_TRANSPORT,
  AssistantAdminError,
  IMPLEMENTED_NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_EVENT_DEFAULT_TEMPLATE_KEY,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TEMPLATE_DOMAIN,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_EVENT_VARIABLES,
  notificationEventVariableDefinitions,
  notificationEventVariables,
  type AssistantTransport,
} from './notification.types'
import type {
  NotificationCancelResultDto,
  NotificationChannelPolicyDto,
  NotificationChannelPolicyUpdateDto,
  NotificationEventDto,
  NotificationOverviewDto,
  NotificationRecordDetailDto,
  NotificationRecordDto,
  NotificationRecordOptionsDto,
  NotificationRecordPageDto,
  NotificationRecordQueryDto,
  NotificationTemplateCreateDto,
  NotificationTemplateDto,
  NotificationTemplatePreviewDto,
  NotificationTemplatePreviewResultDto,
  NotificationTemplateUpdateDto,
} from './notification-admin.dto'

export interface NotificationAdminContext {
  readonly actorUserId: string
  readonly requestId: string
}

const TEST_TEXT = '【千树小助理】模板测试：这是一条测试消息，无需处理。'

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

const NOTIFICATION_RECORD_CHANNELS = ['IN_APP', 'ASSISTANT'] as const
type NotificationRecordChannel = (typeof NOTIFICATION_RECORD_CHANNELS)[number]

const RECORD_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

interface InAppRecordCounts {
  readonly total: number
  readonly unread: number
}

type NotificationRecordRow = Prisma.NotificationGetPayload<{
  include: { requestedBy: { select: { displayName: true } } }
}>

function requestedRecordChannels(value: Prisma.JsonValue): NotificationRecordChannel[] {
  if (!Array.isArray(value)) {
    return []
  }
  return NOTIFICATION_RECORD_CHANNELS.filter(channel => value.includes(channel))
}

function recordEventLabel(eventType: string): string {
  return NOTIFICATION_EVENT_LABELS[eventType as keyof typeof NOTIFICATION_EVENT_LABELS] ?? eventType
}

function recordEventDomain(eventType: string): string {
  return NOTIFICATION_EVENT_TEMPLATE_DOMAIN[eventType as keyof typeof NOTIFICATION_EVENT_TEMPLATE_DOMAIN] ?? 'SYSTEM'
}

function resolveRecordChannels(
  value: Prisma.JsonValue,
  inAppCount: number,
  deliveryCounts: Record<string, number>,
): NotificationRecordChannel[] {
  const requested = requestedRecordChannels(value)
  if (requested.length > 0) {
    return requested
  }

  const derived: NotificationRecordChannel[] = []
  if (inAppCount > 0) {
    derived.push('IN_APP')
  }
  if (Object.values(deliveryCounts).some(count => count > 0)) {
    derived.push('ASSISTANT')
  }
  return derived
}

function toRecordDto(
  row: NotificationRecordRow,
  deliveryCounts: Record<string, number>,
  inApp: InAppRecordCounts,
): NotificationRecordDto {
  return {
    id: row.id,
    eventType: row.eventType,
    eventLabel: recordEventLabel(row.eventType),
    domain: recordEventDomain(row.eventType),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    priority: row.priority,
    status: row.status,
    templateKey: row.templateKey,
    expiresAt: iso(row.expiresAt),
    publishedAt: row.publishedAt.toISOString(),
    completedAt: iso(row.completedAt),
    requestedByName: row.requestedBy?.displayName ?? null,
    channels: resolveRecordChannels(row.requestedChannels, inApp.total, deliveryCounts),
    inAppItemCount: inApp.total,
    inAppUnreadCount: inApp.unread,
    deliveryCounts,
  }
}

function templateVariables(value: Prisma.JsonValue): NotificationTemplateVariable[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    if (typeof record.name !== 'string') {
      return []
    }
    return [{
      name: record.name,
      required: record.required !== false,
      maxLength: typeof record.maxLength === 'number' ? record.maxLength : 200,
      sensitive: record.sensitive === true,
    }]
  })
}

function toTemplateDto(template: {
  readonly id: string
  readonly key: string
  readonly channel: string
  readonly name: string
  readonly domain: string
  readonly titleTemplate: string | null
  readonly bodyTemplate: string
  readonly linkUrlTemplate: string | null
  readonly variables: Prisma.JsonValue
  readonly maxLength: number
  readonly enabled: boolean
  readonly version: number
  readonly updatedAt: Date
  readonly updatedBy?: { readonly displayName: string } | null
}): NotificationTemplateDto {
  return {
    id: template.id,
    key: template.key,
    channel: template.channel,
    name: template.name,
    domain: template.domain,
    titleTemplate: template.titleTemplate,
    bodyTemplate: template.bodyTemplate,
    linkUrlTemplate: template.linkUrlTemplate,
    variables: templateVariables(template.variables),
    maxLength: template.maxLength,
    enabled: template.enabled,
    version: template.version,
    updatedAt: template.updatedAt.toISOString(),
    updatedByName: template.updatedBy?.displayName ?? null,
  }
}

function toPolicyDto(policy: {
  readonly id: string
  readonly eventType: string
  readonly channel: string
  readonly targetMode: string
  readonly targetConfig: Prisma.JsonValue
  readonly templateKey: string | null
  readonly priority: string
  readonly ttlSeconds: number | null
  readonly quietHours: Prisma.JsonValue | null
  readonly allowSensitive: boolean
  readonly enabled: boolean
  readonly version: number
  readonly updatedAt: Date
  readonly updatedBy?: { readonly displayName: string } | null
}): NotificationChannelPolicyDto {
  return {
    id: policy.id,
    eventType: policy.eventType,
    channel: policy.channel,
    targetMode: policy.targetMode,
    targetConfig: (policy.targetConfig ?? {}) as Record<string, unknown>,
    templateKey: policy.templateKey,
    priority: policy.priority,
    ttlSeconds: policy.ttlSeconds,
    quietHours: (policy.quietHours ?? null) as Record<string, unknown> | null,
    allowSensitive: policy.allowSensitive,
    enabled: policy.enabled,
    version: policy.version,
    updatedAt: policy.updatedAt.toISOString(),
    updatedByName: policy.updatedBy?.displayName ?? null,
  }
}

@Injectable()
export class NotificationAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
    @Inject(ASSISTANT_TRANSPORT) private readonly transport: AssistantTransport,
  ) {}

  private readonly logger = new Logger(NotificationAdminService.name)

  private mapUpstreamError(error: unknown): never {
    if (error instanceof AssistantAdminError) {
      this.logger.warn(`assistant upstream failed code=${error.code} kind=${error.kind}`)
      throw assistantAdminErrorToApiException(error)
    }
    throw error
  }

  async listTemplates(channel?: string): Promise<NotificationTemplateDto[]> {
    const templates = await this.prisma.notificationTemplate.findMany({
      where: channel === 'IN_APP' || channel === 'ASSISTANT' ? { channel } : {},
      orderBy: [{ key: 'asc' }, { channel: 'asc' }],
      include: { updatedBy: { select: { displayName: true } } },
    })
    return templates.map(toTemplateDto)
  }

  private validateTemplate(input: {
    readonly bodyTemplate: string
    readonly titleTemplate?: string | null
    readonly linkUrlTemplate?: string | null
    readonly variables: readonly { readonly name: string }[]
  }): void {
    const inspected = inspectNotificationTemplate({
      body: input.bodyTemplate,
      titleTemplate: input.titleTemplate ?? null,
      linkUrlTemplate: input.linkUrlTemplate ?? null,
      allowed: input.variables,
    })
    if (inspected.singleBrace.length > 0) {
      throw new ApiException(
        422,
        'NOTIFICATION_TEMPLATE_SINGLE_BRACE',
        `模板占位符必须使用双花括号：${inspected.singleBrace.join('、')}`,
      )
    }
    if (inspected.undeclared.length > 0) {
      throw new ApiException(422, 'NOTIFICATION_TEMPLATE_UNDECLARED_VARIABLE', `模板包含未声明变量：${inspected.undeclared.join('、')}`)
    }
  }

  private async assertTemplateDomainConsistent(
    key: string,
    channel: 'IN_APP' | 'ASSISTANT',
    domain: string,
  ): Promise<void> {
    const other = await this.prisma.notificationTemplate.findFirst({
      where: { key, channel: { not: channel } },
      select: { domain: true },
    })
    if (other !== null && other.domain !== domain) {
      throw new ApiException(422, 'NOTIFICATION_TEMPLATE_DOMAIN_CONFLICT', '同一模板键在不同渠道必须使用同一业务域')
    }
  }

  async createTemplate(context: NotificationAdminContext, input: NotificationTemplateCreateDto): Promise<NotificationTemplateDto> {
    this.validateTemplate(input)
    const domain = input.domain ?? 'SYSTEM'
    await this.assertTemplateDomainConsistent(input.key, input.channel, domain)
    try {
      const created = await this.prisma.$transaction(async transaction => {
        const row = await transaction.notificationTemplate.create({
          data: {
            key: input.key,
            channel: input.channel,
            name: input.name.slice(0, 128),
            domain: domain as 'SALES' | 'PURCHASE' | 'SHIPMENT' | 'FINANCE' | 'INVOICE' | 'RECONCILIATION' | 'SYSTEM',
            titleTemplate: input.titleTemplate ?? null,
            bodyTemplate: input.bodyTemplate,
            linkUrlTemplate: input.linkUrlTemplate ?? null,
            variables: input.variables as unknown as Prisma.InputJsonValue,
            maxLength: input.maxLength ?? 2000,
            enabled: input.enabled ?? true,
            createdByUserId: context.actorUserId,
            updatedByUserId: context.actorUserId,
          },
          include: { updatedBy: { select: { displayName: true } } },
        })
        await this.audit.record(transaction, {
          eventType: 'NOTIFICATION_TEMPLATE_UPDATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'NOTIFICATION_TEMPLATE',
          targetId: row.id,
          metadata: { templateKey: row.key, channel: row.channel, version: row.version },
        })
        return row
      })
      return toTemplateDto(created)
    }
    catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ApiException(409, 'NOTIFICATION_TEMPLATE_EXISTS', '该模板键与渠道已存在')
      }
      throw error
    }
  }

  async updateTemplate(context: NotificationAdminContext, id: string, input: NotificationTemplateUpdateDto): Promise<NotificationTemplateDto> {
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } })
    if (existing === null) {
      throw new ApiException(404, 'NOTIFICATION_TEMPLATE_NOT_FOUND', '模板不存在')
    }
    if (existing.version !== input.expectedVersion) {
      throw new ApiException(409, 'NOTIFICATION_TEMPLATE_STATE_CHANGED', '模板已变化，请刷新后重试')
    }
    if (input.domain !== undefined) {
      await this.assertTemplateDomainConsistent(
        existing.key,
        existing.channel,
        input.domain,
      )
    }
    const bodyTemplate = input.bodyTemplate ?? existing.bodyTemplate
    const titleTemplate = input.titleTemplate !== undefined ? input.titleTemplate : existing.titleTemplate
    const linkUrlTemplate = input.linkUrlTemplate !== undefined ? input.linkUrlTemplate : existing.linkUrlTemplate
    const variables = input.variables ?? templateVariables(existing.variables)
    this.validateTemplate({
      bodyTemplate,
      titleTemplate,
      linkUrlTemplate,
      variables,
    })
    const updated = await this.prisma.$transaction(async transaction => {
      const row = await transaction.notificationTemplate.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.slice(0, 128) } : {}),
          ...(input.domain !== undefined
            ? { domain: input.domain as 'SALES' | 'PURCHASE' | 'SHIPMENT' | 'FINANCE' | 'INVOICE' | 'RECONCILIATION' | 'SYSTEM' }
            : {}),
          ...(input.titleTemplate !== undefined ? { titleTemplate: input.titleTemplate } : {}),
          ...(input.bodyTemplate !== undefined ? { bodyTemplate: input.bodyTemplate } : {}),
          ...(input.linkUrlTemplate !== undefined ? { linkUrlTemplate: input.linkUrlTemplate } : {}),
          ...(input.variables !== undefined ? { variables: input.variables as unknown as Prisma.InputJsonValue } : {}),
          ...(input.maxLength !== undefined ? { maxLength: input.maxLength } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          version: { increment: 1 },
          updatedByUserId: context.actorUserId,
        },
        include: { updatedBy: { select: { displayName: true } } },
      })
      await this.audit.record(transaction, {
        eventType: 'NOTIFICATION_TEMPLATE_UPDATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'NOTIFICATION_TEMPLATE',
        targetId: id,
        metadata: { templateKey: row.key, channel: row.channel, version: row.version },
      })
      return row
    })
    return toTemplateDto(updated)
  }

  async previewTemplate(id: string, input: NotificationTemplatePreviewDto): Promise<NotificationTemplatePreviewResultDto> {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { id } })
    if (template === null) {
      throw new ApiException(404, 'NOTIFICATION_TEMPLATE_NOT_FOUND', '模板不存在')
    }
    const result = renderNotificationTemplate({
      body: template.bodyTemplate,
      linkUrlTemplate: template.linkUrlTemplate,
      variables: input.variables,
      allowed: templateVariables(template.variables),
      allowSensitive: true,
      maxLength: template.maxLength,
    })
    if (!result.ok) {
      throw new ApiException(422, result.code, result.message)
    }
    return {
      content: result.content,
      linkUrl: result.linkUrl,
      truncated: result.truncated,
      warnings: [...result.warnings],
    }
  }

  async testTemplate(id: string, input: NotificationTemplatePreviewDto): Promise<{ accepted: true }> {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { id } })
    if (template === null) {
      throw new ApiException(404, 'NOTIFICATION_TEMPLATE_NOT_FOUND', '模板不存在')
    }
    if (template.channel !== 'ASSISTANT') {
      throw new ApiException(422, 'NOTIFICATION_TEMPLATE_CHANNEL_UNSUPPORTED', '当前只支持测试站外模板')
    }
    const account = await this.prisma.assistantAccount.findFirst({
      where: { enabled: true, appId: { not: { startsWith: 'pending-' } } },
      orderBy: { createdAt: 'asc' },
      select: { appId: true },
    })
    if (account === null) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_UNAVAILABLE', '没有可用的公司号')
    }
    const rendered = renderNotificationTemplate({
      body: template.bodyTemplate,
      linkUrlTemplate: template.linkUrlTemplate,
      variables: input.variables,
      allowed: templateVariables(template.variables),
      allowSensitive: true,
      maxLength: template.maxLength,
    })
    if (!rendered.ok) {
      throw new ApiException(422, rendered.code, rendered.message)
    }
    const result = await this.transport.sendText({
      appId: account.appId,
      toWxid: 'filehelper',
      content: rendered.content || TEST_TEXT,
    })
    if (!result.ok) {
      this.mapUpstreamError(new AssistantAdminError(result.code, result.kind, result.message))
    }
    return { accepted: true }
  }

  /** 事件元数据由服务端常量派生，管理端不再各自维护事件名、变量与默认模板键。 */
  listEvents(): NotificationEventDto[] {
    return NOTIFICATION_EVENT_TYPES.map(eventType => ({
      eventType,
      label: NOTIFICATION_EVENT_LABELS[eventType],
      domain: NOTIFICATION_EVENT_TEMPLATE_DOMAIN[eventType],
      variables: [...(NOTIFICATION_EVENT_VARIABLES[eventType] ?? [])],
      variableDefinitions: [...(notificationEventVariableDefinitions(eventType) ?? [])],
      variablesKnown: notificationEventVariables(eventType) !== null,
      defaultTemplateKey: NOTIFICATION_EVENT_DEFAULT_TEMPLATE_KEY[eventType] ?? null,
      implemented: IMPLEMENTED_NOTIFICATION_EVENT_TYPES.includes(eventType),
    }))
  }

  async listPolicies(eventType?: string, channel?: string): Promise<NotificationChannelPolicyDto[]> {
    const policies = await this.prisma.notificationChannelPolicy.findMany({
      where: {
        ...(eventType !== undefined && eventType.length > 0 ? { eventType } : {}),
        ...(channel === 'IN_APP' || channel === 'ASSISTANT' ? { channel } : {}),
      },
      orderBy: [{ eventType: 'asc' }, { channel: 'asc' }],
      include: { updatedBy: { select: { displayName: true } } },
    })
    return policies.map(toPolicyDto)
  }

  private validatePolicy(channel: 'IN_APP' | 'ASSISTANT', input: NotificationChannelPolicyUpdateDto): void {
    if (channel === 'IN_APP') {
      if (input.targetMode === 'GROUP') {
        throw new ApiException(422, 'NOTIFICATION_POLICY_TARGET_INVALID', '站内通知不支持群目标')
      }
      if (input.ttlSeconds !== undefined && input.ttlSeconds !== null) {
        throw new ApiException(422, 'NOTIFICATION_POLICY_TTL_INVALID', '站内通知不需要站外 TTL')
      }
      if (input.quietHours !== undefined && input.quietHours !== null) {
        throw new ApiException(422, 'NOTIFICATION_POLICY_QUIET_HOURS_INVALID', '站内通知不需要静默时段')
      }
    }
    else {
      if (input.ttlSeconds === undefined || input.ttlSeconds === null) {
        throw new ApiException(422, 'NOTIFICATION_POLICY_TTL_REQUIRED', '千树小助理必须配置站外 TTL')
      }
      if (input.quietHours !== undefined && input.quietHours !== null) {
        const quiet = parseNotificationQuietHours(input.quietHours)
        if (quiet === null || quiet.start === quiet.end) {
          throw new ApiException(422, 'NOTIFICATION_POLICY_QUIET_HOURS_INVALID', '静默时段必须是合法的开始与结束时间')
        }
      }
    }

    const config = input.targetConfig
    const stringArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.length > 0)
    if (input.targetMode === 'USERS' && !stringArray(config.userIds)) {
      throw new ApiException(422, 'NOTIFICATION_POLICY_TARGET_INVALID', 'USERS 目标必须提供 userIds')
    }
    if (input.targetMode === 'ROLE' && !stringArray(config.roleCodes)) {
      throw new ApiException(422, 'NOTIFICATION_POLICY_TARGET_INVALID', 'ROLE 目标必须提供 roleCodes')
    }
    if (input.targetMode === 'PERMISSION' && (typeof config.permissionCode !== 'string' || config.permissionCode.length === 0)) {
      throw new ApiException(422, 'NOTIFICATION_POLICY_TARGET_INVALID', 'PERMISSION 目标必须提供 permissionCode')
    }
    if (input.targetMode === 'GROUP' && !stringArray(config.targetKeys)) {
      throw new ApiException(422, 'NOTIFICATION_POLICY_TARGET_INVALID', 'GROUP 目标必须提供 targetKeys')
    }
  }

  /**
   * 策略显式绑定模板时校验模板存在且占位符属于事件变量。
   * 尚无触发源的事件不登记变量契约，跳过兼容性校验以允许提前配置。
   */
  private async assertPolicyTemplate(
    eventType: string,
    channel: 'IN_APP' | 'ASSISTANT',
    templateKey: string | null | undefined,
  ): Promise<void> {
    const key = templateKey?.trim()
    if (key === undefined || key.length === 0) {
      return
    }
    const template = await this.prisma.notificationTemplate.findUnique({
      where: { key_channel: { key, channel } },
    })
    if (template === null) {
      throw new ApiException(422, 'NOTIFICATION_POLICY_TEMPLATE_NOT_FOUND', '所选模板在该渠道不存在')
    }
    const allowed = notificationEventVariables(eventType)
    if (allowed === null) {
      return
    }
    const inspected = inspectNotificationTemplate({
      body: template.bodyTemplate,
      titleTemplate: template.titleTemplate,
      linkUrlTemplate: template.linkUrlTemplate,
      allowed: templateVariables(template.variables),
    })
    const unsupported = inspected.placeholders.filter(name => !allowed.includes(name))
    if (unsupported.length > 0) {
      throw new ApiException(
        422,
        'NOTIFICATION_POLICY_TEMPLATE_VARIABLES_INVALID',
        `模板占位符超出事件变量范围：${unsupported.join('、')}`,
      )
    }
  }

  async upsertPolicy(
    context: NotificationAdminContext,
    eventType: string,
    channel: 'IN_APP' | 'ASSISTANT',
    input: NotificationChannelPolicyUpdateDto,
  ): Promise<NotificationChannelPolicyDto> {
    if (!(NOTIFICATION_EVENT_TYPES as readonly string[]).includes(eventType)) {
      throw new ApiException(422, 'NOTIFICATION_EVENT_TYPE_INVALID', '事件类型未登记')
    }
    this.validatePolicy(channel, input)
    await this.assertPolicyTemplate(eventType, channel, input.templateKey)
    const existing = await this.prisma.notificationChannelPolicy.findUnique({
      where: { eventType_channel: { eventType, channel } },
    })
    if ((existing?.version ?? 0) !== input.expectedVersion) {
      throw new ApiException(409, 'NOTIFICATION_POLICY_STATE_CHANGED', '策略已变化，请刷新后重试')
    }
    const quietHours = input.quietHours === undefined || input.quietHours === null
      ? Prisma.DbNull
      : input.quietHours as Prisma.InputJsonValue
    const data = {
      targetMode: input.targetMode as 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP',
      targetConfig: input.targetConfig as Prisma.InputJsonValue,
      templateKey: input.templateKey?.trim() || null,
      priority: input.priority as 'NORMAL' | 'HIGH',
      ttlSeconds: input.ttlSeconds ?? null,
      quietHours,
      allowSensitive: input.allowSensitive,
      enabled: input.enabled,
      updatedByUserId: context.actorUserId,
      version: { increment: 1 },
    }
    const saved = await this.prisma.$transaction(async transaction => {
      const row = await transaction.notificationChannelPolicy.upsert({
        where: { eventType_channel: { eventType, channel } },
        update: data,
        create: {
          eventType,
          channel,
          targetMode: data.targetMode,
          targetConfig: data.targetConfig,
          templateKey: data.templateKey,
          priority: data.priority,
          ttlSeconds: data.ttlSeconds,
          quietHours: data.quietHours,
          allowSensitive: data.allowSensitive,
          enabled: data.enabled,
          updatedByUserId: context.actorUserId,
        },
        include: { updatedBy: { select: { displayName: true } } },
      })
      await this.audit.record(transaction, {
        eventType: 'NOTIFICATION_POLICY_UPDATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'NOTIFICATION_CHANNEL_POLICY',
        targetId: row.id,
        metadata: { eventType, channel, version: row.version },
      })
      return row
    })
    return toPolicyDto(saved)
  }

  private async deliveryCounts(notificationIds: readonly string[]): Promise<Map<string, Record<string, number>>> {
    if (notificationIds.length === 0) {
      return new Map()
    }
    const rows = await this.prisma.assistantDelivery.groupBy({
      by: ['notificationId', 'status'],
      where: { notificationId: { in: [...notificationIds] } },
      _count: { _all: true },
    })
    const result = new Map<string, Record<string, number>>()
    for (const row of rows) {
      const counts = result.get(row.notificationId) ?? {}
      counts[row.status] = row._count._all
      result.set(row.notificationId, counts)
    }
    return result
  }

  private async inAppCounts(notificationIds: readonly string[]): Promise<Map<string, InAppRecordCounts>> {
    if (notificationIds.length === 0) {
      return new Map()
    }

    const ids = [...notificationIds]
    const [totals, unread] = await Promise.all([
      this.prisma.notificationInboxItem.groupBy({
        by: ['notificationId'],
        where: { notificationId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.notificationInboxItem.groupBy({
        by: ['notificationId'],
        where: { notificationId: { in: ids }, readAt: null },
        _count: { _all: true },
      }),
    ])
    const unreadById = new Map(unread.map(row => [row.notificationId, row._count._all]))
    return new Map(totals.map(row => [row.notificationId, {
      total: row._count._all,
      unread: unreadById.get(row.notificationId) ?? 0,
    }]))
  }

  listRecordOptions(): NotificationRecordOptionsDto {
    return {
      events: NOTIFICATION_EVENT_TYPES.map(eventType => ({
        eventType,
        label: recordEventLabel(eventType),
        domain: recordEventDomain(eventType),
      })),
    }
  }

  async listRecords(input: NotificationRecordQueryDto): Promise<NotificationRecordPageDto> {
    const publishedFrom = input.publishedFrom === undefined ? null : new Date(input.publishedFrom)
    const publishedTo = input.publishedTo === undefined ? null : new Date(input.publishedTo)
    if (publishedFrom !== null && publishedTo !== null && publishedFrom.getTime() > publishedTo.getTime()) {
      throw new ApiException(422, 'VALIDATION_FAILED', '发布时间范围无效')
    }

    const where: Prisma.NotificationWhereInput = {
      ...(input.eventType !== undefined && input.eventType.length > 0 ? { eventType: input.eventType } : {}),
      ...(input.status !== undefined ? { status: input.status as 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'SKIPPED' | 'EXPIRED' | 'CANCELLED' } : {}),
      ...(input.priority !== undefined ? { priority: input.priority as 'NORMAL' | 'HIGH' } : {}),
      ...(input.channel !== undefined
        ? { requestedChannels: { array_contains: [input.channel] } }
        : {}),
      ...(publishedFrom !== null || publishedTo !== null
        ? {
            publishedAt: {
              ...(publishedFrom === null ? {} : { gte: publishedFrom }),
              ...(publishedTo === null ? {} : { lte: publishedTo }),
            },
          }
        : {}),
    }

    const domainEventTypes = input.domain === undefined
      ? null
      : NOTIFICATION_EVENT_TYPES.filter(eventType => NOTIFICATION_EVENT_TEMPLATE_DOMAIN[eventType] === input.domain)
    if (domainEventTypes !== null) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), {
        eventType: { in: [...domainEventTypes] },
      }]
    }

    const keyword = input.keyword?.trim()
    if (keyword !== undefined && keyword.length > 0) {
      const keywordFilters: Prisma.NotificationWhereInput[] = [
        { sourceId: { contains: keyword, mode: 'insensitive' } },
        { templateKey: { contains: keyword, mode: 'insensitive' } },
        {
          requestedBy: {
            is: { displayName: { contains: keyword, mode: 'insensitive' } },
          },
        },
        {
          deliveries: {
            some: {
              OR: [
                { recipientUser: { is: { displayName: { contains: keyword, mode: 'insensitive' } } } },
                { target: { is: { name: { contains: keyword, mode: 'insensitive' } } } },
                { failureCode: { contains: keyword, mode: 'insensitive' } },
                { failureMessage: { contains: keyword, mode: 'insensitive' } },
              ],
            },
          },
        },
        {
          inboxItems: {
            some: {
              user: { displayName: { contains: keyword, mode: 'insensitive' } },
            },
          },
        },
      ]
      if (RECORD_UUID_PATTERN.test(keyword)) {
        keywordFilters.push({ id: keyword })
      }
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: keywordFilters }]
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        include: { requestedBy: { select: { displayName: true } } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ])
    const ids = rows.map(row => row.id)
    const [deliveryCounts, inAppCounts] = await Promise.all([
      this.deliveryCounts(ids),
      this.inAppCounts(ids),
    ])
    return {
      items: rows.map(row => toRecordDto(
        row,
        deliveryCounts.get(row.id) ?? {},
        inAppCounts.get(row.id) ?? { total: 0, unread: 0 },
      )),
      page: input.page,
      pageSize: input.pageSize,
      total,
    }
  }

  async getRecord(id: string): Promise<NotificationRecordDetailDto> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      include: { requestedBy: { select: { displayName: true } } },
    })
    if (notification === null) {
      throw new ApiException(404, 'NOTIFICATION_RECORD_NOT_FOUND', '通知不存在')
    }
    const [deliveries, inAppCounts] = await Promise.all([
      this.prisma.assistantDelivery.findMany({
        where: { notificationId: id },
        include: {
          recipientUser: { select: { displayName: true } },
          target: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.inAppCounts([id]),
    ])
    const counts: Record<string, number> = {}
    for (const delivery of deliveries) {
      counts[delivery.status] = (counts[delivery.status] ?? 0) + 1
    }
    const record = toRecordDto(
      notification,
      counts,
      inAppCounts.get(id) ?? { total: 0, unread: 0 },
    )
    return {
      ...record,
      deliveries: deliveries.map(delivery => ({
        id: delivery.id,
        recipientName: delivery.recipientUser?.displayName ?? null,
        targetName: delivery.target?.name ?? null,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        templateKey: delivery.templateKey,
        failureCode: delivery.failureCode,
        failureMessage: delivery.failureMessage,
        acceptedAt: iso(delivery.acceptedAt),
      })),
    }
  }

  async cancelRecord(context: NotificationAdminContext, id: string): Promise<NotificationCancelResultDto> {
    const notification = await this.prisma.notification.findUnique({ where: { id }, select: { id: true, status: true } })
    if (notification === null) {
      throw new ApiException(404, 'NOTIFICATION_RECORD_NOT_FOUND', '通知不存在')
    }
    const result = await this.prisma.$transaction(async transaction => {
      const updated = await transaction.assistantDelivery.updateMany({
        where: { notificationId: id, status: 'PENDING' },
        data: { status: 'CANCELLED', failureCode: 'CANCELLED', failureMessage: '管理员取消' },
      })
      const grouped = await transaction.assistantDelivery.groupBy({
        by: ['status'],
        where: { notificationId: id },
        _count: { _all: true },
      })
      const counts = new Map(grouped.map(row => [row.status, row._count._all]))
      const pending = (counts.get('PENDING') ?? 0) + (counts.get('SENDING') ?? 0)
      const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
      const accepted = counts.get('ACCEPTED') ?? 0
      const status = pending > 0
        ? 'PENDING'
        : total === 0
          ? notification.status
          : accepted === total
            ? 'COMPLETED'
            : accepted > 0
              ? 'PARTIAL'
              : (counts.get('CANCELLED') ?? 0) === total
                ? 'CANCELLED'
                : 'FAILED'
      await transaction.notification.update({
        where: { id },
        data: { status, completedAt: status === 'PENDING' ? null : new Date() },
      })
      await this.audit.record(transaction, {
        eventType: 'NOTIFICATION_CANCELLED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'NOTIFICATION',
        targetId: id,
        metadata: { cancelledCount: updated.count },
      })
      return { cancelled: updated.count, status }
    })
    return result
  }

  async overview(): Promise<NotificationOverviewDto> {
    const config = this.configService.get<AssistantConfiguration>('assistant')
    const setting = await this.prisma.notificationChannelSettings.findUnique({ where: { channel: 'ASSISTANT' } })
    const account = await this.prisma.assistantAccount.findFirst({ orderBy: { createdAt: 'asc' } })
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const counts = await this.prisma.notification.groupBy({
      by: ['status'],
      where: { publishedAt: { gte: since } },
      _count: { _all: true },
    })
    const last24Hours: Record<string, number> = {
      PENDING: 0,
      COMPLETED: 0,
      PARTIAL: 0,
      FAILED: 0,
      SKIPPED: 0,
      EXPIRED: 0,
      CANCELLED: 0,
    }
    for (const count of counts) {
      last24Hours[count.status] = count._count._all
    }
    const queue = await this.prisma.assistantDelivery.aggregate({
      where: { status: 'PENDING' },
      _count: { _all: true },
      _min: { nextAttemptAt: true },
    })
    return {
      channelEnabled: setting?.enabled ?? false,
      tokenConfigured: config?.token !== null && config?.token !== undefined,
      accountName: account?.name ?? null,
      accountStatus: account?.status ?? null,
      lastOnlineAt: iso(account?.lastOnlineAt ?? null),
      last24Hours,
      queue: {
        pending: queue._count._all,
        oldestNextAttemptAt: iso(queue._min.nextAttemptAt ?? null),
      },
    }
  }
}
