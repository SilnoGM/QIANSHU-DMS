import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { assistantAdminErrorToApiException } from './assistant-admin.errors'
import {
  ASSISTANT_ADMIN_TRANSPORT,
  ASSISTANT_TRANSPORT,
  AssistantAdminError,
  type AssistantAdminTransport,
  type AssistantBriefContact,
  type AssistantChatroomInfo,
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
  AssistantBindingReassignDto,
  AssistantBindingVerifyDto,
  AssistantChannelDto,
  AssistantChannelUpdateDto,
  AssistantContactDto,
  AssistantTargetDto,
  AssistantTargetMemberDto,
  AssistantTargetUpdateDto,
} from './assistant-admin.dto'

export interface AssistantAdminContext {
  readonly actorUserId: string
  readonly requestId: string
}

const TEST_TEXT = '【千树小助理】通道自检：这是一条测试消息，无需处理。'
const BINDING_TEST_COOLDOWN_MS = 30_000
const BINDING_TEST_CONTENT_LIMIT = 500
const PENDING_APP_ID_PREFIX = 'pending-'

/** 仅已从 GeWe 控制台导入、处于启用状态且不是占位 appId 的账号才能参与发送。 */
const ACTIVE_ACCOUNT_WHERE: Prisma.AssistantAccountWhereInput = {
  enabled: true,
  appId: { not: { startsWith: PENDING_APP_ID_PREFIX } },
}

function maskWxid(wxid: string | null): string | null {
  if (wxid === null || wxid.length <= 4) {
    return wxid === null ? null : '****'
  }
  return `${wxid.slice(0, 4)}****${wxid.slice(-4)}`
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

function isPendingAppId(appId: string): boolean {
  return appId.startsWith(PENDING_APP_ID_PREFIX)
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002'
}

interface AccountRecord {
  readonly id: string
  readonly name: string
  readonly appId: string
  readonly wxid: string | null
  readonly nickname: string | null
  readonly avatarUrl: string | null
  readonly status: string
  readonly enabled: boolean
  readonly lastOnlineAt: Date | null
  readonly lastLoginAt: Date | null
  readonly version: number
}

@Injectable()
export class AssistantAdminService {
  private readonly logger = new Logger(AssistantAdminService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
    @Inject(ASSISTANT_TRANSPORT) private readonly transport: AssistantTransport,
    @Inject(ASSISTANT_ADMIN_TRANSPORT) private readonly adminTransport: AssistantAdminTransport,
  ) {}

  private mapUpstreamError(error: unknown): never {
    if (error instanceof AssistantAdminError) {
      this.logger.warn(`assistant upstream failed code=${error.code} kind=${error.kind}`)
      throw assistantAdminErrorToApiException(error)
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

  private toAccountDto(account: AccountRecord): AssistantAccountDto {
    return {
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
    }
  }

  private assertImported(account: { readonly appId: string }): void {
    if (isPendingAppId(account.appId)) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_NOT_IMPORTED', '该账号尚未导入 GeWe 节点，请填写 appId 与 wxid')
    }
  }

  private async checkOnline(appId: string): Promise<boolean> {
    try {
      return await this.adminTransport.checkOnline(appId)
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
  }

  /**
   * GeWe 联系人资料是外部快照：公司号与员工绑定都复用同一次 getBriefInfo。
   * 资料同步是增强信息，失败不得阻断导入、状态检查、绑定或巡检。
   */
  private async fetchContactProfile(
    appId: string,
    wxid: string,
  ): Promise<{ readonly nickname: string | null, readonly avatarUrl: string | null } | null> {
    if (isPendingAppId(appId) || wxid.trim().length === 0) {
      return null
    }
    try {
      const contacts = await this.adminTransport.fetchBriefInfo(appId, [wxid])
      const contact = contacts.find(item => item.wxid === wxid)
      if (contact === undefined) {
        return null
      }
      return {
        nickname: contact.nickname?.trim() || null,
        avatarUrl: contact.avatarUrl?.trim() || null,
      }
    }
    catch (error) {
      const code = error instanceof AssistantAdminError ? error.code : 'UNKNOWN'
      this.logger.warn(`assistant account profile sync failed code=${code}`)
      return null
    }
  }

  private async requireOnlineNode(appId: string): Promise<void> {
    if (!await this.checkOnline(appId)) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_OFFLINE', '节点不在线，请先在 GeWe 控制台确认节点在线')
    }
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
      where: ACTIVE_ACCOUNT_WHERE,
      orderBy: { createdAt: 'asc' },
      select: { appId: true },
    })
    if (account === null) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_UNAVAILABLE', '没有可用的公司号')
    }
    await this.requireOnlineNode(account.appId)
    const result = await this.transport.sendText({ appId: account.appId, toWxid: 'filehelper', content: TEST_TEXT })
    if (!result.ok) {
      this.mapUpstreamError(new AssistantAdminError(result.code, result.kind, result.message))
    }
    return { accepted: true }
  }

  async listAccounts(): Promise<AssistantAccountDto[]> {
    const accounts = await this.prisma.assistantAccount.findMany({ orderBy: { createdAt: 'asc' } })
    return accounts.map(account => this.toAccountDto(account))
  }

  /**
   * 导入 GeWe 控制台中已经登录的执行节点。系统不发起扫码、重连或退出；
   * appId 与 wxid 由管理员从控制台复制，服务端只校验节点在线后落库。
   */
  async createAccount(context: AssistantAdminContext, input: AssistantAccountCreateDto): Promise<AssistantAccountDto> {
    const name = input.name.trim()
    const appId = input.appId.trim()
    const wxid = input.wxid.trim()
    const nickname = input.nickname?.trim() || null

    if (isPendingAppId(appId)) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_APP_ID_INVALID', 'appId 无效，请填写 GeWe 控制台中的真实 appId')
    }
    const existing = await this.prisma.assistantAccount.findUnique({ where: { appId }, select: { id: true } })
    if (existing !== null) {
      throw new ApiException(409, 'ASSISTANT_ACCOUNT_APP_ID_EXISTS', '该 appId 已导入')
    }
    await this.requireOnlineNode(appId)
    const profile = await this.fetchContactProfile(appId, wxid)
    const resolvedNickname = profile?.nickname ?? nickname

    try {
      const created = await this.prisma.$transaction(async transaction => {
        const account = await transaction.assistantAccount.create({
          data: {
            name: name.slice(0, 64),
            appId,
            wxid: wxid.slice(0, 128),
            nickname: resolvedNickname === null ? null : resolvedNickname.slice(0, 128),
            avatarUrl: profile?.avatarUrl ?? null,
            status: 'ONLINE',
            enabled: true,
            lastOnlineAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        })
        await this.audit.record(transaction, {
          eventType: 'ASSISTANT_ACCOUNT_LOGGED_IN',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ASSISTANT_ACCOUNT',
          targetId: account.id,
          metadata: { appId, wxidMasked: maskWxid(wxid), mode: 'CONSOLE_IMPORT' },
        })
        return account
      })
      return this.toAccountDto(created)
    }
    catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiException(409, 'ASSISTANT_ACCOUNT_APP_ID_EXISTS', '该 appId 已导入')
      }
      throw error
    }
  }

  /**
   * 更新公司号备注或重新指向控制台中的节点。只有 appId 变化时才再次校验在线状态；
   * version 由 updateMany 条件保证，避免两个管理员同时覆盖。
   */
  async updateAccount(context: AssistantAdminContext, id: string, input: AssistantAccountUpdateDto): Promise<AssistantAccountDto> {
    const account = await this.requireAccount(id)
    if (account.version !== input.expectedVersion) {
      throw new ApiException(409, 'ASSISTANT_ACCOUNT_STATE_CHANGED', '公司号状态已变化，请刷新后重试')
    }

    const name = input.name?.trim()
    const nextWxid = input.wxid?.trim()
    const nickname = input.nickname === undefined ? undefined : input.nickname.trim() || null
    const nextAppId = input.appId?.trim()
    const changedAppId = nextAppId !== undefined && nextAppId !== account.appId ? nextAppId : null

    if (changedAppId !== null) {
      if (isPendingAppId(changedAppId)) {
        throw new ApiException(422, 'ASSISTANT_ACCOUNT_APP_ID_INVALID', 'appId 无效，请填写 GeWe 控制台中的真实 appId')
      }
      const existing = await this.prisma.assistantAccount.findUnique({ where: { appId: changedAppId }, select: { id: true } })
      if (existing !== null && existing.id !== id) {
        throw new ApiException(409, 'ASSISTANT_ACCOUNT_APP_ID_EXISTS', '该 appId 已导入')
      }
      await this.requireOnlineNode(changedAppId)
    }

    if (input.enabled === true && isPendingAppId(changedAppId ?? account.appId)) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_NOT_IMPORTED', '该账号尚未导入 GeWe 节点，请填写 appId 与 wxid')
    }

    const changedWxid = nextWxid !== undefined && nextWxid !== account.wxid
    const profileWxid = nextWxid ?? account.wxid
    const profile = (changedAppId !== null || changedWxid) && profileWxid !== null
      ? await this.fetchContactProfile(changedAppId ?? account.appId, profileWxid)
      : null
    const resolvedNickname = profile?.nickname ?? nickname

    try {
      const updated = await this.prisma.$transaction(async transaction => {
        const result = await transaction.assistantAccount.updateMany({
          where: { id, version: input.expectedVersion },
          data: {
            ...(name !== undefined ? { name: name.slice(0, 64) } : {}),
            ...(changedAppId !== null
              ? {
                  appId: changedAppId,
                  status: 'ONLINE' as const,
                  enabled: input.enabled ?? true,
                  lastOnlineAt: new Date(),
                  lastErrorCode: null,
                  lastErrorMessage: null,
                }
              : {}),
            ...(nextWxid !== undefined ? { wxid: nextWxid.slice(0, 128) } : {}),
            ...(resolvedNickname !== undefined ? { nickname: resolvedNickname === null ? null : resolvedNickname.slice(0, 128) } : {}),
            ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
            ...(changedAppId === null && input.enabled !== undefined ? { enabled: input.enabled } : {}),
            version: { increment: 1 },
          },
        })
        if (result.count === 0) {
          throw new ApiException(409, 'ASSISTANT_ACCOUNT_STATE_CHANGED', '公司号状态已变化，请刷新后重试')
        }
        if (changedAppId !== null) {
          await this.audit.record(transaction, {
            eventType: 'ASSISTANT_ACCOUNT_LOGGED_IN',
            outcome: 'SUCCESS',
            actorType: 'USER',
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            targetType: 'ASSISTANT_ACCOUNT',
            targetId: id,
            metadata: {
              appId: changedAppId,
              previousAppId: account.appId,
              mode: 'CONSOLE_IMPORT_UPDATE',
            },
          })
        }
        return transaction.assistantAccount.findUniqueOrThrow({ where: { id } })
      })
      return this.toAccountDto(updated)
    }
    catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiException(409, 'ASSISTANT_ACCOUNT_APP_ID_EXISTS', '该 appId 已导入')
      }
      throw error
    }
  }

  /** 从 GeWe 读取节点在线状态；只更新本地快照，不触发登录、重连或退出。 */
  async checkAccountStatus(id: string): Promise<AssistantAccountDto> {
    const account = await this.requireAccount(id)
    this.assertImported(account)
    const online = await this.checkOnline(account.appId)
    const profile = account.wxid === null
      ? null
      : await this.fetchContactProfile(account.appId, account.wxid)
    const updated = await this.prisma.assistantAccount.update({
      where: { id },
      data: {
        ...(online
          ? {
              status: 'ONLINE' as const,
              lastOnlineAt: new Date(),
              lastErrorCode: null,
              lastErrorMessage: null,
            }
          : {
              status: 'OFFLINE' as const,
              lastErrorCode: 'ASSISTANT_ACCOUNT_OFFLINE',
              lastErrorMessage: '节点离线，请在 GeWe 控制台重连',
            }),
        ...(profile?.nickname ? { nickname: profile.nickname.slice(0, 128) } : {}),
        ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        version: { increment: 1 },
      },
    })
    return this.toAccountDto(updated)
  }

  async accountQrCode(id: string): Promise<{ qrCodeBase64: string }> {
    const account = await this.requireAccount(id)
    this.assertImported(account)
    try {
      return { qrCodeBase64: await this.adminTransport.getOwnQrCode(account.appId) }
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
  }

  async listContacts(query: string | undefined): Promise<AssistantContactDto[]> {
    const account = await this.prisma.assistantAccount.findFirst({
      where: ACTIVE_ACCOUNT_WHERE,
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
    readonly wechatAvatarUrl: string | null
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
      wxid: row.wxid,
      wxidMasked: maskWxid(row.wxid) ?? '',
      wechatNickname: row.wechatNickname,
      wechatAvatarUrl: row.wechatAvatarUrl,
      status: row.status,
      verifiedAt: iso(row.verifiedAt),
      friendCheckedAt: iso(row.friendCheckedAt),
      boundAt: row.boundAt.toISOString(),
    }
  }

  async createBinding(context: AssistantAdminContext, input: AssistantBindingCreateDto): Promise<AssistantBindingDto> {
    const [user, account] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } }),
      this.prisma.assistantAccount.findFirst({ where: ACTIVE_ACCOUNT_WHERE, orderBy: { createdAt: 'asc' }, select: { id: true, appId: true } }),
    ])
    if (user === null || user.status !== 'ACTIVE') {
      throw new ApiException(422, 'ASSISTANT_BINDING_USER_INVALID', '员工不存在或已停用')
    }
    if (account === null) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_UNAVAILABLE', '没有可用的公司号')
    }
    const wxid = input.wxid.trim()
    const profile = await this.fetchContactProfile(account.appId, wxid)
    const wechatNickname = profile?.nickname ?? (input.wechatNickname?.trim() || null)
    try {
      const binding = await this.prisma.$transaction(async transaction => {
        const created = await transaction.assistantBinding.create({
          data: {
            userId: user.id,
            accountId: account.id,
            wxid,
            wechatNickname,
            wechatAvatarUrl: profile?.avatarUrl ?? null,
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

  /**
   * 把已存在的微信绑定改给另一个员工。wxid 不变，因此会清空原验证状态，
   * 必须重新发送测试消息确认，避免把已验证的微信静默转给未确认的人。
   */
  async reassignBinding(context: AssistantAdminContext, id: string, input: AssistantBindingReassignDto): Promise<AssistantBindingDto> {
    const binding = await this.prisma.assistantBinding.findUnique({
      where: { id },
      include: { user: { select: { displayName: true } }, account: { select: { name: true } } },
    })
    if (binding === null) {
      throw new ApiException(404, 'ASSISTANT_BINDING_NOT_FOUND', '绑定不存在')
    }
    if (binding.userId === input.userId) {
      return this.toBindingDto(binding)
    }
    const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } })
    if (user === null || user.status !== 'ACTIVE') {
      throw new ApiException(422, 'ASSISTANT_BINDING_USER_INVALID', '员工不存在或已停用')
    }
    const conflict = await this.prisma.assistantBinding.findUnique({
      where: { userId_accountId: { userId: user.id, accountId: binding.accountId } },
      select: { id: true },
    })
    if (conflict !== null) {
      throw new ApiException(409, 'ASSISTANT_BINDING_USER_CONFLICT', '该员工已绑定当前公司号')
    }
    try {
      const updated = await this.prisma.$transaction(async transaction => {
        const row = await transaction.assistantBinding.update({
          where: { id },
          data: {
            userId: user.id,
            boundByUserId: context.actorUserId,
            status: 'ACTIVE',
            verifiedAt: null,
            verifiedByUserId: null,
            friendCheckedAt: null,
            boundAt: new Date(),
          },
          include: { user: { select: { displayName: true } }, account: { select: { name: true } } },
        })
        await this.audit.record(transaction, {
          eventType: 'ASSISTANT_BINDING_REVOKED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ASSISTANT_BINDING',
          targetId: id,
          metadata: { userId: binding.userId, reassignedToUserId: user.id, reason: 'REASSIGNED' },
        })
        await this.audit.record(transaction, {
          eventType: 'ASSISTANT_BINDING_CREATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ASSISTANT_BINDING',
          targetId: id,
          metadata: { userId: user.id, previousUserId: binding.userId, mode: 'REASSIGN' },
        })
        return row
      })
      return this.toBindingDto(updated)
    }
    catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ApiException(409, 'ASSISTANT_BINDING_USER_CONFLICT', '该员工已绑定当前公司号')
      }
      throw error
    }
  }

  async verifyBinding(
    context: AssistantAdminContext,
    id: string,
    input: AssistantBindingVerifyDto,
  ): Promise<AssistantBindingDto> {
    const content = input.content.trim()
    if (content.length === 0) {
      throw new ApiException(422, 'ASSISTANT_BINDING_CONTENT_INVALID', '测试内容不能为空')
    }
    if (content.length > BINDING_TEST_CONTENT_LIMIT) {
      throw new ApiException(422, 'ASSISTANT_BINDING_CONTENT_INVALID', `测试内容不能超过 ${BINDING_TEST_CONTENT_LIMIT} 个字符`)
    }
    const binding = await this.prisma.assistantBinding.findUnique({
      where: { id },
      include: { account: { select: { appId: true } }, user: { select: { displayName: true } } },
    })
    if (binding === null) {
      throw new ApiException(404, 'ASSISTANT_BINDING_NOT_FOUND', '绑定不存在')
    }

    const now = new Date()
    const cutoff = new Date(now.getTime() - BINDING_TEST_COOLDOWN_MS)
    const reserved = await this.prisma.assistantBinding.updateMany({
      where: {
        id,
        OR: [
          { lastTestSentAt: null },
          { lastTestSentAt: { lte: cutoff } },
        ],
      },
      data: { lastTestSentAt: now },
    })
    if (reserved.count === 0) {
      throw new ApiException(429, 'ASSISTANT_BINDING_TEST_COOLDOWN', '测试消息发送过于频繁，请稍后再试')
    }

    const result = await this.transport.sendText({
      appId: binding.account.appId,
      toWxid: binding.wxid,
      content,
    })
    if (!result.ok) {
      this.mapUpstreamError(new AssistantAdminError(result.code, result.kind, result.message))
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
      include: { account: { select: { appId: true } } },
      orderBy: [{ boundAt: 'desc' }, { id: 'desc' }],
    })
    let invalidated = 0
    const groups = new Map<string, Array<(typeof bindings)[number]>>()
    for (const binding of bindings) {
      const group = groups.get(binding.accountId) ?? []
      group.push(binding)
      groups.set(binding.accountId, group)
    }

    for (const group of groups.values()) {
      const account = group[0].account
      const wxids = [...new Set(group.map(binding => binding.wxid))]
      let profiles: readonly AssistantBriefContact[] = []
      try {
        profiles = await this.adminTransport.fetchBriefInfo(account.appId, wxids)
      }
      catch {
        // 资料同步失败不阻断好友关系巡检；已有头像和昵称继续保留。
      }

      const activeWxids = group.filter(binding => binding.status === 'ACTIVE').map(binding => binding.wxid)
      let relations: readonly { readonly wxid: string, readonly relation: number }[] = []
      if (activeWxids.length > 0) {
        try {
          relations = await this.adminTransport.checkRelations(account.appId, activeWxids)
        }
        catch {
          // 单个账号的好友检测失败不阻断其他账号。
        }
      }

      for (const binding of group) {
        const profile = profiles.find(item => item.wxid === binding.wxid)
        const relation = relations.find(item => item.wxid === binding.wxid)?.relation
        const relationInvalid = relation === 1 || relation === 2 || relation === 3
        const nextStatus = binding.status === 'ACTIVE' && relationInvalid ? 'INVALID' : binding.status
        if (binding.status === 'ACTIVE' && relationInvalid) {
          invalidated += 1
        }
        const data = {
          ...(profile?.nickname ? { wechatNickname: profile.nickname.slice(0, 128) } : {}),
          ...(profile?.avatarUrl ? { wechatAvatarUrl: profile.avatarUrl } : {}),
          ...(binding.status === 'ACTIVE' && relation !== undefined
            ? { status: nextStatus, friendCheckedAt: new Date() }
            : {}),
        }
        if (Object.keys(data).length === 0) {
          continue
        }
        try {
          await this.prisma.assistantBinding.update({ where: { id: binding.id }, data })
        }
        catch {
          // 单条绑定写入失败不阻断其他绑定。
        }
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
    readonly avatarUrl: string | null
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
      avatarUrl: target.avatarUrl,
      enabled: target.enabled,
      lastSyncedAt: iso(target.lastSyncedAt),
    }
  }

  async syncTargets(): Promise<AssistantTargetDto[]> {
    const account = await this.prisma.assistantAccount.findFirst({
      where: ACTIVE_ACCOUNT_WHERE,
      orderBy: { createdAt: 'asc' },
      select: { appId: true },
    })
    if (account === null) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_UNAVAILABLE', '没有可用的公司号')
    }
    try {
      const { chatrooms } = await this.adminTransport.fetchContactIds(account.appId)
      const brief = await this.adminTransport.fetchBriefInfo(account.appId, chatrooms.slice(0, 100))
      const contactByWxid = new Map(brief.map(contact => [contact.wxid, contact]))
      const detailByChatroom = new Map<string, AssistantChatroomInfo>()
      for (const chatroomId of chatrooms.slice(0, 100)) {
        try {
          detailByChatroom.set(chatroomId, await this.adminTransport.fetchChatroomInfo(account.appId, chatroomId))
        }
        catch (error) {
          // 单个群详情不可用（如刚保存到通讯录、尚未活跃）不应阻断整批同步；
          // 离线、限流、网络等全局失败仍然向上抛出。
          if (!(error instanceof AssistantAdminError) || !['REJECTED', 'UNKNOWN'].includes(error.kind)) {
            throw error
          }
          this.logger.warn(`assistant chatroom detail skipped code=${error.code}`)
        }
      }
      const now = new Date()
      for (const chatroomId of chatrooms) {
        const contact = contactByWxid.get(chatroomId)
        const detail = detailByChatroom.get(chatroomId)
        const name = detail?.nickname ?? contact?.nickname ?? chatroomId
        const avatarUrl = detail?.avatarUrl ?? contact?.avatarUrl
        await this.prisma.assistantTarget.upsert({
          where: { chatroomId },
          update: {
            name,
            ...(avatarUrl !== undefined ? { avatarUrl } : {}),
            ...(detail?.memberCount !== null && detail?.memberCount !== undefined
              ? { memberCount: detail.memberCount }
              : {}),
            lastSyncedAt: now,
          },
          create: {
            key: chatroomId,
            chatroomId,
            name,
            avatarUrl: avatarUrl ?? null,
            memberCount: detail?.memberCount ?? null,
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

  async listTargetMembers(id: string): Promise<AssistantTargetMemberDto[]> {
    const target = await this.prisma.assistantTarget.findUnique({
      where: { id },
      select: { chatroomId: true },
    })
    if (target === null) {
      throw new ApiException(404, 'ASSISTANT_TARGET_NOT_FOUND', '群目标不存在')
    }
    const account = await this.prisma.assistantAccount.findFirst({
      where: ACTIVE_ACCOUNT_WHERE,
      orderBy: { createdAt: 'asc' },
      select: { appId: true },
    })
    if (account === null) {
      throw new ApiException(422, 'ASSISTANT_ACCOUNT_UNAVAILABLE', '没有可用的公司号')
    }
    try {
      const members = await this.adminTransport.fetchChatroomMembers(account.appId, target.chatroomId)
      return members.map(member => ({
        wxid: member.wxid,
        nickname: member.nickname,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        inviterName: member.inviterName,
        role: member.role,
      }))
    }
    catch (error) {
      this.mapUpstreamError(error)
    }
  }

  async updateTarget(id: string, input: AssistantTargetUpdateDto): Promise<AssistantTargetDto> {
    const target = await this.prisma.assistantTarget.findUnique({ where: { id } })
    if (target === null) {
      throw new ApiException(404, 'ASSISTANT_TARGET_NOT_FOUND', '群目标不存在')
    }
    try {
      const updated = await this.prisma.assistantTarget.update({
        where: { id },
        data: {
          ...(input.key !== undefined ? { key: input.key.trim().slice(0, 128) } : {}),
          ...(input.name !== undefined ? { name: input.name.slice(0, 128) } : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.internalOnly !== undefined ? { internalOnly: input.internalOnly } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      })
      return this.toTargetDto(updated)
    }
    catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ApiException(409, 'ASSISTANT_TARGET_KEY_EXISTS', '该群目标 key 已存在')
      }
      throw error
    }
  }
}
