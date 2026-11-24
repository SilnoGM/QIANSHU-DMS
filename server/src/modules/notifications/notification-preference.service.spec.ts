import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { NotificationPreferenceService } from './notification-preference.service'

interface PolicyFixture {
  readonly eventType: string
  readonly channel: 'IN_APP' | 'ASSISTANT'
  readonly enabled?: boolean
  readonly templateKey?: string | null
  readonly targetMode?: string
}

interface TemplateFixture {
  readonly key: string
  readonly channel: 'IN_APP' | 'ASSISTANT'
}

function createPrisma(options: {
  readonly policies?: readonly PolicyFixture[]
  readonly settings?: ReadonlyArray<{ readonly channel: 'IN_APP' | 'ASSISTANT', readonly enabled: boolean }>
  readonly templates?: readonly TemplateFixture[]
  readonly mutes?: ReadonlyArray<{ readonly eventType: string, readonly channel: 'IN_APP' | 'ASSISTANT' }>
  readonly assistantBound?: boolean
  readonly upsert?: jest.Mock
  readonly deleteMany?: jest.Mock
} = {}) {
  const upsert = options.upsert ?? jest.fn().mockResolvedValue({})
  const deleteMany = options.deleteMany ?? jest.fn().mockResolvedValue({ count: 1 })
  const prisma = {
    notificationChannelPolicy: {
      findMany: jest.fn().mockResolvedValue((options.policies ?? []).map(policy => ({
        enabled: true,
        templateKey: null,
        targetMode: 'COMMAND_TARGET',
        ...policy,
      }))),
    },
    notificationChannelSettings: {
      findMany: jest.fn().mockResolvedValue(options.settings ?? []),
    },
    notificationTemplate: {
      findMany: jest.fn().mockResolvedValue(options.templates ?? []),
    },
    notificationUserMute: {
      findMany: jest.fn().mockResolvedValue(options.mutes ?? []),
      upsert,
      deleteMany,
    },
    assistantBinding: {
      findFirst: jest.fn().mockResolvedValue(options.assistantBound === true ? { id: 'binding-1' } : null),
    },
  } as unknown as PrismaService
  return { prisma, upsert, deleteMany }
}

const inAppPolicy: PolicyFixture = {
  eventType: 'PURCHASE_REVIEW_PENDING',
  channel: 'IN_APP',
  targetMode: 'USERS',
}

const inAppTemplate: TemplateFixture = {
  key: 'purchase.review.pending',
  channel: 'IN_APP',
}

describe('NotificationPreferenceService', () => {
  it('reports availability per channel and keeps the muted flag', async () => {
    const { prisma } = createPrisma({
      policies: [inAppPolicy, { eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' }],
      settings: [{ channel: 'IN_APP', enabled: true }, { channel: 'ASSISTANT', enabled: false }],
      templates: [inAppTemplate],
      mutes: [{ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP' }],
    })

    const view = await new NotificationPreferenceService(prisma).list('user-1')
    const event = view.events.find(item => item.eventType === 'PURCHASE_REVIEW_PENDING')

    expect(event?.label).toBe('采购审核')
    expect(event?.domain).toBe('purchase')
    expect(event?.channels).toEqual([
      { channel: 'IN_APP', available: true, muted: true, unavailableReason: null },
      { channel: 'ASSISTANT', available: false, muted: false, unavailableReason: 'CHANNEL_DISABLED' },
      { channel: 'WECOM', available: false, muted: false, unavailableReason: 'NOT_CONFIGURED' },
    ])
    expect(view.channels).toEqual([
      { channel: 'IN_APP', enabled: true },
      { channel: 'ASSISTANT', enabled: false },
      { channel: 'WECOM', enabled: false },
    ])
    expect(view.assistantBound).toBe(false)
  })

  it('reports whether the user has a verified assistant binding', async () => {
    const { prisma } = createPrisma({ assistantBound: true })

    const view = await new NotificationPreferenceService(prisma).list('user-1')

    expect(view.assistantBound).toBe(true)
  })

  it('distinguishes unconfigured, disabled and template-missing channels', async () => {
    const { prisma } = createPrisma({
      policies: [
        { ...inAppPolicy, enabled: false },
        { eventType: 'SALES_ORDER_COMPLETED', channel: 'IN_APP', targetMode: 'USERS' },
      ],
      settings: [{ channel: 'IN_APP', enabled: true }],
      templates: [],
    })

    const view = await new NotificationPreferenceService(prisma).list('user-1')
    const purchase = view.events.find(item => item.eventType === 'PURCHASE_REVIEW_PENDING')
    const sales = view.events.find(item => item.eventType === 'SALES_ORDER_COMPLETED')

    expect(purchase?.channels[0].unavailableReason).toBe('POLICY_DISABLED')
    expect(sales?.channels[0].unavailableReason).toBe('TEMPLATE_MISSING')
    expect(sales?.channels[1].unavailableReason).toBe('NOT_CONFIGURED')
  })

  it('does not let users mute an event with a group-only target', async () => {
    const { prisma } = createPrisma({
      policies: [{
        eventType: 'PURCHASE_REVIEW_PENDING',
        channel: 'ASSISTANT',
        targetMode: 'GROUP',
      }],
      settings: [{ channel: 'IN_APP', enabled: true }, { channel: 'ASSISTANT', enabled: true }],
      templates: [inAppTemplate, { key: 'purchase.review.pending', channel: 'ASSISTANT' }],
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
      policies: [inAppPolicy],
      settings: [{ channel: 'IN_APP', enabled: true }],
      templates: [inAppTemplate],
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
      policies: [inAppPolicy],
      settings: [{ channel: 'IN_APP', enabled: true }],
      templates: [inAppTemplate],
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
      policies: [inAppPolicy],
      settings: [{ channel: 'IN_APP', enabled: true }],
      templates: [],
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
