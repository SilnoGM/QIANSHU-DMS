import type { Prisma } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/infrastructure/database/prisma.service'

export type NotificationChannelFixture = 'IN_APP' | 'WECOM'
export type NotificationChannelSendMethod = 'IN_APP' | 'APP' | 'ROBOT'
export type NotificationChannelTargetMode = 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP'
export type NotificationChannelMessageKind = 'TEXT' | 'IMAGE' | 'FILE'

export interface NotificationChannelMessageFixture {
  readonly kind: NotificationChannelMessageKind
  readonly payload: Prisma.InputJsonValue
  readonly mediaPolicy?: Prisma.InputJsonValue
  readonly enabled?: boolean
}

export interface SeedNotificationChannelInput {
  readonly eventType: string
  readonly channel: NotificationChannelFixture
  readonly sendMethod: NotificationChannelSendMethod
  readonly targetMode?: NotificationChannelTargetMode
  readonly targetConfig?: Prisma.InputJsonValue
  readonly enabled?: boolean
  readonly allowSensitive?: boolean
  readonly ttlSeconds?: number | null
  readonly updatedByUserId?: string | null
  readonly messages: readonly NotificationChannelMessageFixture[]
}

/**
 * E2E 专用：把事件渠道配置成可发布状态并替换全部消息项。
 * 生产默认基线来自迁移：渠道存在但通常 enabled=false、没有可渲染内容。
 */
export async function seedNotificationEventChannel(
  prisma: PrismaService,
  input: SeedNotificationChannelInput,
): Promise<string> {
  const channelData = {
    sendMethod: input.sendMethod,
    enabled: input.enabled ?? true,
    targetMode: input.targetMode ?? 'COMMAND_TARGET',
    targetConfig: input.targetConfig ?? {},
    ttlSeconds: input.ttlSeconds ?? null,
    // 站内渠道不允许敏感开关与 TTL/静默，统一收敛为关闭。
    allowSensitive: input.channel === 'WECOM' ? input.allowSensitive ?? false : false,
    updatedByUserId: input.updatedByUserId ?? null,
  }
  const channel = await prisma.notificationEventChannel.upsert({
    where: {
      eventType_channel: {
        eventType: input.eventType,
        channel: input.channel,
      },
    },
    create: {
      eventType: input.eventType,
      channel: input.channel,
      ...channelData,
    },
    update: {
      ...channelData,
      version: { increment: 1 },
    },
    select: { id: true },
  })
  await prisma.notificationEventChannelMessage.deleteMany({
    where: { channelConfigId: channel.id },
  })
  if (input.messages.length > 0) {
    await prisma.notificationEventChannelMessage.createMany({
      data: input.messages.map((message, sortOrder) => ({
        channelConfigId: channel.id,
        sortOrder,
        kind: message.kind,
        payload: message.payload,
        mediaPolicy: message.mediaPolicy ?? {},
        enabled: message.enabled ?? true,
      })),
    })
  }
  return channel.id
}
