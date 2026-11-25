import { Inject, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { parseNotificationQuietHours } from './notification-quiet-hours'
import { NOTIFICATION_EVENT_TYPES } from './notification.types'
import type {
  WecomAppCreateDto,
  WecomAppDto,
  WecomAppSecretUpdateDto,
  WecomAppTestResultDto,
  WecomAppUpdateDto,
  WecomBindingCreateDto,
  WecomBindingDto,
  WecomBindingVerifyDto,
  WecomChannelDto,
  WecomChannelUpdateDto,
  WecomEventRoutesDto,
  WecomEventRoutesUpdateDto,
  WecomMembershipDto,
  WecomTargetCreateDto,
  WecomTargetDto,
  WecomTargetUpdateDto,
  WecomTestResultDto,
} from './wecom-admin.dto'
import { WecomSecretService } from './wecom-secret.service'
import { WecomTokenService } from './wecom-token.service'
import { normalizeWecomWebhookKey } from './wecom-webhook'
import { WECOM_APP_TRANSPORT, WECOM_ROBOT_TRANSPORT, type WecomAppTransport, type WecomRobotTransport, utf8Bytes } from './wecom.types'

export interface WecomAdminContext {
  readonly actorUserId: string
  readonly requestId: string
}

const TEST_BINDING_CONTENT = '【千树 DMS】企业微信绑定测试：这是一条测试消息，无需处理。'
const TEST_TARGET_CONTENT = '【千树 DMS】企业微信群目标测试：这是一条测试消息，无需处理。'

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

function appStatus(enabled: boolean, current: string): 'PENDING' | 'ACTIVE' | 'INVALID' | 'DISABLED' {
  if (!enabled) {
    return 'DISABLED'
  }
  return current === 'ACTIVE' ? 'ACTIVE' : current === 'INVALID' ? 'INVALID' : 'PENDING'
}

function missingAppConfiguration(app: {
  readonly corpId: string | null
  readonly agentId: number | null
  readonly secretEncrypted: string | null
}): string[] {
  return [
    app.corpId === null ? 'corpId' : null,
    app.agentId === null ? 'agentId' : null,
    app.secretEncrypted === null ? 'Secret' : null,
  ].filter((field): field is string => field !== null)
}

function nextAppStatus(
  current: string,
  currentEnabled: boolean,
  enabled: boolean | undefined,
  connectionChanged: boolean,
): 'PENDING' | 'ACTIVE' | 'INVALID' | 'DISABLED' {
  if (enabled === false) {
    return 'DISABLED'
  }
  if (connectionChanged) {
    return currentEnabled ? 'PENDING' : 'DISABLED'
  }
  if (enabled === true) {
    return appStatus(true, current)
  }
  return current === 'ACTIVE' || current === 'INVALID' || current === 'PENDING' || current === 'DISABLED'
    ? current
    : 'PENDING'
}

@Injectable()
export class WecomAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly secret: WecomSecretService,
    private readonly token: WecomTokenService,
    @Inject(WECOM_APP_TRANSPORT) private readonly appTransport: WecomAppTransport,
    @Inject(WECOM_ROBOT_TRANSPORT) private readonly robotTransport: WecomRobotTransport,
  ) {}

  async getChannel(): Promise<WecomChannelDto> {
    const setting = await this.prisma.notificationChannelSettings.findUnique({
      where: { channel: 'WECOM' },
      include: { updatedBy: { select: { displayName: true } } },
    })
    if (setting === null) {
      throw new ApiException(503, 'WECOM_CHANNEL_NOT_CONFIGURED', '企业微信渠道设置不存在')
    }
    return {
      enabled: setting.enabled,
      defaultQuietHours: (setting.defaultQuietHours as Record<string, unknown> | null) ?? null,
      version: setting.version,
      updatedAt: iso(setting.updatedAt),
      updatedByName: setting.updatedBy?.displayName ?? null,
    }
  }

  async updateChannel(
    context: WecomAdminContext,
    input: WecomChannelUpdateDto,
  ): Promise<WecomChannelDto> {
    const setting = await this.prisma.notificationChannelSettings.findUnique({
      where: { channel: 'WECOM' },
      select: { version: true },
    })
    if (setting === null) {
      throw new ApiException(503, 'WECOM_CHANNEL_NOT_CONFIGURED', '企业微信渠道设置不存在')
    }
    if (setting.version !== input.expectedVersion) {
      throw new ApiException(409, 'WECOM_CHANNEL_STATE_CHANGED', '企业微信渠道设置已变化，请刷新后重试')
    }
    const quietHours = this.normalizeQuietHours(input.defaultQuietHours)
    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.notificationChannelSettings.update({
        where: { channel: 'WECOM' },
        data: {
          enabled: input.enabled,
          ...(quietHours === undefined ? {} : { defaultQuietHours: quietHours }),
          updatedByUserId: context.actorUserId,
          version: { increment: 1 },
        },
      })
      await this.audit.record(transaction, {
        eventType: 'WECOM_CHANNEL_UPDATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'WECOM_CHANNEL',
        targetId: 'WECOM',
        metadata: { enabled: row.enabled, version: row.version },
      })
      return row
    })
    const updatedByName = (await this.prisma.user.findUnique({
      where: { id: context.actorUserId },
      select: { displayName: true },
    }))?.displayName ?? null
    return {
      enabled: updated.enabled,
      defaultQuietHours: (updated.defaultQuietHours as Record<string, unknown> | null) ?? null,
      version: updated.version,
      updatedAt: iso(updated.updatedAt),
      updatedByName,
    }
  }

  async listApps(): Promise<WecomAppDto[]> {
    const apps = await this.prisma.wecomApp.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { eventRoutes: true, memberships: true } } },
    })
    return apps.map(app => this.toAppDto(app))
  }

  async createApp(context: WecomAdminContext, input: WecomAppCreateDto): Promise<WecomAppDto> {
    if (!this.secret.available) {
      throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', '未配置 WECOM_APP_SECRET_KEY，无法保存应用 Secret')
    }
    let secretEncrypted: string
    try {
      secretEncrypted = this.secret.encrypt(input.secret)
    }
    catch {
      throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', 'WECOM_APP_SECRET_KEY 不可用')
    }

    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const count = await transaction.wecomApp.count()
        const isDefault = input.isDefault ?? count === 0
        if (isDefault) {
          await transaction.wecomApp.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          })
        }
        const row = await transaction.wecomApp.create({
          data: {
            key: input.key,
            name: input.name,
            corpId: input.corpId,
            agentId: input.agentId,
            secretEncrypted,
            secretUpdatedAt: new Date(),
            secretUpdatedByUserId: context.actorUserId,
            isDefault,
            enabled: false,
            status: 'PENDING',
          },
          include: { _count: { select: { eventRoutes: true, memberships: true } } },
        })
        if (isDefault) {
          const bindings = await transaction.wecomBinding.findMany({
            where: { status: 'ACTIVE' },
            select: { userId: true },
          })
          if (bindings.length > 0) {
            await transaction.wecomAppMembership.createMany({
              data: bindings.map(binding => ({
                appId: row.id,
                userId: binding.userId,
                status: 'ACTIVE' as const,
                source: 'MANUAL' as const,
              })),
              skipDuplicates: true,
            })
          }
        }
        await this.audit.record(transaction, {
          eventType: 'WECOM_APP_CREATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'WECOM_APP',
          targetId: row.id,
          metadata: { appKey: row.key, agentId: row.agentId ?? 0, isDefault: row.isDefault },
        })
        return row
      })
      return this.toAppDto(created)
    }
    catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ApiException(409, 'WECOM_APP_EXISTS', '应用 key 或 corpId/agentId 已存在')
      }
      throw error
    }
  }

  async updateApp(context: WecomAdminContext, id: string, input: WecomAppUpdateDto): Promise<WecomAppDto> {
    const existing = await this.prisma.wecomApp.findUnique({ where: { id } })
    if (existing === null) {
      throw new ApiException(404, 'WECOM_APP_NOT_FOUND', '企业微信应用不存在')
    }
    if (existing.version !== input.expectedVersion) {
      throw new ApiException(409, 'WECOM_APP_STATE_CHANGED', '企业微信应用已变化，请刷新后重试')
    }
    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        if (input.isDefault === true) {
          await transaction.wecomApp.updateMany({
            where: { isDefault: true, id: { not: id } },
            data: { isDefault: false },
          })
        }
        const row = await transaction.wecomApp.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.corpId !== undefined ? { corpId: input.corpId } : {}),
            ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
            ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...((input.enabled !== undefined || input.corpId !== undefined || input.agentId !== undefined)
              ? {
                  status: nextAppStatus(
                    existing.status,
                    existing.enabled,
                    input.enabled,
                    input.corpId !== undefined || input.agentId !== undefined,
                  ),
                }
              : {}),
            version: { increment: 1 },
          },
          include: { _count: { select: { eventRoutes: true, memberships: true } } },
        })
        await this.audit.record(transaction, {
          eventType: input.enabled === false ? 'WECOM_APP_DISABLED' : 'WECOM_APP_UPDATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'WECOM_APP',
          targetId: id,
          metadata: { appKey: row.key, enabled: row.enabled, version: row.version },
        })
        return row
      })
      if (input.corpId !== undefined || input.agentId !== undefined) {
        this.token.invalidate(existing.key)
      }
      return this.toAppDto(updated)
    }
    catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ApiException(409, 'WECOM_APP_EXISTS', 'corpId/agentId 已被其他应用占用')
      }
      throw error
    }
  }

  async updateAppSecret(context: WecomAdminContext, id: string, input: WecomAppSecretUpdateDto): Promise<WecomAppDto> {
    if (!this.secret.available) {
      throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', '未配置 WECOM_APP_SECRET_KEY，无法保存应用 Secret')
    }
    const existing = await this.prisma.wecomApp.findUnique({ where: { id } })
    if (existing === null) {
      throw new ApiException(404, 'WECOM_APP_NOT_FOUND', '企业微信应用不存在')
    }
    let secretEncrypted: string
    try {
      secretEncrypted = this.secret.encrypt(input.secret)
    }
    catch {
      throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', 'WECOM_APP_SECRET_KEY 不可用')
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.wecomApp.update({
        where: { id },
        data: {
          secretEncrypted,
          secretUpdatedAt: new Date(),
          secretUpdatedByUserId: context.actorUserId,
          status: 'PENDING',
          version: { increment: 1 },
        },
        include: { _count: { select: { eventRoutes: true, memberships: true } } },
      })
      await this.audit.record(transaction, {
        eventType: 'WECOM_APP_SECRET_UPDATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'WECOM_APP',
        targetId: id,
        metadata: { appKey: row.key, version: row.version },
      })
      return row
    })
    this.token.invalidate(existing.key)
    return this.toAppDto(updated)
  }

  async testApp(context: WecomAdminContext, id: string): Promise<WecomAppTestResultDto> {
    const app = await this.prisma.wecomApp.findUnique({ where: { id } })
    if (app === null) {
      throw new ApiException(404, 'WECOM_APP_NOT_FOUND', '企业微信应用不存在')
    }
    if (app.corpId === null || app.agentId === null || app.secretEncrypted === null) {
      throw new ApiException(
        422,
        'WECOM_APP_NOT_CONFIGURED',
        `应用尚未配置 ${missingAppConfiguration(app).join('、')}`,
      )
    }
    let secret: string
    try {
      secret = this.secret.decrypt(app.secretEncrypted)
    }
    catch {
      throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', 'WECOM_APP_SECRET_KEY 不可用')
    }
    const token = await this.token.getAccessToken({ appKey: app.key, corpId: app.corpId, secret })
    if (!token.ok) {
      await this.prisma.wecomApp.update({
        where: { id },
        data: {
          status: 'INVALID',
          lastCheckedAt: new Date(),
          lastErrorCode: token.code.slice(0, 64),
          lastErrorMessage: token.message.slice(0, 255),
        },
      })
      throw new ApiException(422, 'WECOM_APP_TEST_FAILED', token.message)
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.wecomApp.update({
        where: { id },
        data: { status: 'ACTIVE', lastCheckedAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
      })
      await this.audit.record(transaction, {
        eventType: 'WECOM_APP_UPDATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'WECOM_APP',
        targetId: id,
        metadata: { appKey: app.key, action: 'TOKEN_TEST' },
      })
    })
    return { ok: true, status: 'ACTIVE', message: null }
  }

  async getAppEvents(id: string): Promise<WecomEventRoutesDto> {
    const app = await this.prisma.wecomApp.findUnique({
      where: { id },
      select: { id: true, eventRoutes: { select: { eventType: true }, orderBy: { eventType: 'asc' } } },
    })
    if (app === null) {
      throw new ApiException(404, 'WECOM_APP_NOT_FOUND', '企业微信应用不存在')
    }
    return { appId: app.id, eventTypes: app.eventRoutes.map(route => route.eventType) }
  }

  async setAppEvents(
    context: WecomAdminContext,
    id: string,
    input: WecomEventRoutesUpdateDto,
  ): Promise<WecomEventRoutesDto> {
    const app = await this.prisma.wecomApp.findUnique({ where: { id }, select: { id: true, key: true } })
    if (app === null) {
      throw new ApiException(404, 'WECOM_APP_NOT_FOUND', '企业微信应用不存在')
    }
    const eventTypes = [...new Set(input.eventTypes)]
    for (const eventType of eventTypes) {
      if (!(NOTIFICATION_EVENT_TYPES as readonly string[]).includes(eventType)) {
        throw new ApiException(422, 'WECOM_EVENT_TYPE_INVALID', `事件类型未登记：${eventType}`)
      }
    }
    const conflicts = eventTypes.length === 0
      ? []
      : await this.prisma.wecomAppEventRoute.findMany({
        where: { eventType: { in: eventTypes }, appId: { not: id } },
        select: { eventType: true, app: { select: { name: true } } },
      })
    if (conflicts.length > 0) {
      const occupied = conflicts.map(conflict => `${conflict.eventType}（${conflict.app.name}）`).join('、')
      throw new ApiException(409, 'WECOM_EVENT_ROUTE_CONFLICT', `事件已被其他应用占用：${occupied}`)
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.wecomAppEventRoute.deleteMany({
        where: {
          appId: id,
          ...(eventTypes.length === 0 ? {} : { eventType: { notIn: eventTypes } }),
        },
      })
      for (const eventType of eventTypes) {
        await transaction.wecomAppEventRoute.upsert({
          where: { eventType },
          update: { appId: id, enabled: true, updatedByUserId: context.actorUserId },
          create: { appId: id, eventType, enabled: true, updatedByUserId: context.actorUserId },
        })
      }
      await this.audit.record(transaction, {
        eventType: 'WECOM_EVENT_ROUTE_UPDATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'WECOM_APP',
        targetId: id,
        metadata: { appKey: app.key, eventCount: eventTypes.length },
      })
    })
    return { appId: id, eventTypes }
  }

  async listBindings(): Promise<WecomBindingDto[]> {
    const bindings = await this.prisma.wecomBinding.findMany({
      include: { user: { select: { displayName: true, username: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    })
    return bindings.map(binding => ({
      id: binding.id,
      userId: binding.userId,
      userName: binding.user.displayName,
      username: binding.user.username,
      wecomUserId: binding.wecomUserId,
      displayName: binding.displayName,
      status: binding.status,
      verifiedAt: iso(binding.verifiedAt),
      lastTestSentAt: iso(binding.lastTestSentAt),
    }))
  }

  async createBinding(context: WecomAdminContext, input: WecomBindingCreateDto): Promise<WecomBindingDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, displayName: true, username: true, status: true },
    })
    if (user === null || user.status !== 'ACTIVE') {
      throw new ApiException(422, 'WECOM_BINDING_USER_INVALID', '员工不存在或已停用')
    }
    try {
      const binding = await this.prisma.$transaction(async (transaction) => {
        const row = await transaction.wecomBinding.create({
          data: {
            userId: input.userId,
            wecomUserId: input.wecomUserId,
            displayName: input.displayName ?? null,
            boundByUserId: context.actorUserId,
          },
          include: { user: { select: { displayName: true, username: true } } },
        })
        const defaultApp = await transaction.wecomApp.findFirst({
          where: { isDefault: true },
          select: { id: true, key: true },
        })
        if (defaultApp !== null) {
          await transaction.wecomAppMembership.createMany({
            data: [{ appId: defaultApp.id, userId: row.userId, status: 'ACTIVE', source: 'MANUAL' }],
            skipDuplicates: true,
          })
        }
        await this.audit.record(transaction, {
          eventType: 'WECOM_MEMBERSHIP_UPDATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'WECOM_BINDING',
          targetId: row.id,
          metadata: { userId: row.userId, appKey: defaultApp?.key ?? null },
        })
        return row
      })
      return {
        id: binding.id,
        userId: binding.userId,
        userName: binding.user.displayName,
        username: binding.user.username,
        wecomUserId: binding.wecomUserId,
        displayName: binding.displayName,
        status: binding.status,
        verifiedAt: iso(binding.verifiedAt),
        lastTestSentAt: iso(binding.lastTestSentAt),
      }
    }
    catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ApiException(409, 'WECOM_BINDING_EXISTS', '该员工或企业微信 userid 已绑定')
      }
      throw error
    }
  }

  async verifyBinding(
    context: WecomAdminContext,
    id: string,
    input: WecomBindingVerifyDto,
  ): Promise<WecomTestResultDto> {
    const binding = await this.prisma.wecomBinding.findUnique({ where: { id } })
    if (binding === null) {
      throw new ApiException(404, 'WECOM_BINDING_NOT_FOUND', '企业微信绑定不存在')
    }
    const app = await this.prisma.wecomApp.findFirst({
      where: { isDefault: true, enabled: true, status: { not: 'DISABLED' } },
      select: { id: true, key: true, corpId: true, agentId: true, secretEncrypted: true },
    })
    if (app === null || app.corpId === null || app.agentId === null || app.secretEncrypted === null) {
      throw new ApiException(422, 'WECOM_APP_NOT_CONFIGURED', '没有可用的默认企业微信应用')
    }
    const content = (input.content?.trim() || TEST_BINDING_CONTENT).slice(0, 500)
    if (utf8Bytes(content) > 2_048) {
      throw new ApiException(422, 'WECOM_TEST_CONTENT_TOO_LONG', '测试消息超过 2048 字节')
    }
    let secret: string
    try {
      secret = this.secret.decrypt(app.secretEncrypted)
    }
    catch {
      throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', 'WECOM_APP_SECRET_KEY 不可用')
    }
    const token = await this.token.getAccessToken({ appKey: app.key, corpId: app.corpId, secret })
    if (!token.ok) {
      throw new ApiException(422, 'WECOM_APP_TEST_FAILED', token.message)
    }
    const result = await this.appTransport.sendText({
      accessToken: token.accessToken,
      agentId: app.agentId,
      toUser: binding.wecomUserId,
      content,
    })
    if (!result.ok) {
      throw new ApiException(422, 'WECOM_TEST_SEND_FAILED', result.message)
    }
    const now = new Date()
    await this.prisma.$transaction(async (transaction) => {
      await transaction.wecomBinding.update({
        where: { id },
        data: { verifiedAt: now, verifiedByUserId: context.actorUserId, lastTestSentAt: now, status: 'ACTIVE' },
      })
      await transaction.wecomAppMembership.upsert({
        where: { appId_userId: { appId: app.id, userId: binding.userId } },
        update: {
          status: 'ACTIVE',
          verifiedAt: now,
          verifiedByUserId: context.actorUserId,
          lastTestSentAt: now,
        },
        create: {
          appId: app.id,
          userId: binding.userId,
          status: 'ACTIVE',
          source: 'MANUAL',
          verifiedAt: now,
          verifiedByUserId: context.actorUserId,
          lastTestSentAt: now,
        },
      })
      await this.audit.record(transaction, {
        eventType: 'WECOM_MEMBERSHIP_VERIFIED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'WECOM_BINDING',
        targetId: id,
        metadata: { appKey: app.key, userId: binding.userId },
      })
    })
    return { ok: true, message: null }
  }

  async deleteBinding(context: WecomAdminContext, id: string): Promise<void> {
    const binding = await this.prisma.wecomBinding.findUnique({ where: { id }, select: { id: true, userId: true } })
    if (binding === null) {
      throw new ApiException(404, 'WECOM_BINDING_NOT_FOUND', '企业微信绑定不存在')
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.wecomAppMembership.deleteMany({ where: { userId: binding.userId } })
        await transaction.wecomBinding.delete({ where: { id } })
        await this.audit.record(transaction, {
          eventType: 'WECOM_MEMBERSHIP_UPDATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'WECOM_BINDING',
          targetId: id,
          metadata: { userId: binding.userId, action: 'BINDING_DELETED' },
        })
      })
    }
    catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ApiException(409, 'WECOM_BINDING_IN_USE', '该绑定已有投递记录，不能删除；可改为停用')
      }
      throw error
    }
  }

  async listAppMembers(appId: string): Promise<WecomMembershipDto[]> {
    const app = await this.prisma.wecomApp.findUnique({ where: { id: appId }, select: { id: true } })
    if (app === null) {
      throw new ApiException(404, 'WECOM_APP_NOT_FOUND', '企业微信应用不存在')
    }
    const rows = await this.prisma.wecomAppMembership.findMany({
      where: { appId },
      include: { user: { select: { displayName: true, username: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    })
    return rows.map(row => ({
      id: row.id,
      userId: row.userId,
      userName: row.user.displayName,
      username: row.user.username,
      status: row.status,
      source: row.source,
      verifiedAt: iso(row.verifiedAt),
      lastSyncedAt: iso(row.lastSyncedAt),
    }))
  }

  async addAppMember(context: WecomAdminContext, appId: string, userId: string): Promise<WecomMembershipDto> {
    const [app, binding] = await Promise.all([
      this.prisma.wecomApp.findUnique({ where: { id: appId }, select: { id: true, key: true } }),
      this.prisma.wecomBinding.findUnique({
        where: { userId },
        include: { user: { select: { displayName: true, username: true } } },
      }),
    ])
    if (app === null) {
      throw new ApiException(404, 'WECOM_APP_NOT_FOUND', '企业微信应用不存在')
    }
    if (binding === null || binding.status !== 'ACTIVE') {
      throw new ApiException(422, 'WECOM_BINDING_NOT_FOUND', '员工未完成企业微信绑定')
    }
    const row = await this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.wecomAppMembership.upsert({
        where: { appId_userId: { appId, userId } },
        update: { status: 'ACTIVE', source: 'MANUAL' },
        create: { appId, userId, status: 'ACTIVE', source: 'MANUAL' },
        include: { user: { select: { displayName: true, username: true } } },
      })
      await this.audit.record(transaction, {
        eventType: 'WECOM_MEMBERSHIP_UPDATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'WECOM_APP',
        targetId: appId,
        metadata: { appKey: app.key, userId, action: 'MEMBER_ADDED' },
      })
      return membership
    })
    return {
      id: row.id,
      userId: row.userId,
      userName: row.user.displayName,
      username: row.user.username,
      status: row.status,
      source: row.source,
      verifiedAt: iso(row.verifiedAt),
      lastSyncedAt: iso(row.lastSyncedAt),
    }
  }

  async removeAppMember(context: WecomAdminContext, appId: string, userId: string): Promise<void> {
    const app = await this.prisma.wecomApp.findUnique({ where: { id: appId }, select: { id: true, key: true } })
    if (app === null) {
      throw new ApiException(404, 'WECOM_APP_NOT_FOUND', '企业微信应用不存在')
    }
    const removed = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.wecomAppMembership.deleteMany({ where: { appId, userId } })
      await this.audit.record(transaction, {
        eventType: 'WECOM_MEMBERSHIP_UPDATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'WECOM_APP',
        targetId: appId,
        metadata: { appKey: app.key, userId, action: 'MEMBER_REMOVED' },
      })
      return result.count
    })
    if (removed === 0) {
      throw new ApiException(404, 'WECOM_MEMBERSHIP_NOT_FOUND', '该员工不在应用可见范围')
    }
  }

  async listTargets(): Promise<WecomTargetDto[]> {
    const targets = await this.prisma.wecomTarget.findMany({ orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }] })
    return targets.map(target => this.toTargetDto(target))
  }

  async createTarget(context: WecomAdminContext, input: WecomTargetCreateDto): Promise<WecomTargetDto> {
    if (!this.secret.available) {
      throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', '未配置 WECOM_APP_SECRET_KEY，无法保存群 webhook')
    }
    const normalizedWebhook = normalizeWecomWebhookKey(input.webhookKey)
    if (!normalizedWebhook.ok) {
      throw new ApiException(422, 'WECOM_TARGET_WEBHOOK_INVALID', normalizedWebhook.message)
    }
    let webhookKeyEncrypted: string
    try {
      webhookKeyEncrypted = this.secret.encrypt(normalizedWebhook.key)
    }
    catch {
      throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', 'WECOM_APP_SECRET_KEY 不可用')
    }
    try {
      const target = await this.prisma.$transaction(async (transaction) => {
        const row = await transaction.wecomTarget.create({
          data: {
            key: input.key,
            name: input.name,
            purpose: input.purpose ?? null,
            webhookKeyEncrypted,
            internalOnly: true,
            enabled: input.enabled ?? true,
          },
        })
        await this.audit.record(transaction, {
          eventType: 'WECOM_TARGET_CREATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'WECOM_TARGET',
          targetId: row.id,
          metadata: { targetKey: row.key },
        })
        return row
      })
      return this.toTargetDto(target)
    }
    catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ApiException(409, 'WECOM_TARGET_EXISTS', '群目标 key 已存在')
      }
      throw error
    }
  }

  async updateTarget(context: WecomAdminContext, id: string, input: WecomTargetUpdateDto): Promise<WecomTargetDto> {
    const existing = await this.prisma.wecomTarget.findUnique({ where: { id } })
    if (existing === null) {
      throw new ApiException(404, 'WECOM_TARGET_NOT_FOUND', '群目标不存在')
    }
    if (existing.version !== input.expectedVersion) {
      throw new ApiException(409, 'WECOM_TARGET_STATE_CHANGED', '群目标已变化，请刷新后重试')
    }
    let webhookKeyEncrypted: string | undefined
    if (input.webhookKey !== undefined) {
      if (!this.secret.available) {
        throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', '未配置 WECOM_APP_SECRET_KEY，无法保存群 webhook')
      }
      const normalizedWebhook = normalizeWecomWebhookKey(input.webhookKey)
      if (!normalizedWebhook.ok) {
        throw new ApiException(422, 'WECOM_TARGET_WEBHOOK_INVALID', normalizedWebhook.message)
      }
      try {
        webhookKeyEncrypted = this.secret.encrypt(normalizedWebhook.key)
      }
      catch {
        throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', 'WECOM_APP_SECRET_KEY 不可用')
      }
    }
    const target = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.wecomTarget.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(webhookKeyEncrypted !== undefined ? { webhookKeyEncrypted } : {}),
          version: { increment: 1 },
        },
      })
      await this.audit.record(transaction, {
        eventType: 'WECOM_TARGET_UPDATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'WECOM_TARGET',
        targetId: id,
        metadata: { targetKey: row.key, enabled: row.enabled, version: row.version },
      })
      return row
    })
    return this.toTargetDto(target)
  }

  async deleteTarget(context: WecomAdminContext, id: string): Promise<void> {
    const target = await this.prisma.wecomTarget.findUnique({ where: { id }, select: { id: true, key: true } })
    if (target === null) {
      throw new ApiException(404, 'WECOM_TARGET_NOT_FOUND', '群目标不存在')
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.wecomTarget.delete({ where: { id } })
        await this.audit.record(transaction, {
          eventType: 'WECOM_TARGET_UPDATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'WECOM_TARGET',
          targetId: id,
          metadata: { targetKey: target.key, action: 'DELETED' },
        })
      })
    }
    catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ApiException(409, 'WECOM_TARGET_IN_USE', '该群目标已有投递记录，不能删除；可改为停用')
      }
      throw error
    }
  }

  async testTarget(context: WecomAdminContext, id: string): Promise<WecomTestResultDto> {
    const target = await this.prisma.wecomTarget.findUnique({ where: { id } })
    if (target === null) {
      throw new ApiException(404, 'WECOM_TARGET_NOT_FOUND', '群目标不存在')
    }
    let webhookKey: string
    try {
      webhookKey = this.secret.decrypt(target.webhookKeyEncrypted)
    }
    catch {
      throw new ApiException(503, 'WECOM_SECRET_KEY_MISSING', 'WECOM_APP_SECRET_KEY 不可用')
    }
    const result = await this.robotTransport.sendText({
      webhookKey,
      content: TEST_TARGET_CONTENT,
    })
    if (!result.ok) {
      throw new ApiException(422, 'WECOM_TARGET_TEST_FAILED', result.message)
    }
    const now = new Date()
    await this.prisma.$transaction(async (transaction) => {
      await transaction.wecomTarget.update({ where: { id }, data: { lastTestedAt: now } })
      await this.audit.record(transaction, {
        eventType: 'WECOM_TARGET_TESTED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'WECOM_TARGET',
        targetId: id,
        metadata: { targetKey: target.key },
      })
    })
    return { ok: true, message: null }
  }

  private normalizeQuietHours(
    value: Record<string, unknown> | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) {
      return undefined
    }
    if (value === null) {
      return Prisma.JsonNull
    }
    const parsed = parseNotificationQuietHours(value)
    if (parsed === null) {
      throw new ApiException(422, 'WECOM_CHANNEL_QUIET_HOURS_INVALID', '静默时段格式不合法')
    }
    return parsed as unknown as Prisma.InputJsonValue
  }

  private toAppDto(app: {
    readonly id: string
    readonly key: string
    readonly name: string
    readonly corpId: string | null
    readonly agentId: number | null
    readonly isDefault: boolean
    readonly enabled: boolean
    readonly status: string
    readonly secretEncrypted: string | null
    readonly lastCheckedAt: Date | null
    readonly lastErrorCode: string | null
    readonly lastErrorMessage: string | null
    readonly version: number
    readonly updatedAt: Date
    readonly _count: { readonly eventRoutes: number, readonly memberships: number }
  }): WecomAppDto {
    return {
      id: app.id,
      key: app.key,
      name: app.name,
      corpId: app.corpId,
      agentId: app.agentId,
      isDefault: app.isDefault,
      enabled: app.enabled,
      status: app.status,
      hasSecret: app.secretEncrypted !== null,
      lastCheckedAt: iso(app.lastCheckedAt),
      lastErrorCode: app.lastErrorCode,
      lastErrorMessage: app.lastErrorMessage,
      eventCount: app._count.eventRoutes,
      memberCount: app._count.memberships,
      version: app.version,
      updatedAt: app.updatedAt.toISOString(),
    }
  }

  private toTargetDto(target: {
    readonly id: string
    readonly key: string
    readonly name: string
    readonly purpose: string | null
    readonly enabled: boolean
    readonly internalOnly: boolean
    readonly lastTestedAt: Date | null
    readonly version: number
    readonly updatedAt: Date
  }): WecomTargetDto {
    return {
      id: target.id,
      key: target.key,
      name: target.name,
      purpose: target.purpose,
      enabled: target.enabled,
      internalOnly: target.internalOnly,
      lastTestedAt: iso(target.lastTestedAt),
      version: target.version,
      updatedAt: target.updatedAt.toISOString(),
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
  }
}
