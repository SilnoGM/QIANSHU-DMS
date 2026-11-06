import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  ASSISTANT_ADMIN_TRANSPORT,
  ASSISTANT_TRANSPORT,
  AssistantAdminError,
  type AssistantAdminTransport,
  type AssistantTransport,
} from './notification.types'
import type {
  AssistantAccountCreateDto,
  AssistantAccountDto,
  AssistantAccountUpdateDto,
  AssistantBindingCreateDto,
  AssistantBindingDto,
  AssistantBindingPageDto,
  AssistantBindingQueryDto,
  AssistantChannelDto,
  AssistantChannelUpdateDto,
  AssistantContactDto,
  AssistantLoginQrDto,
  AssistantLoginStatusDto,
  AssistantTargetDto,
  AssistantTargetUpdateDto,
} from './assistant-admin.dto'

export interface AssistantAdminContext {
  readonly actorUserId: string
  readonly requestId: string
}

const TEST_TEXT = '【千树小助理】通道自检：这是一条测试消息，无需处理。'
const VERIFY_TEXT = '【千树小助理】绑定验证：这是一条测试消息，请确认已收到。'

function maskWxid(wxid: string | null): string | null {
  if (wxid === null || wxid.length <= 4) {
    return wxid === null ? null : '****'
  }
  return `${wxid.slice(0, 4)}****${wxid.slice(-4)}`
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

@Injectable()
export class AssistantAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
    @Inject(ASSISTANT_TRANSPORT) private readonly transport: AssistantTransport,
    @Inject(ASSISTANT_ADMIN_TRANSPORT) private readonly adminTransport: AssistantAdminTransport,
  ) {}

  private mapUpstreamError(error: unknown): never {
    if (error instanceof AssistantAdminError) {
      if (error.code === 'ASSISTANT_TOKEN_MISSING') {
        throw new ApiException(503, 'ASSISTANT_NOT_CONFIGURED', '千树小助理未配置')
      }
      throw new ApiException(503, 'ASSISTANT_UPSTREAM_UNAVAILABLE', '千树小助理服务暂时不可用')
    }
    throw error
  }

  private async requireAccount(id: string) {
    const account = await this.prisma.assistantAccount.findUnique({ where: { id } })
    if (account === null) {
      throw new ApiException(404, 'ASSISTANT_ACCOUNT_NOT_FOUND', '公司号不存在')
    }
    return account
  }

  async getChannel(): Promise<AssistantChannelDto> {
    const setting = await this.prisma.notificationChannelSettings.findUnique({ where: { channel: 'ASSISTANT' } })
    const config = this.configService.get<AssistantConfiguration>('assistant')
    return {
      enabled: setting?.enabled ?? false,
      tokenConfigured: config?.token !== null && config?.token !== undefined,
      defaultQuietHours: (setting?.defaultQuietHours as Record<string, unknown> | null | undefined) ?? null,
      version: setting?.version ?? 1,
    }
  }

  async updateChannel(context: AssistantAdminContext, input: AssistantChannelUpdateDto): Promise<AssistantChannelDto> {
    await this.prisma.$transaction(async transaction => {
      const updated = await transaction.notificationChannelSettings.updateMany({
        where: { channel: 'ASSISTANT', version: input.expectedVersion },
        data: {
          enabled: input.enabled,
          ...(input.defaultQuietHours !== undefined ? { defaultQuietHours: input.defaultQuietHours as Prisma.InputJsonValue } : {}),
          version: { increment: 1 },
          updatedByUserId: context.actorUserId,
        },
      })
      if (updated.count === 0) {
        throw new ApiException(409, 'ASSISTANT_CHANNEL_STATE_CHANGED', '渠道配置已变化，请刷新后重试')
      }
      await this.audit.record(transaction, {
        eventType: input.enabled ? 'ASSISTANT_CHANNEL_ENABLED' : 'ASSISTANT_CHANNEL_DISABLED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'ASSISTANT_CHANNEL',
        targetId: 'ASSISTANT',
        metadata: { enabled: input.enabled },
      })
    })
    return this.getChannel()
  }

  async testChannel(): Promise<{ accepted: true }> {
    const account = await this.prisma.assistantAccount.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
      select: { appId: true },
    })
    if (account === null) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_UNAVAILABLE', '没有可用的公司号')
    }
    const result = await this.transport.sendText({ appId: account.appId, toWxid: 'filehelper', content: TEST_TEXT })
    if (!result.ok) {
      throw new ApiException(503, 'ASSISTANT_UPSTREAM_UNAVAILABLE', '千树小助理服务暂时不可用')
    }
    return { accepted: true }
  }

  async listAccounts(): Promise<AssistantAccountDto[]> {
    const accounts = await this.prisma.assistantAccount.findMany({ orderBy: { createdAt: 'asc' } })
    return accounts.map(account => ({
      id: account.id,
      name: account.name,
      appId: account.appId,
      wxidMasked: maskWxid(account.wxid),
      nickname: account.nickname,
      avatarUrl: account.avatarUrl,
      status: account.status,
      enabled: account.enabled,
      lastOnlineAt: iso(account.lastOnlineAt),
      lastLoginAt: iso(account.lastLoginAt),
      version: account.version,
    }))
  }

  async createAccount(input: AssistantAccountCreateDto): Promise<AssistantAccountDto> {
    const account = await this.prisma.assistantAccount.create({
      data: {
        name: input.name.slice(0, 64),
        appId: `pending-${randomUUID()}`,
        regionId: input.regionId.slice(0, 16),
        status: 'REQUIRES_LOGIN',
        enabled: false,
      },
    })
    return (await this.listAccounts()).find(item => item.id === account.id)!
  }

  async updateAccount(id: string, input: AssistantAccountUpdateDto): Promise<AssistantAccountDto> {
    const account = await this.requireAccount(id)
    if (account.version !== input.expectedVersion) {
      throw new ApiException(409, 'ASSISTANT_ACCOUNT_STATE_CHANGED', '公司号状态已变化，请刷新后重试')
    }
    await this.prisma.assistantAccount.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.slice(0, 64) } : {}),
        ...(input.regionId !== undefined ? { regionId: input.regionId.slice(0, 16) } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.proxyIp !== undefined ? { proxyIpEncrypted: input.proxyIp } : {}),
        version: { increment: 1 },
      },
    })
    return (await this.listAccounts()).find(item => item.id === id)!
  }

  async startLogin(context: AssistantAdminContext, id: string): Promise<AssistantLoginQrDto> {
    const account = await this.requireAccount(id)
    const appId = account.appId.startsWith('pending-') ? '' : account.appId
    try {
      const qr = await this.adminTransport.createLoginQrCode({
        appId,
        type: 'ipad',
        regionId: account.regionId ?? '320000',
      })
      await this.prisma.$transaction(async transaction => {
        await transaction.assistantAccount.update({
          where: { id },
          data: { appId: qr.appId, status: 'REQUIRES_LOGIN', version: { increment: 1 } },
        })
        await this.audit.record(transaction, {
          eventType: 'ASSISTANT_ACCOUNT_LOGIN_STARTED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ASSISTANT_ACCOUNT',
          targetId: id,
          metadata: { appId: qr.appId },
        })
      })
      return {
        accountId: id,
        appId: qr.appId,
        uuid: qr.uuid,
        qrImgBase64: qr.qrImgBase64,
        expiresAt: qr.expiresAt,
      }
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
  }

  async loginStatus(context: AssistantAdminContext, id: string, uuid: string): Promise<AssistantLoginStatusDto> {
    const account = await this.requireAccount(id)
    try {
      const result = await this.adminTransport.checkLogin({ appId: account.appId, uuid })
      if (result.status === 'ONLINE' && result.wxid !== null) {
        await this.prisma.$transaction(async transaction => {
          await transaction.assistantAccount.update({
            where: { id },
            data: {
              wxid: result.wxid,
              nickname: result.nickname,
              avatarUrl: result.avatarUrl,
              status: 'ONLINE',
              enabled: true,
              lastLoginAt: new Date(),
              lastOnlineAt: new Date(),
              lastErrorCode: null,
              lastErrorMessage: null,
              version: { increment: 1 },
            },
          })
          await this.audit.record(transaction, {
            eventType: 'ASSISTANT_ACCOUNT_LOGGED_IN',
            outcome: 'SUCCESS',
            actorType: 'USER',
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            targetType: 'ASSISTANT_ACCOUNT',
            targetId: id,
            metadata: { appId: account.appId },
          })
        })
      }
      return {
        status: result.status,
        wxidMasked: maskWxid(result.wxid),
        nickname: result.nickname,
      }
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
  }

  async reconnect(context: AssistantAdminContext, id: string): Promise<AssistantAccountDto> {
    const account = await this.requireAccount(id)
    try {
      await this.adminTransport.reconnect(account.appId)
      await this.prisma.$transaction(async transaction => {
        await transaction.assistantAccount.update({
          where: { id },
          data: { status: 'ONLINE', lastOnlineAt: new Date(), version: { increment: 1 } },
        })
        await this.audit.record(transaction, {
          eventType: 'ASSISTANT_ACCOUNT_RECONNECTED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ASSISTANT_ACCOUNT',
          targetId: id,
          metadata: { appId: account.appId },
        })
      })
      return (await this.listAccounts()).find(item => item.id === id)!
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
  }

  async logout(context: AssistantAdminContext, id: string): Promise<AssistantAccountDto> {
    const account = await this.requireAccount(id)
    try {
      await this.adminTransport.logout(account.appId)
      await this.prisma.$transaction(async transaction => {
        await transaction.assistantAccount.update({
          where: { id },
          data: { status: 'OFFLINE', enabled: false, version: { increment: 1 } },
        })
        await this.audit.record(transaction, {
          eventType: 'ASSISTANT_ACCOUNT_LOGGED_OUT',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ASSISTANT_ACCOUNT',
          targetId: id,
          metadata: { appId: account.appId },
        })
      })
      return (await this.listAccounts()).find(item => item.id === id)!
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
  }

  async accountQrCode(id: string): Promise<{ qrCodeBase64: string }> {
    const account = await this.requireAccount(id)
    try {
      return { qrCodeBase64: await this.adminTransport.getOwnQrCode(account.appId) }
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
  }

  async listContacts(query: string | undefined): Promise<AssistantContactDto[]> {
    const account = await this.prisma.assistantAccount.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
      select: { appId: true },
    })
    if (account === null) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_UNAVAILABLE', '没有可用的公司号')
    }
    try {
      const { friends } = await this.adminTransport.fetchContactIds(account.appId)
      const brief = await this.adminTransport.fetchBriefInfo(account.appId, friends.slice(0, 100))
      const keyword = query?.trim().toLowerCase()
      return brief
        .filter(contact => keyword === undefined || keyword.length === 0
          || contact.wxid.toLowerCase().includes(keyword)
          || contact.nickname?.toLowerCase().includes(keyword) === true
          || contact.remark?.toLowerCase().includes(keyword) === true)
        .map(contact => ({
          wxid: contact.wxid,
          nickname: contact.nickname,
          remark: contact.remark,
          alias: contact.alias,
          avatarUrl: contact.avatarUrl,
        }))
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
  }

  async listBindings(input: AssistantBindingQueryDto): Promise<AssistantBindingPageDto> {
    const where: Prisma.AssistantBindingWhereInput = {
      ...(input.status !== undefined ? { status: input.status as 'ACTIVE' | 'INVALID' | 'DISABLED' } : {}),
      ...(input.query !== undefined && input.query.trim().length > 0
        ? {
            OR: [
              { wxid: { contains: input.query.trim() } },
              { wechatNickname: { contains: input.query.trim(), mode: 'insensitive' } },
              { user: { displayName: { contains: input.query.trim(), mode: 'insensitive' } } },
            ],
          }
        : {}),
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.assistantBinding.count({ where }),
      this.prisma.assistantBinding.findMany({
        where,
        include: { user: { select: { displayName: true } }, account: { select: { name: true } } },
        orderBy: [{ boundAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ])
    return {
      items: rows.map(row => this.toBindingDto(row)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    }
  }

  private toBindingDto(row: {
    readonly id: string
    readonly userId: string
    readonly accountId: string
    readonly wxid: string
    readonly wechatNickname: string | null
    readonly status: string
    readonly verifiedAt: Date | null
    readonly friendCheckedAt: Date | null
    readonly boundAt: Date
    readonly user: { readonly displayName: string }
    readonly account: { readonly name: string }
  }): AssistantBindingDto {
    return {
      id: row.id,
      userId: row.userId,
      userName: row.user.displayName,
      accountId: row.accountId,
      accountName: row.account.name,
      wxidMasked: maskWxid(row.wxid) ?? '',
      wechatNickname: row.wechatNickname,
      status: row.status,
      verifiedAt: iso(row.verifiedAt),
      friendCheckedAt: iso(row.friendCheckedAt),
      boundAt: row.boundAt.toISOString(),
    }
  }

  async createBinding(context: AssistantAdminContext, input: AssistantBindingCreateDto): Promise<AssistantBindingDto> {
    const [user, account] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } }),
      this.prisma.assistantAccount.findFirst({ where: { enabled: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
    ])
    if (user === null || user.status !== 'ACTIVE') {
      throw new ApiException(422, 'ASSISTANT_BINDING_USER_INVALID', '员工不存在或已停用')
    }
    if (account === null) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_UNAVAILABLE', '没有可用的公司号')
    }
    try {
      const binding = await this.prisma.$transaction(async transaction => {
        const created = await transaction.assistantBinding.create({
          data: {
            userId: user.id,
            accountId: account.id,
            wxid: input.wxid.trim(),
            wechatNickname: input.wechatNickname?.trim() || null,
            status: 'ACTIVE',
            boundByUserId: context.actorUserId,
          },
          include: { user: { select: { displayName: true } }, account: { select: { name: true } } },
        })
        await this.audit.record(transaction, {
          eventType: 'ASSISTANT_BINDING_CREATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ASSISTANT_BINDING',
          targetId: created.id,
          metadata: { userId: user.id, accountId: account.id },
        })
        return created
      })
      return this.toBindingDto(binding)
    }
    catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ApiException(409, 'ASSISTANT_BINDING_EXISTS', '该员工或微信已绑定')
      }
      throw error
    }
  }

  async verifyBinding(context: AssistantAdminContext, id: string): Promise<AssistantBindingDto> {
    const binding = await this.prisma.assistantBinding.findUnique({
      where: { id },
      include: { account: { select: { appId: true } }, user: { select: { displayName: true } } },
    })
    if (binding === null) {
      throw new ApiException(404, 'ASSISTANT_BINDING_NOT_FOUND', '绑定不存在')
    }
    const result = await this.transport.sendText({
      appId: binding.account.appId,
      toWxid: binding.wxid,
      content: VERIFY_TEXT,
    })
    if (!result.ok) {
      throw new ApiException(503, 'ASSISTANT_UPSTREAM_UNAVAILABLE', '千树小助理服务暂时不可用')
    }
    const updated = await this.prisma.$transaction(async transaction => {
      const row = await transaction.assistantBinding.update({
        where: { id },
        data: {
          verifiedAt: new Date(),
          verifiedByUserId: context.actorUserId,
          status: 'ACTIVE',
        },
        include: { user: { select: { displayName: true } }, account: { select: { name: true } } },
      })
      await this.audit.record(transaction, {
        eventType: 'ASSISTANT_BINDING_VERIFIED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'ASSISTANT_BINDING',
        targetId: id,
        metadata: { userId: binding.userId, accountId: binding.accountId },
      })
      return row
    })
    return this.toBindingDto(updated)
  }

  async revokeBinding(context: AssistantAdminContext, id: string): Promise<void> {
    const binding = await this.prisma.assistantBinding.findUnique({ where: { id }, select: { id: true, userId: true } })
    if (binding === null) {
      throw new ApiException(404, 'ASSISTANT_BINDING_NOT_FOUND', '绑定不存在')
    }
    await this.prisma.$transaction(async transaction => {
      await transaction.assistantBinding.update({ where: { id }, data: { status: 'DISABLED' } })
      await this.audit.record(transaction, {
        eventType: 'ASSISTANT_BINDING_REVOKED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'ASSISTANT_BINDING',
        targetId: id,
        metadata: { userId: binding.userId },
      })
    })
  }

  async checkBindings(context: AssistantAdminContext): Promise<{ checked: number, invalidated: number }> {
    const bindings = await this.prisma.assistantBinding.findMany({
      where: { status: 'ACTIVE' },
      include: { account: { select: { appId: true } } },
    })
    let invalidated = 0
    for (const binding of bindings) {
      try {
        const relations = await this.adminTransport.checkRelations(binding.account.appId, [binding.wxid])
        const relation = relations.find(item => item.wxid === binding.wxid)?.relation
        const status = relation === 1 || relation === 2 || relation === 3 ? 'INVALID' : 'ACTIVE'
        if (status === 'INVALID') {
          invalidated += 1
        }
        await this.prisma.assistantBinding.update({
          where: { id: binding.id },
          data: { status, friendCheckedAt: new Date() },
        })
      }
      catch {
        // 单个好友检测失败不阻断其他绑定。
      }
    }
    if (invalidated > 0) {
      await this.prisma.$transaction(async transaction => {
        await this.audit.record(transaction, {
          eventType: 'ASSISTANT_BINDING_INVALIDATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ASSISTANT_BINDING',
          metadata: { invalidatedCount: invalidated },
        })
      })
    }
    return { checked: bindings.length, invalidated }
  }

  async listTargets(): Promise<AssistantTargetDto[]> {
    const targets = await this.prisma.assistantTarget.findMany({ orderBy: [{ enabled: 'desc' }, { name: 'asc' }] })
    return targets.map(target => this.toTargetDto(target))
  }

  private toTargetDto(target: {
    readonly id: string
    readonly key: string
    readonly chatroomId: string
    readonly name: string
    readonly purpose: string | null
    readonly internalOnly: boolean
    readonly memberCount: number | null
    readonly enabled: boolean
    readonly lastSyncedAt: Date | null
  }): AssistantTargetDto {
    return {
      id: target.id,
      key: target.key,
      chatroomId: target.chatroomId,
      name: target.name,
      purpose: target.purpose,
      internalOnly: target.internalOnly,
      memberCount: target.memberCount,
      enabled: target.enabled,
      lastSyncedAt: iso(target.lastSyncedAt),
    }
  }

  async syncTargets(): Promise<AssistantTargetDto[]> {
    const account = await this.prisma.assistantAccount.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
      select: { appId: true },
    })
    if (account === null) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_UNAVAILABLE', '没有可用的公司号')
    }
    try {
      const { chatrooms } = await this.adminTransport.fetchContactIds(account.appId)
      const brief = await this.adminTransport.fetchBriefInfo(account.appId, chatrooms.slice(0, 100))
      const nameByWxid = new Map(brief.map(contact => [contact.wxid, contact.nickname]))
      const now = new Date()
      for (const chatroomId of chatrooms) {
        await this.prisma.assistantTarget.upsert({
          where: { chatroomId },
          update: { name: nameByWxid.get(chatroomId) ?? chatroomId, lastSyncedAt: now },
          create: {
            key: chatroomId,
            chatroomId,
            name: nameByWxid.get(chatroomId) ?? chatroomId,
            internalOnly: false,
            enabled: true,
            lastSyncedAt: now,
          },
        })
      }
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
    return this.listTargets()
  }

  async updateTarget(id: string, input: AssistantTargetUpdateDto): Promise<AssistantTargetDto> {
    const target = await this.prisma.assistantTarget.findUnique({ where: { id } })
    if (target === null) {
      throw new ApiException(404, 'ASSISTANT_TARGET_NOT_FOUND', '群目标不存在')
    }
    const updated = await this.prisma.assistantTarget.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.slice(0, 128) } : {}),
        ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
        ...(input.internalOnly !== undefined ? { internalOnly: input.internalOnly } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    })
    return this.toTargetDto(updated)
  }
}
