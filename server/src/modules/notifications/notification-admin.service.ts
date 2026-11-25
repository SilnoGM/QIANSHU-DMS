import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  IMPLEMENTED_NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_EVENT_DOMAIN,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_EVENT_VARIABLES,
  notificationEventMediaCapability,
  notificationEventVariableDefinitions,
  notificationEventVariables,
} from './notification.types'
import type {
  NotificationCancelResultDto,
  NotificationEventDto,
  NotificationOverviewDto,
  NotificationRecordDetailDto,
  NotificationRecordDto,
  NotificationRecordOptionsDto,
  NotificationRecordPageDto,
  NotificationRecordQueryDto,
} from './notification-admin.dto'

export interface NotificationAdminContext {
  readonly actorUserId: string
  readonly requestId: string
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

const NOTIFICATION_RECORD_CHANNELS = ['IN_APP', 'WECOM'] as const
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
  return NOTIFICATION_EVENT_DOMAIN[eventType as keyof typeof NOTIFICATION_EVENT_DOMAIN]?.toUpperCase() ?? 'SYSTEM'
}

function resolveRecordChannels(
  value: Prisma.JsonValue,
  inAppCount: number,
  wecomDeliveryCounts: Record<string, number>,
): NotificationRecordChannel[] {
  const requested = requestedRecordChannels(value)
  if (requested.length > 0) {
    return requested
  }

  const derived: NotificationRecordChannel[] = []
  if (inAppCount > 0) {
    derived.push('IN_APP')
  }
  if (Object.values(wecomDeliveryCounts).some(count => count > 0)) {
    derived.push('WECOM')
  }
  return derived
}

function toRecordDto(
  row: NotificationRecordRow,
  wecomDeliveryCounts: Record<string, number>,
  inApp: InAppRecordCounts,
  mediaCount: number,
): NotificationRecordDto {
  return {
    id: row.id,
    notificationNo: row.notificationNo,
    eventType: row.eventType,
    eventLabel: recordEventLabel(row.eventType),
    domain: recordEventDomain(row.eventType),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    priority: row.priority,
    status: row.status,
    contentKey: row.templateKey,
    expiresAt: iso(row.expiresAt),
    publishedAt: row.publishedAt.toISOString(),
    completedAt: iso(row.completedAt),
    requestedByName: row.requestedBy?.displayName ?? null,
    channels: resolveRecordChannels(row.requestedChannels, inApp.total, wecomDeliveryCounts),
    inAppItemCount: inApp.total,
    inAppUnreadCount: inApp.unread,
    wecomDeliveryCounts,
    mediaCount,
  }
}

/** 来源中文名只从事件契约反查；历史附件或已下线的来源返回 null。 */
function resolveMediaSourceLabel(eventType: string, sourceKey: string | null): string | null {
  if (sourceKey === null) {
    return null
  }
  return notificationEventMediaCapability(eventType)?.sources.find(source => source.key === sourceKey)?.label ?? null
}

@Injectable()
export class NotificationAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 事件元数据由服务端常量派生，管理端不再各自维护事件名与变量。 */
  listEvents(): NotificationEventDto[] {
    return NOTIFICATION_EVENT_TYPES.map(eventType => ({
      eventType,
      label: NOTIFICATION_EVENT_LABELS[eventType],
      domain: NOTIFICATION_EVENT_DOMAIN[eventType].toUpperCase(),
      variables: [...(NOTIFICATION_EVENT_VARIABLES[eventType] ?? [])],
      variableDefinitions: [...(notificationEventVariableDefinitions(eventType) ?? [])],
      variablesKnown: notificationEventVariables(eventType) !== null,
      implemented: IMPLEMENTED_NOTIFICATION_EVENT_TYPES.includes(eventType),
      media: (() => {
        const capability = notificationEventMediaCapability(eventType)
        return capability === null
          ? null
          : {
              maxCount: capability.maxCount,
              kinds: [...capability.kinds],
              sources: capability.sources.map(source => ({ key: source.key, label: source.label })),
            }
      })(),
    }))
  }

  private async wecomDeliveryCounts(notificationIds: readonly string[]): Promise<Map<string, Record<string, number>>> {
    if (notificationIds.length === 0) {
      return new Map()
    }
    const rows = await this.prisma.wecomDelivery.groupBy({
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
      : NOTIFICATION_EVENT_TYPES.filter(eventType => NOTIFICATION_EVENT_DOMAIN[eventType].toUpperCase() === input.domain)
    if (domainEventTypes !== null) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), {
        eventType: { in: [...domainEventTypes] },
      }]
    }

    const keyword = input.keyword?.trim()
    if (keyword !== undefined && keyword.length > 0) {
      const keywordFilters: Prisma.NotificationWhereInput[] = [
        { notificationNo: { contains: keyword, mode: 'insensitive' } },
        { eventType: { contains: keyword, mode: 'insensitive' } },
        { sourceId: { contains: keyword, mode: 'insensitive' } },
        {
          requestedBy: {
            is: { displayName: { contains: keyword, mode: 'insensitive' } },
          },
        },
        {
          wecomDeliveries: {
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
    const [wecomDeliveryCounts, inAppCounts, mediaCounts] = await Promise.all([
      this.wecomDeliveryCounts(ids),
      this.inAppCounts(ids),
      this.mediaCounts(ids),
    ])
    return {
      items: rows.map(row => toRecordDto(
        row,
        wecomDeliveryCounts.get(row.id) ?? {},
        inAppCounts.get(row.id) ?? { total: 0, unread: 0 },
        mediaCounts.get(row.id) ?? 0,
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
    const [wecomDeliveries, inAppCounts, media] = await Promise.all([
      this.prisma.wecomDelivery.findMany({
        where: { notificationId: id },
        include: {
          recipientUser: { select: { displayName: true } },
          target: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.inAppCounts([id]),
      this.prisma.notificationMedia.findMany({
        where: { notificationId: id },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          sortOrder: true,
          sourceKey: true,
          blockedReason: true,
          mediaAsset: {
            select: { mediaType: true, mimeType: true, originalFilename: true, sizeBytes: true },
          },
        },
      }),
    ])
    const wecomMediaByDelivery = await this.wecomDeliveryMediaCounts(wecomDeliveries.map(delivery => delivery.id))
    const wecomCounts: Record<string, number> = {}
    for (const delivery of wecomDeliveries) {
      wecomCounts[delivery.status] = (wecomCounts[delivery.status] ?? 0) + 1
    }
    const deliveries = wecomDeliveries.map(delivery => ({ ...delivery, channel: 'WECOM' as const }))
    const record = toRecordDto(
      notification,
      wecomCounts,
      inAppCounts.get(id) ?? { total: 0, unread: 0 },
      media.length,
    )
    return {
      ...record,
      deliveries: deliveries.map((delivery) => {
        const mediaCounts = wecomMediaByDelivery.get(delivery.id) ?? { accepted: 0, failed: 0, total: 0 }
        return {
          id: delivery.id,
          channel: delivery.channel,
          recipientName: delivery.recipientUser?.displayName ?? null,
          targetName: delivery.target?.name ?? null,
          status: delivery.status,
          attemptCount: delivery.attemptCount,
          contentKey: delivery.templateKey,
          contentVersion: delivery.templateVersion,
          renderedContent: delivery.renderedContent,
          mediaTotal: mediaCounts.total,
          mediaAccepted: mediaCounts.accepted,
          mediaFailed: mediaCounts.failed,
          failureCode: delivery.failureCode,
          failureMessage: delivery.failureMessage,
          acceptedAt: iso(delivery.acceptedAt),
        }
      }),
      media: media.map(row => ({
        id: row.id,
        sortOrder: row.sortOrder,
        mediaType: row.mediaAsset.mediaType,
        mimeType: row.mediaAsset.mimeType,
        originalFilename: row.mediaAsset.originalFilename,
        sizeBytes: row.mediaAsset.sizeBytes?.toString() ?? '0',
        sourceKey: row.sourceKey,
        sourceLabel: resolveMediaSourceLabel(notification.eventType, row.sourceKey),
        blockedReason: row.blockedReason,
      })),
    }
  }

  private async mediaCounts(notificationIds: readonly string[]): Promise<Map<string, number>> {
    if (notificationIds.length === 0) {
      return new Map()
    }
    const rows = await this.prisma.notificationMedia.groupBy({
      by: ['notificationId'],
      where: { notificationId: { in: [...notificationIds] } },
      _count: { _all: true },
    })
    return new Map(rows.map(row => [row.notificationId, row._count._all]))
  }

  private async wecomDeliveryMediaCounts(
    deliveryIds: readonly string[],
  ): Promise<Map<string, { readonly total: number, readonly accepted: number, readonly failed: number }>> {
    if (deliveryIds.length === 0) {
      return new Map()
    }
    const rows = await this.prisma.wecomDeliveryMedia.groupBy({
      by: ['deliveryId', 'status'],
      where: { deliveryId: { in: [...deliveryIds] } },
      _count: { _all: true },
    })
    const result = new Map<string, { total: number, accepted: number, failed: number }>()
    for (const row of rows) {
      const entry = result.get(row.deliveryId) ?? { accepted: 0, failed: 0, total: 0 }
      entry.total += row._count._all
      if (row.status === 'ACCEPTED') {
        entry.accepted += row._count._all
      }
      if (row.status === 'FAILED' || row.status === 'EXPIRED') {
        entry.failed += row._count._all
      }
      result.set(row.deliveryId, entry)
    }
    return result
  }

  async cancelRecord(context: NotificationAdminContext, id: string): Promise<NotificationCancelResultDto> {
    const notification = await this.prisma.notification.findUnique({ where: { id }, select: { id: true, status: true } })
    if (notification === null) {
      throw new ApiException(404, 'NOTIFICATION_RECORD_NOT_FOUND', '通知不存在')
    }
    const result = await this.prisma.$transaction(async transaction => {
      const wecomUpdated = await transaction.wecomDelivery.updateMany({
        where: { notificationId: id, status: 'PENDING' },
        data: { status: 'CANCELLED', failureCode: 'CANCELLED', failureMessage: '管理员取消' },
      })
      const wecomGrouped = await transaction.wecomDelivery.groupBy({
        by: ['status'],
        where: { notificationId: id },
        _count: { _all: true },
      })
      const counts = new Map<string, number>()
      for (const row of wecomGrouped) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + row._count._all)
      }
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
        metadata: { cancelledCount: wecomUpdated.count },
      })
      return { cancelled: wecomUpdated.count, status }
    })
    return result
  }

  async overview(): Promise<NotificationOverviewDto> {
    const setting = await this.prisma.notificationChannelSettings.findUnique({ where: { channel: 'WECOM' } })
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
    const queue = await this.prisma.wecomDelivery.aggregate({
      where: { status: 'PENDING' },
      _count: { _all: true },
      _min: { nextAttemptAt: true },
    })
    return {
      channelEnabled: setting?.enabled ?? false,
      last24Hours,
      queue: {
        pending: queue._count._all,
        oldestNextAttemptAt: iso(queue._min.nextAttemptAt ?? null),
      },
    }
  }
}
