/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言 mock 调用参数。 */
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { SystemNotificationService } from './system-notification.service'

const EVENT_TYPE = 'SALES_ORDER_SUBMITTED'
const USER_ID = '11111111-1111-4111-8111-111111111111'

function textMessage(content: string, sortOrder = 0) {
  return {
    id: `message-${sortOrder}`,
    channelConfigId: 'config-1',
    sortOrder,
    kind: 'TEXT',
    payload: { title: null, content, linkUrl: null },
    mediaPolicy: {},
    contentHash: 'a'.repeat(64),
    enabled: true,
    createdAt: new Date('2026-11-25T10:00:00.000Z'),
    updatedAt: new Date('2026-11-25T10:00:00.000Z'),
  }
}

function inAppConfig(messages = [textMessage('站内正文')]) {
  return {
    id: 'config-in-app',
    eventType: EVENT_TYPE,
    channel: 'IN_APP',
    sendMethod: 'IN_APP',
    enabled: true,
    targetMode: 'USERS',
    targetConfig: { userIds: [USER_ID] },
    ttlSeconds: null,
    quietHours: null,
    allowSensitive: false,
    version: 2,
    updatedByUserId: null,
    createdAt: new Date('2026-11-25T10:00:00.000Z'),
    updatedAt: new Date('2026-11-25T10:00:00.000Z'),
    messages,
  }
}

function wecomConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-wecom',
    eventType: EVENT_TYPE,
    channel: 'WECOM',
    sendMethod: 'APP',
    enabled: true,
    targetMode: 'USERS',
    targetConfig: { userIds: [USER_ID] },
    ttlSeconds: 3_600,
    quietHours: null,
    allowSensitive: false,
    version: 3,
    updatedByUserId: null,
    createdAt: new Date('2026-11-25T10:00:00.000Z'),
    updatedAt: new Date('2026-11-25T10:00:00.000Z'),
    messages: [textMessage('企微正文')],
    ...overrides,
  }
}

function basePrisma(configs: unknown[]) {
  const prisma = {
    notification: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    notificationEventChannel: { findMany: jest.fn().mockResolvedValue(configs) },
    notificationEventChannelMessage: { findMany: jest.fn().mockResolvedValue([]) },
    notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([]) },
    notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
    notificationTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
    notificationUserMute: { findMany: jest.fn().mockResolvedValue([]) },
    notificationInboxItem: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
    },
    notificationMedia: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    mediaAsset: { findMany: jest.fn().mockResolvedValue([]) },
    wecomAppEventRoute: { findUnique: jest.fn().mockResolvedValue(null) },
    wecomApp: { findFirst: jest.fn().mockResolvedValue({ id: 'app-1' }) },
    wecomBinding: { findMany: jest.fn().mockResolvedValue([{ userId: USER_ID }]) },
    wecomAppMembership: { findMany: jest.fn().mockResolvedValue([{ userId: USER_ID }]) },
    wecomTarget: { findMany: jest.fn().mockResolvedValue([]) },
    wecomDelivery: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
    },
    notificationRenderedMessage: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    notificationDeliveryMessage: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: USER_ID }]),
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma))
  return prisma
}

function createNumbering(): NumberingGeneratorService {
  return {
    generateScopedInTransaction: jest.fn().mockResolvedValue({
      number: 'N-20261125-0001',
      issuanceId: '22222222-2222-4222-8222-222222222222',
    }),
  } as unknown as NumberingGeneratorService
}

describe('SystemNotificationService event config branch', () => {
  it('creates in-app and app deliveries from channel-owned content', async () => {
    const prisma = basePrisma([inAppConfig(), wecomConfig()])
    const service = new SystemNotificationService(
      prisma as unknown as PrismaService,
      createNumbering(),
    )

    const result = await service.publish({
      eventType: EVENT_TYPE,
      source: { type: 'sales_order', id: 'order-1' },
      target: { kind: 'USERS', userIds: [USER_ID] },
      templateKey: 'ignored.legacy.key',
      variables: {},
    })

    expect(result.duplicated).toBe(false)
    expect(result.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'IN_APP', status: 'CREATED' }),
      expect.objectContaining({ channel: 'WECOM', status: 'PENDING' }),
    ]))
    expect(prisma.notificationChannelPolicy.findMany).not.toHaveBeenCalled()
    expect(prisma.notificationTemplate.findUnique).not.toHaveBeenCalled()
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        templateKey: 'event-content',
        requestedChannels: ['IN_APP', 'WECOM'],
      }),
    }))
    expect(prisma.notificationInboxItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        userId: USER_ID,
        templateKey: 'event-content',
        titleSnapshot: '销售订单提交',
        bodySnapshot: '站内正文',
      })],
      skipDuplicates: true,
    })
    expect(prisma.wecomDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        transport: 'APP',
        recipientUserId: USER_ID,
        templateKey: 'event-content',
        renderedContent: '企微正文',
      })],
    })
    expect(prisma.notificationRenderedMessage.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        channel: 'WECOM',
        sendMethod: 'APP',
        kind: 'TEXT',
        payloadSnapshot: expect.objectContaining({ content: '企微正文' }),
      })],
    })
    expect(prisma.notificationDeliveryMessage.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        sortOrder: 0,
        status: 'PENDING',
      })],
    })
  })

  it('creates robot deliveries without template lookup', async () => {
    const prisma = basePrisma([wecomConfig({
      sendMethod: 'ROBOT',
      targetMode: 'GROUP',
      targetConfig: { targetKeys: ['ops'], mention: { mode: 'ALL' } },
    })])
    prisma.notificationInboxItem.count.mockResolvedValue(0)
    prisma.wecomTarget.findMany.mockResolvedValue([{ id: 'target-1' }])
    const service = new SystemNotificationService(
      prisma as unknown as PrismaService,
      createNumbering(),
    )

    const result = await service.publish({
      eventType: EVENT_TYPE,
      source: { type: 'sales_order', id: 'order-1' },
      target: { kind: 'USERS', userIds: [USER_ID] },
      templateKey: 'ignored.legacy.key',
      variables: {},
    })

    expect(result.channels).toEqual([
      expect.objectContaining({ channel: 'WECOM', status: 'PENDING' }),
    ])
    expect(prisma.wecomDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        transport: 'ROBOT',
        targetId: 'target-1',
        mentionMode: 'ALL',
        templateKey: 'event-content',
      })],
    })
    expect(prisma.notificationTemplate.findUnique).not.toHaveBeenCalled()
  })

  it('creates mpnews rendered messages from event content', async () => {
    const coverId = '00000000-0000-4000-8000-000000000099'
    const inlineId = '00000000-0000-4000-8000-000000000097'
    const config = wecomConfig({
      messages: [{
        id: 'message-mpnews',
        channelConfigId: 'config-wecom',
        sortOrder: 0,
        kind: 'MPNEWS',
        payload: {
          cover: { mediaAssetId: coverId },
          title: '采购通知',
          author: null,
          digest: null,
          contentSourceUrl: null,
          content: `<p>正文</p><img data-asset-id="${inlineId}">`,
        },
        mediaPolicy: {},
        contentHash: 'a'.repeat(64),
        enabled: true,
        createdAt: new Date('2026-11-25T10:00:00.000Z'),
        updatedAt: new Date('2026-11-25T10:00:00.000Z'),
      }],
    })
    const prisma = basePrisma([config])
    prisma.notificationInboxItem.count.mockResolvedValue(0)
    const service = new SystemNotificationService(
      prisma as unknown as PrismaService,
      createNumbering(),
    )

    const result = await service.publish({
      eventType: EVENT_TYPE,
      source: { type: 'sales_order', id: 'order-1' },
      target: { kind: 'USERS', userIds: [USER_ID] },
      templateKey: 'ignored.legacy.key',
      variables: {},
    })

    expect(result.channels[0]).toMatchObject({ channel: 'WECOM', status: 'PENDING' })
    expect(prisma.notificationRenderedMessage.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        kind: 'MPNEWS',
        payloadSnapshot: expect.objectContaining({
          coverAssetId: coverId,
          title: '采购通知',
          content: expect.stringContaining('data-asset-id'),
        }),
      })],
    })
    expect(prisma.notificationDeliveryMessage.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ sortOrder: 0, status: 'PENDING' })],
    })
  })

  it('skips WECOM when content contains an unimplemented kind', async () => {
    const config = wecomConfig({
      messages: [{
        ...textMessage(''),
        kind: 'VIDEO',
        payload: {},
      }],
    })
    const prisma = basePrisma([config])
    prisma.notificationInboxItem.count.mockResolvedValue(0)
    prisma.wecomDelivery.count.mockResolvedValue(0)
    const service = new SystemNotificationService(
      prisma as unknown as PrismaService,
      createNumbering(),
    )

    const result = await service.publish({
      eventType: EVENT_TYPE,
      source: { type: 'sales_order', id: 'order-1' },
      target: { kind: 'USERS', userIds: [USER_ID] },
      templateKey: 'ignored.legacy.key',
      variables: {},
    })

    expect(result.channels[0]).toMatchObject({
      channel: 'WECOM',
      status: 'SKIPPED',
      skipReason: 'MESSAGE_KIND_NOT_IMPLEMENTED',
    })
    expect(prisma.wecomDelivery.createMany).not.toHaveBeenCalled()
  })
})
