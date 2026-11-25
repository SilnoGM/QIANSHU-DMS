import { randomUUID } from 'node:crypto'

import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { WecomConfiguration } from '../../config/wecom.config'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  isWithinQuietHours,
  nextQuietHoursEnd,
  parseNotificationQuietHours,
} from './notification-quiet-hours'
import {
  isRetryableWecomFailure,
  parseWecomMentionConfig,
  WECOM_APP_TRANSPORT,
  WECOM_ROBOT_TRANSPORT,
  type WecomAppTransport,
  type WecomRobotTransport,
  type WecomTransportFailureKind,
  type WecomTransportResult,
} from './wecom.types'
import { WecomSecretService } from './wecom-secret.service'
import { WecomMediaService } from './wecom-media.service'
import { WecomTokenService } from './wecom-token.service'

const LEASE_ID = 'wecom-dispatch'
const LEASE_TTL_MS = 30_000
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const
const RATE_LIMIT_RETRY_MS = 60_000
const STALE_SENDING_MS = 120_000

interface ClaimedDelivery {
  readonly id: string
  readonly notification_id: string
  readonly app_id: string | null
  readonly transport: 'APP' | 'ROBOT'
  readonly recipient_user_id: string | null
  readonly target_id: string | null
  readonly attempt_count: number
  readonly rendered_content: string
  readonly mention_mode: string | null
  readonly content_sent_at: Date | null
}

interface DeliveryMessageRow {
  readonly id: string
  readonly deliveryId: string
  readonly renderedMessageId: string
  readonly sortOrder: number
  readonly status: string
  readonly attemptCount: number
  readonly nextAttemptAt: Date
  readonly providerMsgId: string | null
  readonly failureCode: string | null
  readonly failureMessage: string | null
  readonly acceptedAt: Date | null
  readonly renderedMessage: {
    readonly kind: string
    readonly payloadSnapshot: Prisma.JsonValue
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * WECOM 派发器。
 *
 * 进程内循环 + 数据库租约，只领取、发送、更新状态与退避；不做入站、图片和
 * 管理端操作。应用消息与群机器人共用同一张投递表，按 transport 区分。
 */
@Injectable()
export class WecomDispatchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WecomDispatchService.name)
  private readonly ownerId = randomUUID()
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly secretService: WecomSecretService,
    private readonly tokenService: WecomTokenService,
    private readonly mediaService: WecomMediaService,
    @Inject(WECOM_APP_TRANSPORT) private readonly appTransport: WecomAppTransport,
    @Inject(WECOM_ROBOT_TRANSPORT) private readonly robotTransport: WecomRobotTransport,
  ) {}

  onApplicationBootstrap(): void {
    const app = this.configService.get<{ readonly nodeEnv?: string }>('app')
    if (app?.nodeEnv === 'test') {
      return
    }
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined || !config.workerEnabled) {
      this.logger.log('wecom worker disabled: WECOM_WORKER_ENABLED is not true')
      return
    }
    this.running = true
    void this.loop(config)
  }

  onModuleDestroy(): void {
    this.running = false
  }

  private async loop(config: WecomConfiguration): Promise<void> {
    while (this.running) {
      try {
        await this.dispatchOnce(config.batchSize)
      }
      catch (error) {
        this.logger.warn(`wecom dispatch cycle failed: ${error instanceof Error ? error.name : 'unknown'}`)
      }
      await sleep(config.pollMs)
    }
  }

  /** 公开给测试直接触发一轮，不依赖真实定时器。 */
  async dispatchOnce(batchSize: number): Promise<void> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined || !await this.acquireLease()) {
      return
    }
    const setting = await this.prisma.notificationChannelSettings.findUnique({
      where: { channel: 'WECOM' },
      select: { defaultQuietHours: true, enabled: true },
    })
    if (setting === null || !setting.enabled) {
      return
    }

    await this.recoverStaleSendingDeliveries()
    await this.expireOverdueDeliveries()
    const deliveries = await this.claimDeliveries(batchSize)
    for (const delivery of deliveries) {
      if (!await this.acquireLease()) {
        this.logger.warn('wecom dispatch lease lost during batch')
        break
      }
      await this.dispatchDelivery(delivery, setting.defaultQuietHours)
    }
  }

  private async acquireLease(ttlMs: number = LEASE_TTL_MS): Promise<boolean> {
    const expiresAt = new Date(Date.now() + ttlMs)
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "wecom_dispatch_leases"
      SET "owner_id" = ${this.ownerId}::uuid,
          "expires_at" = ${expiresAt},
          "updated_at" = now()
      WHERE "id" = ${LEASE_ID}
        AND ("expires_at" IS NULL OR "expires_at" < now() OR "owner_id" = ${this.ownerId}::uuid)
      RETURNING "id"
    `)
    return rows.length > 0
  }

  private async claimDeliveries(batchSize: number): Promise<ClaimedDelivery[]> {
    return this.prisma.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
      UPDATE "wecom_deliveries" d
      SET "status" = 'SENDING', "updated_at" = now()
      WHERE d."id" IN (
        SELECT d2."id"
        FROM "wecom_deliveries" d2
        JOIN "notifications" n ON n."id" = d2."notification_id"
        WHERE d2."status" = 'PENDING'
          AND d2."next_attempt_at" <= now()
        ORDER BY d2."created_at" ASC, d2."id" ASC
        FOR UPDATE OF d2 SKIP LOCKED
        LIMIT ${batchSize}
      )
      RETURNING d."id",
                d."notification_id",
                d."app_id",
                d."transport",
                d."recipient_user_id",
                d."target_id",
                d."attempt_count",
                d."rendered_content",
                d."mention_mode",
                d."content_sent_at"
    `)
  }

  private async dispatchDelivery(
    delivery: ClaimedDelivery,
    defaultQuietHours: Prisma.JsonValue | null,
  ): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: delivery.notification_id },
      select: { id: true, eventType: true, expiresAt: true, priority: true },
    })
    if (notification === null) {
      await this.markDelivery(delivery.id, 'FAILED', 'NOTIFICATION_MISSING', '通知不存在')
      return
    }
    if (notification.expiresAt !== null && notification.expiresAt.getTime() <= Date.now()) {
      await this.markDelivery(delivery.id, 'EXPIRED', 'EXPIRED', '通知已过期')
      await this.refreshNotificationStatus(notification.id)
      return
    }

    if (delivery.recipient_user_id !== null) {
      const muted = await this.prisma.notificationUserMute.findFirst({
        where: {
          userId: delivery.recipient_user_id,
          eventType: notification.eventType,
          channel: 'WECOM',
        },
        select: { id: true },
      })
      if (muted !== null) {
        await this.markDelivery(delivery.id, 'SKIPPED', 'USER_MUTED', '收件人已关闭该事件的企业微信提醒')
        await this.refreshNotificationStatus(notification.id)
        return
      }
    }

    if (await this.deferForQuietHours(delivery, notification, defaultQuietHours)) {
      return
    }

    if (delivery.transport === 'APP') {
      await this.deliverAppMessage(delivery, notification)
    }
    else {
      await this.deliverRobotMessage(delivery, notification)
    }
    await this.refreshNotificationStatus(notification.id)
  }

  private async deferForQuietHours(
    delivery: ClaimedDelivery,
    notification: { readonly id: string, readonly eventType: string, readonly expiresAt: Date | null, readonly priority: string },
    defaultQuietHours: Prisma.JsonValue | null,
  ): Promise<boolean> {
    if (notification.priority === 'HIGH') {
      return false
    }
    const policy = await this.prisma.notificationChannelPolicy.findUnique({
      where: { eventType_channel: { eventType: notification.eventType, channel: 'WECOM' } },
      select: { quietHours: true },
    })
    const quietHours = parseNotificationQuietHours(policy?.quietHours)
      ?? parseNotificationQuietHours(defaultQuietHours)
    if (quietHours === null || !isWithinQuietHours(new Date(), quietHours)) {
      return false
    }
    const nextAttemptAt = nextQuietHoursEnd(new Date(), quietHours)
    if (nextAttemptAt === null) {
      return false
    }
    if (notification.expiresAt !== null && nextAttemptAt.getTime() >= notification.expiresAt.getTime()) {
      await this.markDelivery(delivery.id, 'EXPIRED', 'QUIET_HOURS_EXPIRED', '静默时段结束前通知已过期')
      await this.refreshNotificationStatus(notification.id)
      return true
    }
    await this.prisma.wecomDelivery.update({
      where: { id: delivery.id },
      data: { status: 'PENDING', nextAttemptAt, updatedAt: new Date() },
    })
    return true
  }

  private async deliverAppMessage(
    delivery: ClaimedDelivery,
    notification: { readonly id: string },
  ): Promise<void> {
    if (delivery.app_id === null || delivery.recipient_user_id === null) {
      await this.markDelivery(delivery.id, 'FAILED', 'APP_TARGET_INVALID', '应用消息投递缺少应用或收件人')
      return
    }
    const [app, binding, membership] = await Promise.all([
      this.prisma.wecomApp.findUnique({
        where: { id: delivery.app_id },
        select: {
          key: true,
          agentId: true,
          corpId: true,
          enabled: true,
          status: true,
          secretEncrypted: true,
        },
      }),
      this.prisma.wecomBinding.findUnique({
        where: { userId: delivery.recipient_user_id },
        select: { wecomUserId: true, status: true, verifiedAt: true },
      }),
      this.prisma.wecomAppMembership.findUnique({
        where: { appId_userId: { appId: delivery.app_id, userId: delivery.recipient_user_id } },
        select: { status: true, verifiedAt: true },
      }),
    ])

    if (app === null || !app.enabled || app.status === 'DISABLED') {
      await this.markDelivery(delivery.id, 'FAILED', 'APP_DISABLED', 'WECOM 应用不存在或已停用')
      return
    }
    if (app.corpId === null || app.agentId === null || app.secretEncrypted === null) {
      await this.markDelivery(delivery.id, 'FAILED', 'APP_NOT_CONFIGURED', 'WECOM 应用未完成配置')
      return
    }
    if (binding === null || binding.status !== 'ACTIVE' || binding.verifiedAt === null) {
      await this.markDelivery(delivery.id, 'SKIPPED', 'NOT_BOUND', '员工未完成企业微信绑定验证')
      return
    }
    if (membership === null || membership.status !== 'ACTIVE' || membership.verifiedAt === null) {
      await this.markDelivery(delivery.id, 'SKIPPED', 'NOT_IN_APP_SCOPE', '员工不在该应用可见范围或未验证')
      return
    }

    let secret: string
    try {
      secret = this.secretService.decrypt(app.secretEncrypted)
    }
    catch {
      await this.markDelivery(delivery.id, 'FAILED', 'WECOM_SECRET_UNAVAILABLE', 'WECOM 应用 Secret 不可用')
      return
    }

    const token = await this.tokenService.getAccessToken({
      appKey: app.key,
      corpId: app.corpId,
      secret,
    })
    if (!token.ok) {
      await this.failDelivery(delivery, token.code, token.message, notification.id)
      return
    }

    const items = await this.findDeliveryMessages(delivery.id)
    if (items.length > 0) {
      await this.deliverMessageItems({
        delivery,
        items,
        notificationId: notification.id,
        send: async (item) => {
          if (item.renderedMessage.kind === 'MPNEWS') {
            const result = await this.sendAppMpnewsItem({
              item,
              delivery,
              accessToken: token.accessToken,
              agentId: app.agentId!,
              toUser: binding.wecomUserId,
            })
            if (!result.ok && result.kind === 'TOKEN_INVALID') {
              this.tokenService.invalidate(app.key)
            }
            return result
          }
          if (item.renderedMessage.kind !== 'TEXT') {
            return {
              ok: false,
              kind: 'REJECTED',
              code: 'WECOM_MESSAGE_KIND_UNSUPPORTED',
              message: '消息类型尚未接入派发',
            }
          }
          const content = this.messageContent(item.renderedMessage.payloadSnapshot)
          if (content === null) {
            return {
              ok: false,
              kind: 'REJECTED',
              code: 'WECOM_MESSAGE_CONTENT_MISSING',
              message: '消息内容为空',
            }
          }
          const result = await this.appTransport.sendText({
            accessToken: token.accessToken,
            agentId: app.agentId!,
            toUser: binding.wecomUserId,
            content,
          })
          if (!result.ok && result.kind === 'TOKEN_INVALID') {
            this.tokenService.invalidate(app.key)
          }
          return result
        },
      })
      return
    }

    const result = await this.appTransport.sendText({
      accessToken: token.accessToken,
      agentId: app.agentId,
      toUser: binding.wecomUserId,
      content: delivery.rendered_content,
    })
    if (!result.ok) {
      if (result.kind === 'TOKEN_INVALID') {
        this.tokenService.invalidate(app.key)
      }
      await this.failDelivery(delivery, result.code, result.message, notification.id, result.invalidUserIds)
      return
    }
    await this.prisma.wecomDelivery.update({
      where: { id: delivery.id },
      data: {
        contentSentAt: new Date(),
        providerMsgId: result.msgId,
        failureCode: null,
        failureMessage: null,
      },
    })
    const mediaFailed = await this.sendAppMedia(delivery, token.accessToken, app.agentId, binding.wecomUserId)
    await this.finalizeDelivery(delivery.id, mediaFailed)
  }

  private async deliverRobotMessage(
    delivery: ClaimedDelivery,
    notification: { readonly id: string, readonly eventType: string },
  ): Promise<void> {
    if (delivery.target_id === null) {
      await this.markDelivery(delivery.id, 'FAILED', 'TARGET_MISSING', '群机器人投递缺少群目标')
      return
    }
    const target = await this.prisma.wecomTarget.findUnique({
      where: { id: delivery.target_id },
      select: { webhookKeyEncrypted: true, enabled: true, internalOnly: true },
    })
    if (target === null || !target.enabled || !target.internalOnly) {
      await this.markDelivery(delivery.id, 'FAILED', 'TARGET_DISABLED', '群目标不存在、已停用或不是内部群')
      return
    }

    let webhookKey: string
    try {
      webhookKey = this.secretService.decrypt(target.webhookKeyEncrypted)
    }
    catch {
      await this.markDelivery(delivery.id, 'FAILED', 'WECOM_SECRET_UNAVAILABLE', '群机器人 webhook 不可用')
      return
    }

    const mention = await this.resolveMention(delivery, notification.eventType)
    const items = await this.findDeliveryMessages(delivery.id)
    if (items.length > 0) {
      await this.deliverMessageItems({
        delivery,
        items,
        notificationId: notification.id,
        send: async (item, isFirstText) => {
          if (item.renderedMessage.kind !== 'TEXT') {
            return {
              ok: false,
              kind: 'REJECTED',
              code: 'WECOM_MESSAGE_KIND_UNSUPPORTED',
              message: '群机器人暂不支持该消息类型',
            }
          }
          const content = this.messageContent(item.renderedMessage.payloadSnapshot)
          if (content === null) {
            return {
              ok: false,
              kind: 'REJECTED',
              code: 'WECOM_MESSAGE_CONTENT_MISSING',
              message: '消息内容为空',
            }
          }
          return this.robotTransport.sendText({
            webhookKey,
            content,
            ...(isFirstText && mention.userIds.length > 0 ? { mentionedUserIds: mention.userIds } : {}),
          })
        },
        onFirstAccepted: async () => {
          await this.prisma.wecomDelivery.update({
            where: { id: delivery.id },
            data: {
              mentionMode: mention.mode,
              mentionedCount: mention.userIds.length,
              mentionSkipped: mention.skipped,
            },
          })
        },
      })
      return
    }

    const result = await this.robotTransport.sendText({
      webhookKey,
      content: delivery.rendered_content,
      ...(mention.userIds.length === 0 ? {} : { mentionedUserIds: mention.userIds }),
    })
    if (result.ok) {
      await this.prisma.wecomDelivery.update({
        where: { id: delivery.id },
        data: {
          contentSentAt: new Date(),
          mentionMode: mention.mode,
          mentionedCount: mention.userIds.length,
          mentionSkipped: mention.skipped,
          failureCode: null,
          failureMessage: null,
        },
      })
      const mediaFailed = await this.sendRobotMedia(delivery, webhookKey)
      await this.finalizeDelivery(delivery.id, mediaFailed)
      return
    }
    await this.failDelivery(delivery, result.code, result.message, notification.id)
  }

  private async resolveMention(
    delivery: ClaimedDelivery,
    eventType: string,
  ): Promise<{ readonly mode: string, readonly userIds: readonly string[], readonly skipped: number }> {
    const policy = await this.prisma.notificationChannelPolicy.findUnique({
      where: { eventType_channel: { eventType, channel: 'WECOM' } },
      select: { targetConfig: true },
    })
    let targetConfig = policy?.targetConfig ?? null
    if (policy === null) {
      const config = await this.prisma.notificationEventChannel.findUnique({
        where: { eventType_channel: { eventType, channel: 'WECOM' } },
        select: { targetConfig: true },
      })
      targetConfig = config?.targetConfig ?? null
    }
    const mention = parseWecomMentionConfig(asRecord(targetConfig)?.mention)
    if (mention.mode === 'ALL') {
      return { mode: 'ALL', userIds: ['@all'], skipped: 0 }
    }
    if (mention.mode !== 'USERS' || mention.userIds.length === 0) {
      return { mode: 'NONE', userIds: [], skipped: 0 }
    }
    const bindings = await this.prisma.wecomBinding.findMany({
      where: {
        userId: { in: [...mention.userIds] },
        status: 'ACTIVE',
        verifiedAt: { not: null },
      },
      select: { userId: true, wecomUserId: true },
    })
    return {
      mode: 'USERS',
      userIds: [...new Set(bindings.map(binding => binding.wecomUserId))],
      skipped: mention.userIds.length - bindings.length,
    }
  }

  private async sendAppMpnewsItem(input: {
    readonly item: DeliveryMessageRow
    readonly delivery: ClaimedDelivery
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
  }): Promise<WecomTransportResult> {
    const appId = input.delivery.app_id
    if (appId === null) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_MPNEWS_APP_MISSING', message: 'mpnews 投递缺少应用' }
    }
    const payload = asRecord(input.item.renderedMessage.payloadSnapshot)
    const coverAssetId = typeof payload?.coverAssetId === 'string' ? payload.coverAssetId : null
    const title = typeof payload?.title === 'string' ? payload.title : ''
    const content = typeof payload?.content === 'string' ? payload.content : ''
    if (coverAssetId === null || title.length === 0 || content.length === 0) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_MPNEWS_PAYLOAD_INVALID', message: 'mpnews 内容快照不完整' }
    }
    const cover = await this.resolveMpnewsCoverMediaId(appId, coverAssetId, input.accessToken)
    if (!cover.ok) {
      return cover
    }
    const inline = await this.renderMpnewsInlineImages(appId, content, input.accessToken)
    if (!inline.ok) {
      return inline
    }
    return this.appTransport.sendMpnews({
      accessToken: input.accessToken,
      agentId: input.agentId,
      toUser: input.toUser,
      articles: [{
        title,
        thumbMediaId: cover.mediaId,
        author: typeof payload?.author === 'string' ? payload.author : null,
        contentSourceUrl: typeof payload?.contentSourceUrl === 'string' ? payload.contentSourceUrl : null,
        content: inline.content,
        digest: typeof payload?.digest === 'string' ? payload.digest : null,
      }],
    })
  }

  private async resolveMpnewsCoverMediaId(
    appId: string,
    assetId: string,
    accessToken: string,
  ): Promise<{ readonly ok: true, readonly mediaId: string } | { readonly ok: false, readonly kind: WecomTransportFailureKind, readonly code: string, readonly message: string }> {
    const cacheKey = `mpnews-cover:${appId}:${assetId}`
    const cached = await this.readMediaCache(cacheKey)
    if (cached !== null) {
      return { ok: true, mediaId: cached }
    }
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: {
        mediaType: true,
        status: true,
        deletedAt: true,
        objectKey: true,
        mimeType: true,
        originalFilename: true,
      },
    })
    if (asset === null || asset.mediaType !== 'IMAGE' || asset.status !== 'READY' || asset.deletedAt !== null || asset.objectKey === null) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_MPNEWS_COVER_INVALID', message: 'mpnews 封面资产不可用' }
    }
    let buffer: Buffer
    try {
      buffer = await this.mediaService.read(asset.objectKey)
    }
    catch {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_MPNEWS_COVER_READ_FAILED', message: '读取 mpnews 封面失败' }
    }
    const prepared = await this.mediaService.prepareAppImage({
      buffer,
      mimeType: asset.mimeType,
      filename: asset.originalFilename,
    })
    if (!prepared.ok) {
      return { ok: false, kind: 'REJECTED', code: prepared.code, message: prepared.message }
    }
    const uploaded = await this.appTransport.uploadImage({
      accessToken,
      buffer: prepared.buffer,
      mimeType: prepared.mimeType,
      filename: prepared.filename,
    })
    // uploadImage 的错误类型与传输结果同构；成功时缓存 3 天。
    if (!uploaded.ok) {
      return uploaded
    }
    await this.writeMediaCache(cacheKey, uploaded.mediaId, new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000))
    return { ok: true, mediaId: uploaded.mediaId }
  }

  private async renderMpnewsInlineImages(
    appId: string,
    content: string,
    accessToken: string,
  ): Promise<{ readonly ok: true, readonly content: string } | { readonly ok: false, readonly kind: WecomTransportFailureKind, readonly code: string, readonly message: string }> {
    const assetIds = [...new Set([...content.matchAll(/\bdata-asset-id\s*=\s*["']([^"']+)["']/giu)]
      .map(match => match[1])
      .filter((assetId): assetId is string => assetId !== undefined))]
    let rendered = content
    for (const assetId of assetIds) {
      const cacheKey = `mpnews-inline-url:${appId}:${assetId}`
      let imageUrl = await this.readMediaCache(cacheKey)
      if (imageUrl === null) {
        const asset = await this.prisma.mediaAsset.findUnique({
          where: { id: assetId },
          select: {
            mediaType: true,
            status: true,
            deletedAt: true,
            objectKey: true,
            mimeType: true,
            originalFilename: true,
          },
        })
        if (asset === null || asset.mediaType !== 'IMAGE' || asset.status !== 'READY' || asset.deletedAt !== null || asset.objectKey === null) {
          return { ok: false, kind: 'REJECTED', code: 'WECOM_MPNEWS_INLINE_INVALID', message: 'mpnews 正文图片资产不可用' }
        }
        let buffer: Buffer
        try {
          buffer = await this.mediaService.read(asset.objectKey)
        }
        catch {
          return { ok: false, kind: 'REJECTED', code: 'WECOM_MPNEWS_INLINE_READ_FAILED', message: '读取 mpnews 正文图片失败' }
        }
        const prepared = await this.mediaService.prepareMpnewsInlineImage({
          buffer,
          mimeType: asset.mimeType,
          filename: asset.originalFilename,
        })
        if (!prepared.ok) {
          return { ok: false, kind: 'REJECTED', code: prepared.code, message: prepared.message }
        }
        const uploaded = await this.appTransport.uploadImageUrl({
          accessToken,
          buffer: prepared.buffer,
          mimeType: prepared.mimeType,
          filename: prepared.filename,
        })
        if (!uploaded.ok) {
          return uploaded
        }
        imageUrl = uploaded.url
        await this.writeMediaCache(cacheKey, imageUrl, null)
      }
      const escapedUrl = imageUrl.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')
      const pattern = new RegExp(`<img\\b[^>]*\\bdata-asset-id\\s*=\\s*["']${assetId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}["'][^>]*>`, 'giu')
      rendered = rendered.replace(pattern, (tag) => {
        const withoutData = tag.replace(/\sdata-asset-id\s*=\s*["'][^"']*["']/iu, '')
        return withoutData.replace(/^<img\b/iu, `<img src="${escapedUrl}"`)
      })
    }
    return { ok: true, content: rendered }
  }

  private async readMediaCache(key: string): Promise<string | null> {
    const row = await this.prisma.wecomMediaCache.findUnique({
      where: { key },
      select: { value: true, expiresAt: true },
    })
    if (row === null) return null
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) return null
    return row.value
  }

  private async writeMediaCache(key: string, value: string, expiresAt: Date | null): Promise<void> {
    await this.prisma.wecomMediaCache.upsert({
      where: { key },
      update: { value, expiresAt },
      create: { key, value, expiresAt },
    })
  }

  private async findDeliveryMessages(deliveryId: string): Promise<DeliveryMessageRow[]> {
    return this.prisma.notificationDeliveryMessage.findMany({
      where: { deliveryId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        deliveryId: true,
        renderedMessageId: true,
        sortOrder: true,
        status: true,
        attemptCount: true,
        nextAttemptAt: true,
        providerMsgId: true,
        failureCode: true,
        failureMessage: true,
        acceptedAt: true,
        renderedMessage: {
          select: { kind: true, payloadSnapshot: true },
        },
      },
    })
  }

  private messageContent(value: Prisma.JsonValue): string | null {
    const record = asRecord(value)
    return typeof record?.content === 'string' && record.content.length > 0 ? record.content : null
  }

  /**
   * 新内容模型的逐消息项发送。TEXT 阶段只处理文本；已 ACCEPTED 的项不重发，
   * 失败项沿用投递级退避，后续项在前项最终失败时标记 SKIPPED。
   */
  private async deliverMessageItems(input: {
    readonly delivery: ClaimedDelivery
    readonly items: readonly DeliveryMessageRow[]
    readonly notificationId: string
    readonly send: (item: DeliveryMessageRow, isFirstText: boolean) => Promise<WecomTransportResult>
    readonly onFirstAccepted?: () => Promise<void>
  }): Promise<void> {
    let sentAny = false
    let sentText = false
    for (const item of input.items) {
      if (item.status === 'ACCEPTED') {
        sentAny = true
        if (item.renderedMessage.kind === 'TEXT') sentText = true
        continue
      }
      if (item.status !== 'PENDING' && item.status !== 'SENDING') {
        await this.skipRemainingMessages(input.delivery.id, item.sortOrder)
        await this.finalizeMessageDelivery(input.delivery.id, sentAny ? 'PARTIAL' : 'FAILED')
        return
      }

      const isFirstText = item.renderedMessage.kind === 'TEXT' && !sentText
      const result = await input.send(item, isFirstText)
      if (result.ok) {
        await this.prisma.notificationDeliveryMessage.update({
          where: { id: item.id },
          data: {
            status: 'ACCEPTED',
            attemptCount: { increment: 1 },
            providerMsgId: result.msgId,
            acceptedAt: new Date(),
            failureCode: null,
            failureMessage: null,
          },
        })
        await this.prisma.wecomDelivery.update({
          where: { id: input.delivery.id },
          data: {
            ...(input.delivery.content_sent_at === null ? { contentSentAt: new Date() } : {}),
            ...(sentAny || result.msgId === null ? {} : { providerMsgId: result.msgId }),
            failureCode: null,
            failureMessage: null,
          },
        })
        if (isFirstText && input.onFirstAccepted !== undefined) {
          await input.onFirstAccepted()
        }
        if (item.renderedMessage.kind === 'TEXT') sentText = true
        sentAny = true
        continue
      }

      if (isRetryableWecomFailure(result.kind)) {
        if (input.delivery.attempt_count + 1 >= MAX_ATTEMPTS) {
          await this.prisma.notificationDeliveryMessage.update({
            where: { id: item.id },
            data: {
              status: 'FAILED',
              attemptCount: { increment: 1 },
              failureCode: result.code,
              failureMessage: result.message.slice(0, 255),
            },
          })
          await this.skipRemainingMessages(input.delivery.id, item.sortOrder)
          await this.finalizeMessageDelivery(input.delivery.id, sentAny ? 'PARTIAL' : 'FAILED')
          return
        }
        const delay = result.code.includes('RATE_LIMITED')
          ? RATE_LIMIT_RETRY_MS
          : RETRY_DELAYS_MS[Math.min(item.attemptCount, RETRY_DELAYS_MS.length - 1)] ?? 120_000
        await this.prisma.notificationDeliveryMessage.update({
          where: { id: item.id },
          data: {
            nextAttemptAt: new Date(Date.now() + delay),
            failureCode: result.code,
            failureMessage: result.message.slice(0, 255),
          },
        })
        await this.failDelivery(input.delivery, result.code, result.message, input.notificationId, result.invalidUserIds)
        return
      }

      await this.prisma.notificationDeliveryMessage.update({
        where: { id: item.id },
        data: {
          status: 'FAILED',
          attemptCount: { increment: 1 },
          failureCode: result.code,
          failureMessage: result.message.slice(0, 255),
        },
      })
      await this.skipRemainingMessages(input.delivery.id, item.sortOrder)
      await this.finalizeMessageDelivery(input.delivery.id, sentAny ? 'PARTIAL' : 'FAILED')
      return
    }

    await this.finalizeMessageDelivery(input.delivery.id, 'ACCEPTED')
  }

  private async skipRemainingMessages(deliveryId: string, afterSortOrder: number): Promise<void> {
    await this.prisma.notificationDeliveryMessage.updateMany({
      where: {
        deliveryId,
        sortOrder: { gt: afterSortOrder },
        status: 'PENDING',
      },
      data: {
        status: 'SKIPPED',
        failureCode: 'PREVIOUS_MESSAGE_FAILED',
        failureMessage: '前序消息失败，后续消息未发送',
      },
    })
  }

  private async finalizeMessageDelivery(
    deliveryId: string,
    status: 'ACCEPTED' | 'PARTIAL' | 'FAILED',
  ): Promise<void> {
    await this.prisma.wecomDelivery.update({
      where: { id: deliveryId },
      data: {
        status,
        acceptedAt: status === 'ACCEPTED' ? new Date() : null,
        failureCode: status === 'ACCEPTED' ? null : 'WECOM_MESSAGE_PARTIAL',
        failureMessage: status === 'ACCEPTED' ? null : '至少一条消息项未发送',
      },
    })
  }

  private async sendAppMedia(
    delivery: ClaimedDelivery,
    accessToken: string,
    agentId: number,
    toUser: string,
  ): Promise<boolean> {
    const items = await this.prisma.wecomDeliveryMedia.findMany({
      where: { deliveryId: delivery.id, status: 'PENDING' },
      orderBy: { sortOrder: 'asc' },
      include: {
        mediaAsset: {
          select: {
            mediaType: true,
            status: true,
            deletedAt: true,
            objectKey: true,
            mimeType: true,
            originalFilename: true,
          },
        },
      },
    })
    let failed = false
    const now = new Date()
    for (const item of items) {
      const asset = item.mediaAsset
      if (
        asset.status !== 'READY'
        || asset.deletedAt !== null
        || asset.objectKey === null
        || asset.mediaType !== 'IMAGE'
      ) {
        await this.markMediaFailure(item.id, 'MEDIA_NOT_READY', '媒体资产不可用')
        failed = true
        continue
      }
      let buffer: Buffer
      try {
        buffer = await this.mediaService.read(asset.objectKey)
      }
      catch {
        await this.markMediaFailure(item.id, 'MEDIA_READ_FAILED', '读取媒体资产失败')
        failed = true
        continue
      }
      const prepared = await this.mediaService.prepareAppImage({
        buffer,
        mimeType: asset.mimeType,
        filename: asset.originalFilename ?? 'image.png',
      })
      if (!prepared.ok) {
        await this.markMediaFailure(item.id, prepared.code, prepared.message)
        failed = true
        continue
      }
      let mediaId = item.mediaId
      if (mediaId === null || item.mediaIdExpiresAt === null || item.mediaIdExpiresAt.getTime() <= now.getTime()) {
        const upload = await this.appTransport.uploadImage({
          accessToken,
          buffer: prepared.buffer,
          mimeType: prepared.mimeType,
          filename: prepared.filename,
        })
        if (!upload.ok) {
          await this.markMediaFailure(item.id, upload.code, upload.message)
          failed = true
          continue
        }
        mediaId = upload.mediaId
        await this.prisma.wecomDeliveryMedia.update({
          where: { id: item.id },
          data: {
            mediaId,
            mediaIdExpiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1_000),
          },
        })
      }
      const sent = await this.appTransport.sendImage({
        accessToken,
        agentId,
        toUser,
        mediaId,
      })
      if (!sent.ok) {
        await this.markMediaFailure(item.id, sent.code, sent.message)
        failed = true
        continue
      }
      await this.prisma.wecomDeliveryMedia.update({
        where: { id: item.id },
        data: {
          status: 'ACCEPTED',
          attemptCount: { increment: 1 },
          acceptedAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      })
    }
    return failed
  }

  private async sendRobotMedia(delivery: ClaimedDelivery, webhookKey: string): Promise<boolean> {
    const items = await this.prisma.wecomDeliveryMedia.findMany({
      where: { deliveryId: delivery.id, status: 'PENDING' },
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
    let failed = false
    for (const item of items) {
      const asset = item.mediaAsset
      if (
        asset.status !== 'READY'
        || asset.deletedAt !== null
        || asset.objectKey === null
        || asset.mediaType !== 'IMAGE'
      ) {
        await this.markMediaFailure(item.id, 'MEDIA_NOT_READY', '媒体资产不可用')
        failed = true
        continue
      }
      let buffer: Buffer
      try {
        buffer = await this.mediaService.read(asset.objectKey)
      }
      catch {
        await this.markMediaFailure(item.id, 'MEDIA_READ_FAILED', '读取媒体资产失败')
        failed = true
        continue
      }
      const prepared = await this.mediaService.prepareRobotImage(buffer)
      if (!prepared.ok) {
        await this.markMediaFailure(item.id, prepared.code, prepared.message)
        failed = true
        continue
      }
      const sent = await this.robotTransport.sendImage({
        webhookKey,
        base64: prepared.base64,
        md5: prepared.md5,
      })
      if (!sent.ok) {
        await this.markMediaFailure(item.id, sent.code, sent.message)
        failed = true
        continue
      }
      await this.prisma.wecomDeliveryMedia.update({
        where: { id: item.id },
        data: {
          status: 'ACCEPTED',
          attemptCount: { increment: 1 },
          acceptedAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      })
    }
    return failed
  }

  private async markMediaFailure(id: string, code: string, message: string): Promise<void> {
    await this.prisma.wecomDeliveryMedia.update({
      where: { id },
      data: {
        status: 'FAILED',
        attemptCount: { increment: 1 },
        failureCode: code,
        failureMessage: message.slice(0, 255),
      },
    })
  }

  private async finalizeDelivery(deliveryId: string, mediaFailed: boolean): Promise<void> {
    const media = await this.prisma.wecomDeliveryMedia.findMany({
      where: { deliveryId },
      select: { status: true },
    })
    const failed = mediaFailed || media.some(item => item.status === 'FAILED')
    await this.prisma.wecomDelivery.update({
      where: { id: deliveryId },
      data: {
        status: failed ? 'PARTIAL' : 'ACCEPTED',
        acceptedAt: failed ? null : new Date(),
        failureCode: failed ? 'WECOM_MEDIA_PARTIAL' : null,
        failureMessage: failed ? '正文已发送，但至少一个附件发送失败' : null,
      },
    })
  }

  private async failDelivery(
    delivery: ClaimedDelivery,
    code: string,
    message: string,
    notificationId: string,
    invalidUserIds?: readonly string[],
  ): Promise<void> {
    const retryable = isRetryableWecomFailure(kindFromCode(code))
    const attempt = delivery.attempt_count + 1
    const delay = code.includes('RATE_LIMITED')
      ? RATE_LIMIT_RETRY_MS
      : RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? 120_000
    const nextAttemptAt = new Date(Date.now() + delay)
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { expiresAt: true },
    })
    const expired = notification?.expiresAt !== null
      && notification?.expiresAt !== undefined
      && nextAttemptAt.getTime() >= notification.expiresAt.getTime()
    const finalFailure = !retryable || attempt >= MAX_ATTEMPTS || expired

    if (invalidUserIds !== undefined && delivery.app_id !== null && delivery.recipient_user_id !== null) {
      await this.prisma.wecomAppMembership.updateMany({
        where: { appId: delivery.app_id, userId: delivery.recipient_user_id },
        data: { status: 'INVALID' },
      })
    }

    await this.prisma.wecomDelivery.update({
      where: { id: delivery.id },
      data: {
        status: finalFailure ? (expired ? 'EXPIRED' : 'FAILED') : 'PENDING',
        attemptCount: { increment: 1 },
        nextAttemptAt: finalFailure ? undefined : nextAttemptAt,
        failureCode: code,
        failureMessage: message.slice(0, 255),
      },
    })
  }

  private async markDelivery(
    id: string,
    status: 'FAILED' | 'SKIPPED' | 'EXPIRED',
    code: string,
    message: string,
  ): Promise<void> {
    await this.prisma.wecomDelivery.update({
      where: { id },
      data: {
        status,
        failureCode: code,
        failureMessage: message.slice(0, 255),
      },
    })
  }

  private async refreshNotificationStatus(notificationId: string): Promise<void> {
    const wecomRows = await this.prisma.wecomDelivery.groupBy({
      by: ['status'],
      where: { notificationId },
      _count: { _all: true },
    })
    const counts = new Map<string, number>()
    for (const row of wecomRows) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + row._count._all)
    }
    const pending = (counts.get('PENDING') ?? 0) + (counts.get('SENDING') ?? 0)
    const accepted = counts.get('ACCEPTED') ?? 0
    const partial = counts.get('PARTIAL') ?? 0
    const expired = counts.get('EXPIRED') ?? 0
    const skipped = counts.get('SKIPPED') ?? 0
    const total = accepted + partial + expired + skipped
      + (counts.get('FAILED') ?? 0)
      + (counts.get('CANCELLED') ?? 0)
      + pending
    const inboxTotal = await this.prisma.notificationInboxItem.count({ where: { notificationId } })
    if (total === 0) {
      if (inboxTotal === 0) {
        return
      }
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
      return
    }

    let status: 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'SKIPPED' | 'EXPIRED' | 'CANCELLED'
    if (pending > 0) {
      status = 'PENDING'
    }
    else if (accepted === total) {
      status = 'COMPLETED'
    }
    else if (accepted + partial > 0) {
      status = 'PARTIAL'
    }
    else if (expired > 0) {
      status = inboxTotal > 0 ? 'PARTIAL' : 'EXPIRED'
    }
    else if (skipped === total) {
      status = inboxTotal > 0 ? 'PARTIAL' : 'SKIPPED'
    }
    else if ((counts.get('CANCELLED') ?? 0) === total) {
      status = inboxTotal > 0 ? 'PARTIAL' : 'CANCELLED'
    }
    else {
      status = inboxTotal > 0 ? 'PARTIAL' : 'FAILED'
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        status,
        completedAt: status === 'PENDING' ? null : new Date(),
      },
    })
  }

  private async recoverStaleSendingDeliveries(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_SENDING_MS)
    const rows = await this.prisma.wecomDelivery.findMany({
      where: { status: 'SENDING', updatedAt: { lt: staleBefore } },
      select: { attemptCount: true, id: true, notificationId: true },
    })
    if (rows.length === 0) {
      return
    }
    const retryable = rows.filter(row => row.attemptCount < MAX_ATTEMPTS)
    const exhausted = rows.filter(row => row.attemptCount >= MAX_ATTEMPTS)
    if (retryable.length > 0) {
      await this.prisma.wecomDelivery.updateMany({
        where: { id: { in: retryable.map(row => row.id) }, status: 'SENDING' },
        data: {
          status: 'PENDING',
          nextAttemptAt: new Date(),
          attemptCount: { increment: 1 },
          failureCode: 'SENDING_RECOVERED',
          failureMessage: '发送状态未知，已重新排队',
          updatedAt: new Date(),
        },
      })
    }
    if (exhausted.length > 0) {
      await this.prisma.wecomDelivery.updateMany({
        where: { id: { in: exhausted.map(row => row.id) }, status: 'SENDING' },
        data: {
          status: 'FAILED',
          attemptCount: { increment: 1 },
          failureCode: 'SENDING_RECOVERED',
          failureMessage: '发送状态未知且已超过重试上限',
          updatedAt: new Date(),
        },
      })
    }
    for (const notificationId of new Set(rows.map(row => row.notificationId))) {
      await this.refreshNotificationStatus(notificationId)
    }
  }

  private async expireOverdueDeliveries(): Promise<void> {
    const rows = await this.prisma.wecomDelivery.findMany({
      where: { status: 'PENDING', notification: { expiresAt: { lte: new Date() } } },
      select: { id: true, notificationId: true },
    })
    if (rows.length === 0) {
      return
    }
    await this.prisma.wecomDelivery.updateMany({
      where: { id: { in: rows.map(row => row.id) } },
      data: { status: 'EXPIRED', failureCode: 'EXPIRED', failureMessage: '通知已过期' },
    })
    for (const notificationId of new Set(rows.map(row => row.notificationId))) {
      await this.refreshNotificationStatus(notificationId)
    }
  }
}

function kindFromCode(code: string): 'TIMEOUT' | 'NETWORK' | 'RATE_LIMITED' | 'REJECTED' | 'TOKEN_INVALID' | 'INVALID_RECIPIENT' | 'WEBHOOK_INVALID' | 'UNKNOWN' {
  if (code.includes('TIMEOUT')) return 'TIMEOUT'
  if (code.includes('NETWORK') || code.includes('UPSTREAM')) return 'NETWORK'
  if (code.includes('RATE_LIMITED')) return 'RATE_LIMITED'
  if (code.includes('TOKEN_INVALID')) return 'TOKEN_INVALID'
  if (code.includes('INVALID_RECIPIENT')) return 'INVALID_RECIPIENT'
  if (code.includes('WEBHOOK_INVALID')) return 'WEBHOOK_INVALID'
  if (code.includes('REJECTED')) return 'REJECTED'
  return 'UNKNOWN'
}
