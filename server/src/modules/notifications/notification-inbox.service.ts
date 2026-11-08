import { Injectable, Logger } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  NOTIFICATION_EVENT_DOMAIN,
  notificationDomainOf,
} from './notification.types'
import type {
  NotificationInboxDetailDto,
  NotificationInboxItemDto,
  NotificationInboxNewDto,
  NotificationInboxNewItemDto,
  NotificationInboxNewQueryDto,
  NotificationInboxPageDto,
  NotificationInboxQueryDto,
  NotificationInboxReadAllDto,
  NotificationInboxUnreadCountDto,
} from './notification-inbox.dto'

const MIN_UUID = '00000000-0000-0000-0000-000000000000'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

type InboxRow = {
  readonly id: string
  readonly eventType: string
  readonly titleSnapshot: string
  readonly bodySnapshot: string
  readonly linkUrlSnapshot: string | null
  readonly readAt: Date | null
  readonly archivedAt: Date | null
  readonly createdAt: Date
}

type InboxNewRow = {
  readonly id: string
  readonly eventType: string
  readonly titleSnapshot: string
  readonly bodySnapshot: string
  readonly linkUrlSnapshot: string | null
  readonly createdAt: Date
  readonly createdAtCursor: string
}

interface InboxCursor {
  readonly createdAt: string
  readonly id: string
}

const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/u

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

function domainEventTypes(domain: string | undefined): string[] | null {
  if (domain === undefined) {
    return null
  }
  return Object.entries(NOTIFICATION_EVENT_DOMAIN)
    .filter(([, value]) => value === domain)
    .map(([eventType]) => eventType)
}

function encodeCursor(cursor: InboxCursor): string {
  return Buffer.from(JSON.stringify({
    createdAt: cursor.createdAt,
    id: cursor.id,
  })).toString('base64url')
}

function decodeCursor(raw: string | undefined): InboxCursor | null {
  if (raw === undefined || raw.length === 0) {
    return null
  }
  try {
    const record = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>
    const createdAt = typeof record.createdAt === 'string' ? record.createdAt : null
    const id = typeof record.id === 'string' ? record.id : null
    if (
      createdAt === null
      || !CURSOR_TIMESTAMP_PATTERN.test(createdAt)
      || Number.isNaN(new Date(createdAt).getTime())
      || id === null
      || !UUID_PATTERN.test(id)
    ) {
      throw new Error('invalid cursor')
    }
    return { createdAt, id }
  }
  catch {
    throw new ApiException(422, 'NOTIFICATION_INBOX_CURSOR_INVALID', '通知游标无效')
  }
}

/**
 * 站内收件箱只按当前会话用户查询；所有资源定位都带 userId 条件，
 * 其他用户的消息统一 404，不区分不存在与无权访问。
 */
@Injectable()
export class NotificationInboxService {
  private readonly logger = new Logger(NotificationInboxService.name)

  constructor(private readonly prisma: PrismaService) {}

  private metric(name: string, value: number, labels: Record<string, string> = {}): void {
    this.logger.log(JSON.stringify({ kind: 'metric', labels, metric: name, value }))
  }

  private toItem(row: InboxRow): NotificationInboxItemDto {
    return {
      id: row.id,
      eventType: row.eventType,
      domain: notificationDomainOf(row.eventType),
      title: row.titleSnapshot,
      readAt: iso(row.readAt),
      archivedAt: iso(row.archivedAt),
      createdAt: row.createdAt.toISOString(),
    }
  }

  private toDetail(row: InboxRow): NotificationInboxDetailDto {
    return {
      ...this.toItem(row),
      body: row.bodySnapshot,
      linkUrl: row.linkUrlSnapshot,
    }
  }

  private toNewItem(row: InboxRow): NotificationInboxNewItemDto {
    return {
      ...this.toItem(row),
      body: row.bodySnapshot,
      linkUrl: row.linkUrlSnapshot,
    }
  }

  private baseWhere(userId: string, query: NotificationInboxQueryDto): Prisma.NotificationInboxItemWhereInput {
    const eventTypes = domainEventTypes(query.domain)
    return {
      userId,
      ...(query.status === 'archived' ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(query.status === 'unread' ? { readAt: null } : {}),
      ...(eventTypes === null ? {} : { eventType: { in: eventTypes } }),
    }
  }

  async list(userId: string, query: NotificationInboxQueryDto): Promise<NotificationInboxPageDto> {
    const startedAt = Date.now()
    const where = this.baseWhere(userId, query)
    const [total, rows] = await Promise.all([
      this.prisma.notificationInboxItem.count({ where }),
      this.prisma.notificationInboxItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])
    this.metric('notification_inbox_list_latency_ms', Date.now() - startedAt, { scope: 'self' })
    return {
      items: rows.map(row => this.toItem(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    }
  }

  async unreadCount(userId: string): Promise<NotificationInboxUnreadCountDto> {
    const total = await this.prisma.notificationInboxItem.count({
      where: { userId, readAt: null, archivedAt: null },
    })
    this.metric('notification_inbox_unread', total, { scope: 'self' })
    return { total }
  }

  async get(userId: string, id: string): Promise<NotificationInboxDetailDto> {
    const row = await this.prisma.notificationInboxItem.findFirst({ where: { id, userId } })
    if (row === null) {
      throw new ApiException(404, 'NOTIFICATION_INBOX_NOT_FOUND', '通知不存在')
    }
    return this.toDetail(row)
  }

  async markRead(userId: string, id: string): Promise<NotificationInboxDetailDto> {
    return this.setRead(userId, id, new Date())
  }

  async markUnread(userId: string, id: string): Promise<NotificationInboxDetailDto> {
    return this.setRead(userId, id, null)
  }

  private async setRead(userId: string, id: string, readAt: Date | null): Promise<NotificationInboxDetailDto> {
    const updated = await this.prisma.notificationInboxItem.updateMany({
      where: { id, userId },
      data: { readAt },
    })
    if (updated.count === 0) {
      throw new ApiException(404, 'NOTIFICATION_INBOX_NOT_FOUND', '通知不存在')
    }
    return this.get(userId, id)
  }

  async readAll(userId: string, input: NotificationInboxReadAllDto): Promise<{ updated: number, unreadTotal: number }> {
    const eventTypes = domainEventTypes(input.domain)
    const updated = await this.prisma.notificationInboxItem.updateMany({
      where: {
        userId,
        archivedAt: null,
        readAt: null,
        ...(eventTypes === null ? {} : { eventType: { in: eventTypes } }),
      },
      data: { readAt: new Date() },
    })
    return { updated: updated.count, unreadTotal: (await this.unreadCount(userId)).total }
  }

  async archive(userId: string, id: string): Promise<NotificationInboxDetailDto> {
    const row = await this.prisma.notificationInboxItem.findFirst({ where: { id, userId } })
    if (row === null) {
      throw new ApiException(404, 'NOTIFICATION_INBOX_NOT_FOUND', '通知不存在')
    }
    await this.prisma.notificationInboxItem.update({
      where: { id },
      data: { archivedAt: new Date(), readAt: row.readAt ?? new Date() },
    })
    return this.get(userId, id)
  }

  async unarchive(userId: string, id: string): Promise<NotificationInboxDetailDto> {
    const updated = await this.prisma.notificationInboxItem.updateMany({
      where: { id, userId },
      data: { archivedAt: null },
    })
    if (updated.count === 0) {
      throw new ApiException(404, 'NOTIFICATION_INBOX_NOT_FOUND', '通知不存在')
    }
    return this.get(userId, id)
  }

  async newItems(userId: string, query: NotificationInboxNewQueryDto): Promise<NotificationInboxNewDto> {
    const cursor = decodeCursor(query.cursor)
    const unreadTotal = (await this.unreadCount(userId)).total
    if (cursor === null) {
      const now = new Date()
      return {
        items: [],
        unreadTotal,
        nextCursor: encodeCursor({ createdAt: now.toISOString(), id: MIN_UUID }),
        hasMore: false,
        serverTime: now.toISOString(),
      }
    }

    // created_at 是 timestamptz(6)，而 JS Date 只能保留毫秒。游标必须使用
    // 数据库文本微秒值参与元组比较，否则同一秒内带微秒的消息会被反复返回。
    const rows = await this.prisma.$queryRaw<InboxNewRow[]>(Prisma.sql`
      SELECT
        "id",
        "event_type" AS "eventType",
        "title_snapshot" AS "titleSnapshot",
        "body_snapshot" AS "bodySnapshot",
        "link_url_snapshot" AS "linkUrlSnapshot",
        "created_at" AS "createdAt",
        to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtCursor"
      FROM "notification_inbox_items"
      WHERE "user_id" = ${userId}::uuid
        AND "read_at" IS NULL
        AND "archived_at" IS NULL
        AND ("created_at", "id") > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)
      ORDER BY "created_at" ASC, "id" ASC
      LIMIT ${query.limit + 1}
    `)
    const hasMore = rows.length > query.limit
    const items = rows.slice(0, query.limit)
    const last = items.at(-1)
    const nextCursor = last === undefined
      ? encodeCursor(cursor)
      : encodeCursor({ createdAt: last.createdAtCursor, id: last.id })
    this.metric('notification_inbox_new_batch', items.length, { scope: 'self' })
    return {
      items: items.map(row => this.toNewItem({
        id: row.id,
        eventType: row.eventType,
        titleSnapshot: row.titleSnapshot,
        bodySnapshot: row.bodySnapshot,
        linkUrlSnapshot: row.linkUrlSnapshot,
        readAt: null,
        archivedAt: null,
        createdAt: row.createdAt,
      })),
      unreadTotal,
      nextCursor,
      hasMore,
      serverTime: new Date().toISOString(),
    }
  }
}
