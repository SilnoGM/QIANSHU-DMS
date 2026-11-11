import { randomInt, randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  isWithinQuietHours,
  nextQuietHoursEnd,
  parseNotificationQuietHours,
} from './notification-quiet-hours'
import { noopSystemNotifications } from './noop-system-notification'
import { SystemNotificationService } from './system-notification.service'
import {
  ASSISTANT_TRANSPORT,
  type AssistantTransport,
  type AssistantTransportResult,
} from './notification.types'

const LEASE_ID = 'assistant-dispatch'
const LEASE_TTL_MS = 30_000
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const
const OFFLINE_RETRY_DELAYS_MS = [30_000, 120_000, 300_000] as const
const RATE_LIMIT_RETRY_MS = 60_000
const HIGH_PRIORITY_BURST = 3
const NOTIFICATION_TIME_FORMAT = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
  day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit', month: '2-digit', timeZone: 'Asia/Shanghai', year: 'numeric',
})
function notificationTime(value: Date): string {
  const parts = new Map(NOTIFICATION_TIME_FORMAT.formatToParts(value).map(part => [part.type, part.value]))
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')} ${parts.get('hour')}:${parts.get('minute')}`
}

interface ClaimedDelivery {
  readonly id: string
  readonly notification_id: string
  readonly recipient_user_id: string | null
  readonly target_id: string | null
  readonly account_id: string | null
  readonly attempt_count: number
  readonly rendered_content: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

/**
 * 千树小助理派发器。
 *
 * 进程内循环 + 数据库租约，保证同一时刻只有一个实例领取交付。只做领取、发送、
 * 状态更新与退避；站内通知不需要 worker。
 */
@Injectable()
export class AssistantDispatchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AssistantDispatchService.name)
  private readonly ownerId = randomUUID()
  private running = false
  private lastSentAt = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(ASSISTANT_TRANSPORT) private readonly transport: AssistantTransport,
    private readonly notifications: SystemNotificationService = noopSystemNotifications,
  ) {}

  onApplicationBootstrap(): void {
    const app = this.configService.get<{ readonly nodeEnv?: string }>('app')
    if (app?.nodeEnv === 'test') {
      return
    }
    const config = this.configService.get<AssistantConfiguration>('assistant')
    if (config === undefined || config.token === null || !config.workerEnabled) {
      this.logger.log('assistant worker disabled: token or worker switch missing')
      return
    }
    this.running = true
    void this.loop(config)
  }

  onModuleDestroy(): void {
    this.running = false
  }

  private async loop(config: AssistantConfiguration): Promise<void> {
    while (this.running) {
      try {
        await this.dispatchOnce(config.batchSize)
      }
      catch (error) {
        this.logger.warn(`assistant dispatch cycle failed: ${error instanceof Error ? error.name : 'unknown'}`)
      }
      await sleep(config.pollMs)
    }
  }

  /** 公开给测试直接触发一轮，不依赖真实定时器。 */
  async dispatchOnce(batchSize: number): Promise<void> {
    if (!await this.acquireLease()) {
      return
    }
    const setting = await this.prisma.notificationChannelSettings.findUnique({
      where: { channel: 'ASSISTANT' },
      select: { defaultQuietHours: true, enabled: true },
    })
    if (setting === null || !setting.enabled) {
      return
    }

    await this.expireOverdueDeliveries()
    const deliveries = await this.claimDeliveries(batchSize)
    for (const delivery of deliveries) {
      if (!await this.acquireLease()) {
        this.logger.warn('assistant dispatch lease lost during batch')
        break
      }
      await this.dispatchDelivery(delivery, setting.defaultQuietHours)
    }
  }

  private async acquireLease(): Promise<boolean> {
    const expiresAt = new Date(Date.now() + LEASE_TTL_MS)
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "assistant_dispatch_leases"
      SET "owner_id" = ${this.ownerId}::uuid,
          "expires_at" = ${expiresAt},
          "updated_at" = now()
      WHERE "id" = ${LEASE_ID}
        AND ("expires_at" IS NULL OR "expires_at" < now() OR "owner_id" = ${this.ownerId}::uuid)
      RETURNING "id"
    `)
    return rows.length > 0
  }

  /**
   * 高优先级消息最多连续领取 3 条，随后插入 1 条普通消息，避免 HIGH 洪峰
   * 长期饿死 NORMAL。普通消息等待 5 分钟或距离过期不足 10 分钟时进入高优先级
   * 泳道；老化只影响本次领取顺序，不修改 Notification.priority。
   */
  private async claimDeliveries(batchSize: number): Promise<ClaimedDelivery[]> {
    const claimed: ClaimedDelivery[] = []
    let highExhausted = false
    let normalExhausted = false

    while (claimed.length < batchSize && !(highExhausted && normalExhausted)) {
      const remaining = batchSize - claimed.length
      if (!highExhausted) {
        const highLimit = Math.min(HIGH_PRIORITY_BURST, remaining)
        const high = await this.claimDeliveriesByLane(highLimit, true)
        claimed.push(...high)
        if (high.length < highLimit) {
          highExhausted = true
        }
      }
      if (claimed.length >= batchSize) {
        break
      }
      if (!normalExhausted) {
        const remainingAfterHigh = batchSize - claimed.length
        const normalLimit = highExhausted ? remainingAfterHigh : 1
        const normal = await this.claimDeliveriesByLane(normalLimit, false)
        claimed.push(...normal)
        if (normal.length < normalLimit) {
          normalExhausted = true
        }
      }
    }

    return claimed
  }

  private async claimDeliveriesByLane(limit: number, urgent: boolean): Promise<ClaimedDelivery[]> {
    if (limit <= 0) {
      return []
    }

    // 老化与临期提升都在查询期计算，不回写通知原始优先级。
    const urgentCondition = Prisma.sql`(
      n."priority" = 'HIGH'
      OR d2."created_at" <= now() - interval '5 minutes'
      OR (n."expires_at" IS NOT NULL AND n."expires_at" <= now() + interval '10 minutes')
    )`
    const laneCondition = urgent
      ? urgentCondition
      : Prisma.sql`NOT ${urgentCondition}`

    return this.prisma.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
      UPDATE "assistant_deliveries" d
      SET "status" = 'SENDING', "updated_at" = now()
      WHERE d."id" IN (
        SELECT d2."id"
        FROM "assistant_deliveries" d2
        JOIN "notifications" n ON n."id" = d2."notification_id"
        WHERE d2."status" = 'PENDING'
          AND d2."next_attempt_at" <= now()
          AND ${laneCondition}
        ORDER BY d2."created_at" ASC, d2."id" ASC
        FOR UPDATE OF d2 SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING d."id",
                d."notification_id",
                d."recipient_user_id",
                d."target_id",
                d."account_id",
                d."attempt_count",
                d."rendered_content"
    `)
  }

  private async dispatchDelivery(delivery: ClaimedDelivery, defaultQuietHours: Prisma.JsonValue | null): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: delivery.notification_id },
      select: { eventType: true, expiresAt: true, id: true, priority: true },
    })
    if (notification === null) {
      await this.markDelivery(delivery.id, 'CANCELLED', { failureCode: 'NOTIFICATION_MISSING', failureMessage: '通知已不存在' })
      return
    }
    if (notification.expiresAt !== null && notification.expiresAt.getTime() <= Date.now()) {
      await this.markDelivery(delivery.id, 'EXPIRED', { failureCode: 'EXPIRED', failureMessage: '通知已过期' })
      await this.refreshNotificationStatus(notification.id)
      return
    }
    if (await this.deferForQuietHours(delivery, notification, defaultQuietHours)) {
      await this.refreshNotificationStatus(notification.id)
      return
    }

    const account = delivery.account_id === null
      ? null
      : await this.prisma.assistantAccount.findUnique({
        where: { id: delivery.account_id },
        select: { id: true, appId: true, enabled: true, name: true, status: true },
      })
    if (account === null || !account.enabled || account.status === 'DISABLED' || account.status === 'REQUIRES_LOGIN' || account.appId.startsWith('pending-')) {
      await this.failDelivery(delivery, 'ACCOUNT_DISABLED', '公司号不可用', false)
      await this.refreshNotificationStatus(notification.id)
      return
    }

    let toWxid: string | null = null
    let isGroup = false
    if (delivery.recipient_user_id !== null) {
      const binding = await this.prisma.assistantBinding.findFirst({
        where: {
          userId: delivery.recipient_user_id,
          accountId: account.id,
          status: 'ACTIVE',
          verifiedAt: { not: null },
        },
        select: { wxid: true },
      })
      toWxid = binding?.wxid ?? null
    }
    else if (delivery.target_id !== null) {
      const target = await this.prisma.assistantTarget.findUnique({
        where: { id: delivery.target_id },
        select: { chatroomId: true, enabled: true },
      })
      if (target?.enabled === true) {
        toWxid = target.chatroomId
        isGroup = true
      }
    }

    if (toWxid === null) {
      await this.markDelivery(delivery.id, 'SKIPPED', {
        failureCode: delivery.recipient_user_id !== null ? 'NOT_BOUND' : 'TARGET_DISABLED',
        failureMessage: delivery.recipient_user_id !== null ? '员工绑定已失效' : '群目标已停用',
      })
      await this.refreshNotificationStatus(notification.id)
      return
    }

    await this.waitForRateLimit(isGroup)
    this.lastSentAt = Date.now()
    const result = await this.transport.sendText({
      appId: account.appId,
      toWxid,
      content: delivery.rendered_content,
    })
    if (result.ok) {
      await this.prisma.assistantDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'ACCEPTED',
          attemptCount: { increment: 1 },
          acceptedAt: new Date(),
          providerMsgId: result.msgId,
          providerNewMsgId: result.newMsgId,
          failureCode: null,
          failureMessage: null,
        },
      })
      await this.prisma.assistantAccount.update({
        where: { id: account.id },
        data: { status: 'ONLINE', lastOnlineAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
      })
      await this.refreshNotificationStatus(notification.id)
      return
    }

    await this.handleFailure(delivery, result, notification.expiresAt, account.name)
    await this.refreshNotificationStatus(notification.id)
  }

  private async handleFailure(
    delivery: ClaimedDelivery,
    result: Extract<AssistantTransportResult, { ok: false }>,
    expiresAt: Date | null,
    accountName: string | null,
  ): Promise<void> {
    const attempt = delivery.attempt_count + 1
    const retryable = result.kind === 'TIMEOUT'
      || result.kind === 'NETWORK'
      || result.kind === 'RATE_LIMITED'
      || result.kind === 'OFFLINE'
    const delays = result.kind === 'OFFLINE' ? OFFLINE_RETRY_DELAYS_MS : RETRY_DELAYS_MS
    const delay = result.kind === 'RATE_LIMITED' ? RATE_LIMIT_RETRY_MS : delays[Math.min(attempt - 1, delays.length - 1)] ?? 120_000
    const nextAttemptAt = new Date(Date.now() + delay)
    const expired = expiresAt !== null && nextAttemptAt.getTime() >= expiresAt.getTime()
    const finalFailure = !retryable || attempt >= MAX_ATTEMPTS || expired

    if (delivery.account_id !== null && result.kind === 'OFFLINE') {
      await this.prisma.assistantAccount.update({
        where: { id: delivery.account_id },
        data: {
          status: 'OFFLINE',
          lastErrorCode: result.code,
          lastErrorMessage: result.message.slice(0, 255),
        },
      }).catch(() => undefined)
      const occurredAt = new Date()
      await this.notifications.publish({
        eventType: 'ASSISTANT_ACCOUNT_OFFLINE',
        source: { type: 'ASSISTANT_ACCOUNT', id: delivery.account_id },
        target: { kind: 'PERMISSION', permissionCode: 'assistant-channel:update' },
        templateKey: 'system.assistant-account.offline',
        variables: {
          accountName: accountName ?? '—',
          occurredAt: notificationTime(occurredAt),
          reason: result.message,
        },
        dedupeKey: `assistant-account-offline:${delivery.account_id}:${occurredAt.toISOString().slice(0, 10)}`,
      })
    }

    await this.prisma.assistantDelivery.update({
      where: { id: delivery.id },
      data: {
        status: finalFailure ? (expired ? 'EXPIRED' : 'FAILED') : 'PENDING',
        attemptCount: { increment: 1 },
        nextAttemptAt: finalFailure ? undefined : nextAttemptAt,
        failureCode: result.code,
        failureMessage: result.message.slice(0, 255),
        ...(finalFailure ? { acceptedAt: null } : {}),
      },
    })
  }

  /**
   * NORMAL 交付在静默窗口内不发送，直接推到窗口结束；HIGH 保持原有突破语义。
   * 策略显式配置优先，未配置时继承渠道默认静默时段。
   */
  private async deferForQuietHours(
    delivery: ClaimedDelivery,
    notification: { readonly eventType: string, readonly expiresAt: Date | null, readonly priority: 'NORMAL' | 'HIGH' },
    defaultQuietHours: Prisma.JsonValue | null,
  ): Promise<boolean> {
    if (notification.priority === 'HIGH') {
      return false
    }
    const policy = await this.prisma.notificationChannelPolicy.findUnique({
      where: { eventType_channel: { channel: 'ASSISTANT', eventType: notification.eventType } },
      select: { quietHours: true },
    })
    const quietHours = parseNotificationQuietHours(policy?.quietHours)
      ?? parseNotificationQuietHours(defaultQuietHours)
    const now = new Date()
    if (quietHours === null || !isWithinQuietHours(now, quietHours)) {
      return false
    }
    const nextAttemptAt = nextQuietHoursEnd(now, quietHours)
    if (nextAttemptAt === null) {
      return false
    }
    if (notification.expiresAt !== null && nextAttemptAt.getTime() >= notification.expiresAt.getTime()) {
      await this.markDelivery(delivery.id, 'EXPIRED', {
        failureCode: 'QUIET_HOURS_EXPIRED',
        failureMessage: '静默窗口结束前通知已过期',
      })
      return true
    }
    await this.prisma.assistantDelivery.update({
      where: { id: delivery.id },
      data: { nextAttemptAt, status: 'PENDING' },
    })
    return true
  }

  private async failDelivery(
    delivery: ClaimedDelivery,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> {
    await this.prisma.assistantDelivery.update({
      where: { id: delivery.id },
      data: {
        status: retryable ? 'PENDING' : 'FAILED',
        attemptCount: { increment: 1 },
        failureCode: code,
        failureMessage: message.slice(0, 255),
        nextAttemptAt: retryable ? new Date(Date.now() + 30_000) : undefined,
      },
    })
  }

  private async markDelivery(
    deliveryId: string,
    status: 'SKIPPED' | 'EXPIRED' | 'CANCELLED',
    failure: { readonly failureCode: string, readonly failureMessage: string },
  ): Promise<void> {
    await this.prisma.assistantDelivery.update({
      where: { id: deliveryId },
      data: {
        status,
        attemptCount: { increment: 1 },
        failureCode: failure.failureCode,
        failureMessage: failure.failureMessage.slice(0, 255),
      },
    })
  }

  private async refreshNotificationStatus(notificationId: string): Promise<void> {
    const rows = await this.prisma.assistantDelivery.groupBy({
      by: ['status'],
      where: { notificationId },
      _count: { _all: true },
    })
    const counts = new Map(rows.map(row => [row.status, row._count._all]))
    const pending = (counts.get('PENDING') ?? 0) + (counts.get('SENDING') ?? 0)
    const accepted = counts.get('ACCEPTED') ?? 0
    const expired = counts.get('EXPIRED') ?? 0
    const skipped = counts.get('SKIPPED') ?? 0
    const total = accepted + expired + skipped + (counts.get('FAILED') ?? 0) + (counts.get('CANCELLED') ?? 0) + pending
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
    else if (accepted > 0) {
      status = 'PARTIAL'
    }
    else if (expired > 0) {
      status = inboxTotal > 0 ? 'PARTIAL' : 'EXPIRED'
    }
    else if (skipped === total) {
      status = inboxTotal > 0 ? 'PARTIAL' : 'SKIPPED'
    }
    else if (counts.get('CANCELLED') === total) {
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

  private async expireOverdueDeliveries(): Promise<void> {
    const rows = await this.prisma.assistantDelivery.findMany({
      where: {
        status: 'PENDING',
        notification: { expiresAt: { lte: new Date() } },
      },
      select: { id: true, notificationId: true },
    })
    if (rows.length === 0) {
      return
    }
    await this.prisma.assistantDelivery.updateMany({
      where: { id: { in: rows.map(row => row.id) } },
      data: { status: 'EXPIRED', failureCode: 'EXPIRED', failureMessage: '通知已过期' },
    })
    for (const notificationId of new Set(rows.map(row => row.notificationId))) {
      await this.refreshNotificationStatus(notificationId)
    }
  }

  private async waitForRateLimit(isGroup: boolean): Promise<void> {
    const minimumGap = isGroup
      ? 2_000 + randomInt(0, 3_000)
      : 1_000
    const wait = Math.max(0, this.lastSentAt + minimumGap - Date.now())
    if (wait > 0) {
      await sleep(wait)
    }
  }
}
