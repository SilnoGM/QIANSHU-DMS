import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { NotificationPreferenceService } from './notification-preference.service'

interface EventChannelFixture {
  readonly eventType: string
  readonly channel: 'IN_APP' | 'WECOM'
  readonly enabled?: boolean
  readonly targetMode?: string
  readonly content?: boolean
}

function createPrisma(options: {
  readonly channels?: readonly EventChannelFixture[]
  readonly settings?: ReadonlyArray<{ readonly channel: 'IN_APP' | 'WECOM', readonly enabled: boolean }>
  readonly mutes?: ReadonlyArray<{ readonly eventType: string, readonly channel: 'IN_APP' | 'WECOM' }>
  readonly upsert?: jest.Mock
  readonly deleteMany?: jest.Mock
} = {}) {
  const upsert = options.upsert ?? jest.fn().mockResolvedValue({})
  const deleteMany = options.deleteMany ?? jest.fn().mockResolvedValue({ count: 1 })
  const prisma = {
    notificationEventChannel: {
      findMany: jest.fn().mockResolvedValue((options.channels ?? []).map(channel => ({
        enabled: true,
        targetMode: 'COMMAND_TARGET',
        content: true,
        ...channel,
        messages: channel.content === false ? [] : [{ id: 'message-1' }],
      }))),
    },
    notificationChannelSettings: {
      findMany: jest.fn().mockResolvedValue(options.settings ?? []),
    },
    notificationUserMute: {
      findMany: jest.fn().mockResolvedValue(options.mutes ?? []),
      upsert,
      deleteMany,
    },
  } as unknown as PrismaService
  return { prisma, upsert, deleteMany }
}

const inAppChannel: EventChannelFixture = {
  eventType: 'PURCHASE_REVIEW_PENDING',
  channel: 'IN_APP',
  targetMode: 'USERS',
}

describe('NotificationPreferenceService', () => {
  it('reports availability per channel and keeps the muted flag', async () => {
    const { prisma } = createPrisma({
      channels: [inAppChannel, { eventType: 'PURCHASE_REVIEW_PENDING', channel: 'WECOM' }],
      settings: [{ channel: 'IN_APP', enabled: true }, { channel: 'WECOM', enabled: false }],
      mutes: [{ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP' }],
    })

    const view = await new NotificationPreferenceService(prisma).list('user-1')
    const event = view.events.find(item => item.eventType === 'PURCHASE_REVIEW_PENDING')

    expect(event?.label).toBe('采购审核')
    expect(event?.domain).toBe('purchase')
    expect(event?.channels).toEqual([
      { channel: 'IN_APP', available: true, muted: true, unavailableReason: null },
      { channel: 'WECOM', available: false, muted: false, unavailableReason: 'CHANNEL_DISABLED' },
    ])
    expect(view.channels).toEqual([
      { channel: 'IN_APP', enabled: true },
      { channel: 'WECOM', enabled: false },
    ])
  })

  it('distinguishes unconfigured, disabled and content-missing channels', async () => {
    const { prisma } = createPrisma({
      channels: [
        { ...inAppChannel, enabled: false },
        { eventType: 'SALES_ORDER_COMPLETED', channel: 'IN_APP', targetMode: 'USERS', content: false },
      ],
      settings: [{ channel: 'IN_APP', enabled: true }],
    })

    const view = await new NotificationPreferenceService(prisma).list('user-1')
    const purchase = view.events.find(item => item.eventType === 'PURCHASE_REVIEW_PENDING')
    const sales = view.events.find(item => item.eventType === 'SALES_ORDER_COMPLETED')

    expect(purchase?.channels[0].unavailableReason).toBe('CONFIG_DISABLED')
    expect(sales?.channels[0].unavailableReason).toBe('CONTENT_MISSING')
    expect(sales?.channels[1].unavailableReason).toBe('NOT_CONFIGURED')
  })

  it('does not let users mute an event with a group-only target', async () => {
    const { prisma } = createPrisma({
      channels: [{
        eventType: 'PURCHASE_REVIEW_PENDING',
        channel: 'WECOM',
        targetMode: 'GROUP',
      }],
      settings: [{ channel: 'IN_APP', enabled: true }, { channel: 'WECOM', enabled: true }],
    })

    const view = await new NotificationPreferenceService(prisma).list('user-1')
    const event = view.events.find(item => item.eventType === 'PURCHASE_REVIEW_PENDING')

    expect(event?.channels[1]).toMatchObject({
      available: false,
      unavailableReason: 'GROUP_TARGET',
    })
  })

  it('stores a mute row only for an available event and channel', async () => {
    const { prisma, upsert } = createPrisma({
      channels: [inAppChannel],
      settings: [{ channel: 'IN_APP', enabled: true }],
    })

    const result = await new NotificationPreferenceService(prisma)
      .setMuted('user-1', 'PURCHASE_REVIEW_PENDING', 'IN_APP', true)

    expect(result).toEqual({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP', muted: true })
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_eventType_channel: {
          userId: 'user-1',
          eventType: 'PURCHASE_REVIEW_PENDING',
          channel: 'IN_APP',
        },
      },
      create: { userId: 'user-1', eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP' },
      update: {},
    })
  })

  it('deletes the mute row when the user turns the event back on', async () => {
    const { prisma, deleteMany } = createPrisma({
      channels: [inAppChannel],
      settings: [{ channel: 'IN_APP', enabled: true }],
    })

    const result = await new NotificationPreferenceService(prisma)
      .setMuted('user-1', 'PURCHASE_REVIEW_PENDING', 'IN_APP', false)

    expect(result.muted).toBe(false)
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP' },
    })
  })

  it('rejects muting a channel that the admin has not made deliverable', async () => {
    const { prisma, upsert } = createPrisma({
      channels: [{ ...inAppChannel, content: false }],
      settings: [{ channel: 'IN_APP', enabled: true }],
    })

    const error = await new NotificationPreferenceService(prisma)
      .setMuted('user-1', 'PURCHASE_REVIEW_PENDING', 'IN_APP', true)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiException)
    expect((error as ApiException).code).toBe('NOTIFICATION_PREFERENCE_UNAVAILABLE')
    expect((error as ApiException).getStatus()).toBe(422)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects an unknown event type', async () => {
    const { prisma } = createPrisma()

    const error = await new NotificationPreferenceService(prisma)
      .setMuted('user-1', 'UNKNOWN_EVENT', 'IN_APP', true)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiException)
    expect((error as ApiException).code).toBe('NOTIFICATION_EVENT_NOT_FOUND')
    expect((error as ApiException).getStatus()).toBe(404)
  })
})
