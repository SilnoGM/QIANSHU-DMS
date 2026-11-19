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
  NOTIFICATION_EVENT_DEFAULT_TEMPLATE_KEY,
  NOTIFICATION_EVENT_DOMAIN,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
} from './notification.types'

const CHANNELS: readonly NotificationPreferenceChannel[] = ['IN_APP', 'ASSISTANT']

function key(value: string, channel: string): string {
  return `${value}:${channel}`
}

interface PolicyRow {
  readonly eventType: string
  readonly channel: NotificationPreferenceChannel
  readonly enabled: boolean
  readonly templateKey: string | null
  readonly targetMode: string
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

    // 只允许关闭当前确实可投递的组合：管理员停用策略、关闭渠道或模板缺失时
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
    const [policies, settings, templates, mutes] = await Promise.all([
      this.prisma.notificationChannelPolicy.findMany({
        select: {
          eventType: true,
          channel: true,
          enabled: true,
          templateKey: true,
          targetMode: true,
        },
      }),
      this.prisma.notificationChannelSettings.findMany({
        select: { channel: true, enabled: true },
      }),
      this.prisma.notificationTemplate.findMany({
        where: { enabled: true },
        select: { key: true, channel: true },
      }),
      this.prisma.notificationUserMute.findMany({
        where: { userId },
        select: { eventType: true, channel: true },
      }),
    ])

    const policyByKey = new Map<string, PolicyRow>(
      policies.map(policy => [key(policy.eventType, policy.channel), policy]),
    )
    const channelEnabled = new Map<string, boolean>(
      settings.map(setting => [setting.channel, setting.enabled]),
    )
    const templateKeys = new Set<string>(
      templates.map(template => key(template.key, template.channel)),
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
            eventType,
            channel,
            policyByKey.get(key(eventType, channel)),
            channelEnabled,
            templateKeys,
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
    eventType: string,
    channel: NotificationPreferenceChannel,
    policy: PolicyRow | undefined,
    channelEnabled: ReadonlyMap<string, boolean>,
    templateKeys: ReadonlySet<string>,
  ): NotificationPreferenceUnavailableReason | null {
    if (policy === undefined) {
      return 'NOT_CONFIGURED'
    }
    if (!policy.enabled) {
      return 'POLICY_DISABLED'
    }
    if (channelEnabled.get(channel) !== true) {
      return 'CHANNEL_DISABLED'
    }
    if (policy.targetMode === 'GROUP') {
      return 'GROUP_TARGET'
    }
    // 发布时模板键可能由业务命令覆盖，这里按策略键与事件默认键判断可用性；
    // 这是管理端配置口径下最接近真实投递状态的近似。
    const templateKey = policy.templateKey?.trim()
      || NOTIFICATION_EVENT_DEFAULT_TEMPLATE_KEY[eventType as NotificationEventType]
    if (templateKey === undefined || !templateKeys.has(key(templateKey, channel))) {
      return 'TEMPLATE_MISSING'
    }
    return null
  }
}
