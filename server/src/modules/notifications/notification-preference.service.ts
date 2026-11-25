import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type {
  NotificationPreferenceChannel,
  NotificationPreferenceListDto,
  NotificationPreferenceUnavailableReason,
  NotificationPreferenceUpdateResultDto,
} from './notification-preference.dto'
import {
  NOTIFICATION_EVENT_DOMAIN,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TYPES,
} from './notification.types'

const CHANNELS: readonly NotificationPreferenceChannel[] = ['IN_APP', 'WECOM']

function key(value: string, channel: string): string {
  return `${value}:${channel}`
}

interface EventChannelRow {
  readonly eventType: string
  readonly channel: NotificationPreferenceChannel
  readonly enabled: boolean
  readonly targetMode: string
  readonly messages: readonly { readonly id: string }[]
}

/**
 * 个人级通知订阅：管理员决定「事件×渠道」是否启用与发什么，
 * 用户只能在此基础上关闭自己不想收的组合（稀疏 opt-out，删除记录即恢复）。
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<NotificationPreferenceListDto> {
    return this.buildView(userId)
  }

  async setMuted(
    userId: string,
    eventType: string,
    channel: NotificationPreferenceChannel,
    muted: boolean,
  ): Promise<NotificationPreferenceUpdateResultDto> {
    if (!(NOTIFICATION_EVENT_TYPES as readonly string[]).includes(eventType)) {
      throw new ApiException(404, 'NOTIFICATION_EVENT_NOT_FOUND', '通知事件不存在')
    }

    // 只允许关闭当前确实可投递的组合：管理员停用渠道配置、关闭渠道或内容缺失时
    // 写入关闭记录没有意义，也容易在重新启用后产生意外的静默。
    const view = await this.buildView(userId)
    const target = view.events
      .find(item => item.eventType === eventType)
      ?.channels.find(item => item.channel === channel)
    if (target === undefined) {
      throw new ApiException(404, 'NOTIFICATION_EVENT_NOT_FOUND', '通知事件不存在')
    }
    if (!target.available) {
      throw new ApiException(422, 'NOTIFICATION_PREFERENCE_UNAVAILABLE', '该事件的渠道当前不可设置')
    }

    if (muted) {
      await this.prisma.notificationUserMute.upsert({
        where: { userId_eventType_channel: { userId, eventType, channel } },
        create: { userId, eventType, channel },
        update: {},
      })
    }
    else {
      await this.prisma.notificationUserMute.deleteMany({ where: { userId, eventType, channel } })
    }
    return { eventType, channel, muted }
  }

  private async buildView(userId: string): Promise<NotificationPreferenceListDto> {
    const [eventChannels, settings, mutes] = await Promise.all([
      this.prisma.notificationEventChannel.findMany({
        where: { channel: { in: [...CHANNELS] } },
        select: {
          eventType: true,
          channel: true,
          enabled: true,
          targetMode: true,
          messages: {
            where: { enabled: true },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.notificationChannelSettings.findMany({
        where: { channel: { in: [...CHANNELS] } },
        select: { channel: true, enabled: true },
      }),
      this.prisma.notificationUserMute.findMany({
        where: { userId, channel: { in: [...CHANNELS] } },
        select: { eventType: true, channel: true },
      }),
    ])

    const eventChannelByKey = new Map<string, EventChannelRow>(
      (eventChannels as unknown as EventChannelRow[]).map(channel => [key(channel.eventType, channel.channel), channel]),
    )
    const channelEnabled = new Map<string, boolean>(
      settings.map(setting => [setting.channel, setting.enabled]),
    )
    const mutedKeys = new Set<string>(
      mutes.map(mute => key(mute.eventType, mute.channel)),
    )

    return {
      // 渠道级开关决定整列是否存在；前端据此收起不可用渠道，而不是逐行提示。
      channels: CHANNELS.map(channel => ({
        channel,
        enabled: channelEnabled.get(channel) === true,
      })),
      events: NOTIFICATION_EVENT_TYPES.map(eventType => ({
        eventType,
        label: NOTIFICATION_EVENT_LABELS[eventType],
        domain: NOTIFICATION_EVENT_DOMAIN[eventType],
        channels: CHANNELS.map((channel) => {
          const unavailableReason = this.unavailableReason(
            channel,
            eventChannelByKey.get(key(eventType, channel)),
            channelEnabled,
          )
          return {
            channel,
            available: unavailableReason === null,
            muted: mutedKeys.has(key(eventType, channel)),
            unavailableReason,
          }
        }),
      })),
    }
  }

  private unavailableReason(
    channel: NotificationPreferenceChannel,
    eventChannel: EventChannelRow | undefined,
    channelEnabled: ReadonlyMap<string, boolean>,
  ): NotificationPreferenceUnavailableReason | null {
    if (eventChannel === undefined) {
      return 'NOT_CONFIGURED'
    }
    if (!eventChannel.enabled) {
      return 'CONFIG_DISABLED'
    }
    if (channelEnabled.get(channel) !== true) {
      return 'CHANNEL_DISABLED'
    }
    if (eventChannel.targetMode === 'GROUP') {
      return 'GROUP_TARGET'
    }
    if (eventChannel.messages.length === 0) {
      return 'CONTENT_MISSING'
    }
    return null
  }
}
