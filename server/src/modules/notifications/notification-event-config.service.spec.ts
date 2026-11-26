/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言 mock 调用参数。 */
import { ApiException } from '../../infrastructure/http/api.exception'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { MediaAssetService } from '../media/media-asset.service'
import type { MediaAssetRetentionService } from '../media/media-retention.service'
import type { NotificationEventConfigUpdateDto } from './notification-admin.dto'
import { DEFAULT_NOTIFICATION_QUIET_HOURS } from './notification-quiet-hours'
import { NotificationEventConfigService } from './notification-event-config.service'

const EVENT_TYPE = 'SALES_ORDER_SUBMITTED'
const CONTENT_HASH = 'a'.repeat(64)

function channelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    eventType: EVENT_TYPE,
    channel: 'IN_APP',
    sendMethod: 'IN_APP',
    enabled: true,
    targetMode: 'USERS',
    targetConfig: { userIds: [] },
    ttlSeconds: null,
    quietHours: null,
    allowSensitive: false,
    version: 2,
    updatedAt: new Date('2026-11-25T10:00:00.000Z'),
    updatedBy: { displayName: '管理员' },
    messages: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        sortOrder: 0,
        kind: 'TEXT',
        payload: { title: null, content: '销售单已提交', linkUrl: null },
        mediaPolicy: {},
        enabled: true,
        contentHash: CONTENT_HASH,
      },
    ],
    ...overrides,
  }
}

function createPrismaMock() {
  const prisma = {
    notificationEventChannel: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    notificationEventChannelMessage: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    notificationEventChannelMessageMedia: {
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    mediaAsset: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma))
  return prisma
}

function createAuditMock() {
  return { record: jest.fn() }
}

function createMediaMocks() {
  return {
    mediaAsset: { activate: jest.fn().mockResolvedValue(undefined) },
    retention: { markUnreferencedForTrash: jest.fn().mockResolvedValue('TRASHED') },
  }
}

function createService(
  prisma: ReturnType<typeof createPrismaMock>,
  audit = createAuditMock(),
  media = createMediaMocks(),
) {
  return new NotificationEventConfigService(
    prisma as unknown as PrismaService,
    audit,
    media.mediaAsset as unknown as MediaAssetService,
    media.retention as unknown as MediaAssetRetentionService,
  )
}

describe('NotificationEventConfigService', () => {
  it('maps event metadata and channel content', async () => {
    const prisma = createPrismaMock()
    prisma.notificationEventChannel.findMany.mockResolvedValue([channelRow()])
    const service = createService(prisma)

    const result = await service.get(EVENT_TYPE)

    expect(result.eventType).toBe(EVENT_TYPE)
    expect(result.label).toBe('销售订单提交')
    expect(result.variablesKnown).toBe(true)
    expect(result.channels).toHaveLength(1)
    expect(result.channels[0]).toMatchObject({
      channel: 'IN_APP',
      sendMethod: 'IN_APP',
      version: 2,
      updatedByName: '管理员',
    })
    expect(result.channels[0]?.messages[0]).toMatchObject({
      kind: 'TEXT',
      payload: { content: '销售单已提交' },
      contentHash: CONTENT_HASH,
    })
  })

  it('creates a channel config and replaces content on expectedVersion 0', async () => {
    const prisma = createPrismaMock()
    const audit = createAuditMock()
    prisma.notificationEventChannel.findUnique.mockResolvedValue(null)
    prisma.notificationEventChannel.upsert.mockResolvedValue(channelRow({ version: 1 }))
    prisma.notificationEventChannel.findMany.mockResolvedValue([channelRow({ version: 1 })])
    const service = createService(prisma, audit)
    const input: NotificationEventConfigUpdateDto = {
      channels: [
        {
          channel: 'IN_APP',
          sendMethod: 'IN_APP',
          targetMode: 'USERS',
          targetConfig: { userIds: [] },
          expectedVersion: 0,
          messages: [{ kind: 'TEXT', payload: { content: '销售单已提交' } }],
        },
      ],
    }

    const result = await service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      input,
    )

    expect(result.channels[0]?.version).toBe(1)
    expect(prisma.notificationEventChannelMessage.deleteMany).toHaveBeenCalledWith({
      where: { channelConfigId: channelRow().id },
    })
    expect(prisma.notificationEventChannelMessage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          channelConfigId: channelRow().id,
          sortOrder: 0,
          kind: 'TEXT',
          enabled: true,
        }),
      ],
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'NOTIFICATION_POLICY_UPDATED',
        targetType: 'NOTIFICATION_EVENT_CHANNEL',
      }),
    )
  })

  it('defaults WECOM quiet hours and preserves explicit off values', async () => {
    const prisma = createPrismaMock()
    prisma.notificationEventChannel.findUnique.mockResolvedValue(null)
    prisma.notificationEventChannel.upsert.mockResolvedValue(channelRow({
      channel: 'WECOM',
      sendMethod: 'APP',
      quietHours: DEFAULT_NOTIFICATION_QUIET_HOURS,
    }))
    prisma.notificationEventChannel.findMany.mockResolvedValue([channelRow({
      channel: 'WECOM',
      sendMethod: 'APP',
      quietHours: DEFAULT_NOTIFICATION_QUIET_HOURS,
    })])
    const service = createService(prisma)

    const baseInput: NotificationEventConfigUpdateDto = {
      channels: [{
        channel: 'WECOM',
        sendMethod: 'APP',
        targetMode: 'USERS',
        targetConfig: { userIds: [] },
        ttlSeconds: 86_400,
        expectedVersion: 0,
        messages: [{ kind: 'TEXT', payload: { content: '销售单已提交' } }],
      }],
    }
    await service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      baseInput,
    )
    expect(prisma.notificationEventChannel.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        quietHours: {
          enabled: true,
          start: '23:00',
          end: '08:45',
          timezone: 'Asia/Shanghai',
        },
      }),
      update: expect.objectContaining({
        quietHours: {
          enabled: true,
          start: '23:00',
          end: '08:45',
          timezone: 'Asia/Shanghai',
        },
      }),
    }))

    const closed: NotificationEventConfigUpdateDto = {
      channels: [{
        ...baseInput.channels[0],
        quietHours: {
          enabled: false,
          start: '21:30',
          end: '07:15',
          timezone: 'Asia/Shanghai',
        },
      }],
    }
    await service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      closed,
    )
    expect(prisma.notificationEventChannel.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        quietHours: {
          enabled: false,
          start: '21:30',
          end: '07:15',
          timezone: 'Asia/Shanghai',
        },
      }),
    }))
  })

  it('rejects enabled quiet hours without both times', async () => {
    const prisma = createPrismaMock()
    prisma.notificationEventChannel.findUnique.mockResolvedValue(null)
    const service = createService(prisma)

    await expect(service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      {
        channels: [{
          channel: 'WECOM',
          sendMethod: 'APP',
          targetMode: 'USERS',
          targetConfig: { userIds: [] },
          ttlSeconds: 86_400,
          quietHours: { enabled: true, start: '23:00', timezone: 'Asia/Shanghai' },
          expectedVersion: 0,
          messages: [{ kind: 'TEXT', payload: { content: '销售单已提交' } }],
        }],
      },
    )).rejects.toMatchObject({ code: 'NOTIFICATION_EVENT_QUIET_HOURS_INVALID' })
    expect(prisma.notificationEventChannel.upsert).not.toHaveBeenCalled()
  })

  it('rejects stale expectedVersion', async () => {
    const prisma = createPrismaMock()
    prisma.notificationEventChannel.findUnique.mockResolvedValue(channelRow({ version: 3 }))
    const service = createService(prisma)
    const input: NotificationEventConfigUpdateDto = {
      channels: [
        {
          channel: 'IN_APP',
          sendMethod: 'IN_APP',
          targetMode: 'USERS',
          targetConfig: {},
          expectedVersion: 2,
          messages: [{ kind: 'TEXT', payload: { content: '正文' } }],
        },
      ],
    }

    await expect(service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      input,
    )).rejects.toMatchObject({ code: 'NOTIFICATION_EVENT_CONFIG_STATE_CHANGED' })
  })

  it('rejects channel and send method mismatch', async () => {
    const prisma = createPrismaMock()
    const service = createService(prisma)
    const input: NotificationEventConfigUpdateDto = {
      channels: [
        {
          channel: 'WECOM',
          sendMethod: 'IN_APP',
          targetMode: 'USERS',
          targetConfig: {},
          expectedVersion: 0,
          messages: [{ kind: 'TEXT', payload: { content: '正文' } }],
        },
      ],
    }

    await expect(service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      input,
    )).rejects.toMatchObject({ code: 'NOTIFICATION_EVENT_CHANNEL_METHOD_INVALID' })
  })

  it('rejects invalid content before writing', async () => {
    const prisma = createPrismaMock()
    const service = createService(prisma)
    const input: NotificationEventConfigUpdateDto = {
      channels: [
        {
          channel: 'IN_APP',
          sendMethod: 'IN_APP',
          targetMode: 'USERS',
          targetConfig: {},
          expectedVersion: 0,
          messages: [{ kind: 'TEXT', payload: { content: '' } }],
        },
      ],
    }

    await expect(service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      input,
    )).rejects.toMatchObject({
      code: 'NOTIFICATION_EVENT_CONTENT_INVALID',
      issues: [{
        code: 'NOTIFICATION_CONTENT_TEXT_EMPTY',
        message: '文本内容不能为空',
        channel: 'IN_APP',
        itemIndex: 0,
        field: 'content',
      }],
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('persists mpnews cover and inline media references', async () => {
    const prisma = createPrismaMock()
    const coverId = '00000000-0000-4000-8000-000000000099'
    const inlineId = '00000000-0000-4000-8000-000000000097'
    prisma.notificationEventChannel.findUnique.mockResolvedValue(null)
    prisma.notificationEventChannel.upsert.mockResolvedValue(channelRow({ version: 1 }))
    prisma.notificationEventChannel.findMany.mockResolvedValue([channelRow({ version: 1 })])
    prisma.mediaAsset.findMany.mockResolvedValue([
      { id: coverId, mediaType: 'IMAGE', status: 'READY', deletedAt: null, objectKey: 'cover.png', sizeBytes: 1n },
      { id: inlineId, mediaType: 'IMAGE', status: 'READY', deletedAt: null, objectKey: 'inline.png', sizeBytes: 1n },
    ])
    const service = createService(prisma)
    const input: NotificationEventConfigUpdateDto = {
      channels: [
        {
          channel: 'WECOM',
          sendMethod: 'APP',
          targetMode: 'USERS',
          targetConfig: { userIds: [] },
          expectedVersion: 0,
          messages: [{
            kind: 'MPNEWS',
            payload: {
              cover: { mediaAssetId: coverId },
              title: '采购通知',
              content: `<p>正文</p><img data-asset-id="${inlineId}">`,
            },
          }],
        },
      ],
    }

    await service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      input,
    )

    expect(prisma.notificationEventChannelMessageMedia.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ mediaAssetId: coverId, role: 'COVER' }),
        expect.objectContaining({ mediaAssetId: inlineId, role: 'INLINE' }),
      ]),
    })
  })


  it('previews mpnews with escaped variables and asset ids', async () => {
    const prisma = createPrismaMock()
    const coverId = '00000000-0000-4000-8000-000000000099'
    prisma.notificationEventChannel.findMany.mockResolvedValue([
      channelRow({
        channel: 'WECOM',
        sendMethod: 'APP',
        targetMode: 'USERS',
        targetConfig: { userIds: [] },
        ttlSeconds: 3_600,
        allowSensitive: true,
        messages: [
          {
            id: '00000000-0000-4000-8000-000000000098',
            sortOrder: 0,
            kind: 'MPNEWS',
            payload: {
              cover: { mediaAssetId: coverId },
              title: '订单 {{orderNo}}',
              author: null,
              digest: '客户 {{customerName}}',
              contentSourceUrl: 'https://dms.example.com/notice',
              content: '<p>{{customerName}}</p><img data-asset-id="00000000-0000-4000-8000-000000000097"><img data-media-source="salesOrder.issuanceVoucher">',
            },
            mediaPolicy: {},
            enabled: true,
            contentHash: CONTENT_HASH,
          },
        ],
      }),
    ])
    const service = createService(prisma)

    const result = await service.preview(EVENT_TYPE, {
      variables: { orderNo: 'PO-001', customerName: '<b>客户</b>' },
    })

    expect(result.channels).toHaveLength(1)
    expect(result.channels[0]).toMatchObject({
      channel: 'WECOM',
      sendMethod: 'APP',
    })
    expect(result.channels[0]?.items[0]).toMatchObject({
      kind: 'MPNEWS',
      payload: expect.objectContaining({
        title: '订单 PO-001',
        contentSourceUrl: 'https://dms.example.com/notice',
        content: expect.stringContaining('&lt;b&gt;客户&lt;/b&gt;'),
      }),
      warnings: expect.arrayContaining([
        expect.stringContaining('业务图片占位'),
      ]),
      assetIds: expect.arrayContaining([coverId, '00000000-0000-4000-8000-000000000097']),
    })
  })

  it('warns when mpnews metadata exceeds the byte limit after variable rendering', async () => {
    const prisma = createPrismaMock()
    const coverId = '00000000-0000-4000-8000-000000000099'
    prisma.notificationEventChannel.findMany.mockResolvedValue([
      channelRow({
        channel: 'WECOM',
        sendMethod: 'APP',
        targetMode: 'USERS',
        targetConfig: { userIds: [] },
        ttlSeconds: 3_600,
        allowSensitive: true,
        messages: [
          {
            id: '00000000-0000-4000-8000-000000000098',
            sortOrder: 0,
            kind: 'MPNEWS',
            payload: {
              cover: { mediaAssetId: coverId },
              title: '{{orderNo}}{{orderNo}}{{orderNo}}',
              author: null,
              digest: null,
              contentSourceUrl: null,
              content: '<p>正文</p>',
            },
            mediaPolicy: {},
            enabled: true,
            contentHash: CONTENT_HASH,
          },
        ],
      }),
    ])
    const service = createService(prisma)

    const result = await service.preview(EVENT_TYPE, {
      variables: { orderNo: '中'.repeat(64) },
    })

    const item = result.channels[0]?.items[0]
    expect(item).toMatchObject({
      kind: 'MPNEWS',
      payload: expect.objectContaining({
        title: expect.stringMatching(/…$/u),
      }),
      warnings: expect.arrayContaining([
        expect.stringContaining('标题渲染后超过 128 字节'),
      ]),
    })
    const renderedTitle = (item?.payload as { title?: string } | undefined)?.title ?? ''
    expect(new TextEncoder().encode(renderedTitle).length).toBeLessThanOrEqual(128)
  })

  it('activates a freshly uploaded draft image during save', async () => {
    const prisma = createPrismaMock()
    const media = createMediaMocks()
    const assetId = '00000000-0000-4000-8000-000000000099'
    prisma.notificationEventChannel.findUnique.mockResolvedValue(null)
    prisma.notificationEventChannel.upsert.mockResolvedValue(channelRow({
      channel: 'WECOM',
      sendMethod: 'APP',
      version: 1,
    }))
    prisma.notificationEventChannel.findMany.mockResolvedValue([channelRow({
      channel: 'WECOM',
      sendMethod: 'APP',
      version: 1,
    })])
    prisma.mediaAsset.findMany.mockResolvedValue([{
      id: assetId,
      mediaType: 'IMAGE',
      status: 'UPLOADING',
      deletedAt: null,
      objectKey: 'assets/2026/11/cover.png',
      sizeBytes: 1n,
      createdByUserId: '00000000-0000-4000-8000-000000000001',
      uploadExpiresAt: new Date(Date.now() + 60_000),
    }])
    const service = createService(prisma, createAuditMock(), media)
    const input: NotificationEventConfigUpdateDto = {
      channels: [{
        channel: 'WECOM',
        sendMethod: 'APP',
        targetMode: 'USERS',
        targetConfig: { userIds: [] },
        expectedVersion: 0,
        messages: [{
          kind: 'MPNEWS',
          payload: {
            cover: { mediaAssetId: assetId },
            title: '采购通知',
            content: '<p>正文</p>',
          },
        }],
      }],
    }

    await service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      input,
    )

    expect(media.mediaAsset.activate).toHaveBeenCalledWith(prisma, assetId)
    expect(media.retention.markUnreferencedForTrash).not.toHaveBeenCalled()
  })

  it('rejects another operator in-flight upload instead of activating it', async () => {
    const prisma = createPrismaMock()
    const media = createMediaMocks()
    const assetId = '00000000-0000-4000-8000-000000000099'
    prisma.notificationEventChannel.findUnique.mockResolvedValue(null)
    prisma.notificationEventChannel.upsert.mockResolvedValue(channelRow({
      channel: 'WECOM',
      sendMethod: 'APP',
      version: 1,
    }))
    prisma.mediaAsset.findMany.mockResolvedValue([{
      id: assetId,
      mediaType: 'IMAGE',
      status: 'UPLOADING',
      deletedAt: null,
      objectKey: 'assets/2026/11/cover.png',
      sizeBytes: 1n,
      createdByUserId: '00000000-0000-4000-8000-000000000002',
      uploadExpiresAt: new Date(Date.now() + 60_000),
    }])
    const service = createService(prisma, createAuditMock(), media)
    const input: NotificationEventConfigUpdateDto = {
      channels: [{
        channel: 'WECOM',
        sendMethod: 'APP',
        targetMode: 'USERS',
        targetConfig: { userIds: [] },
        expectedVersion: 0,
        messages: [{
          kind: 'MPNEWS',
          payload: {
            cover: { mediaAssetId: assetId },
            title: '采购通知',
            content: '<p>正文</p>',
          },
        }],
      }],
    }

    await expect(service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      input,
    )).rejects.toMatchObject({ code: 'NOTIFICATION_EVENT_CONTENT_MEDIA_INVALID' })
    expect(media.mediaAsset.activate).not.toHaveBeenCalled()
  })

  it('trashes media that the updated channel no longer references', async () => {
    const prisma = createPrismaMock()
    const media = createMediaMocks()
    const oldAssetId = '00000000-0000-4000-8000-000000000098'
    prisma.notificationEventChannel.findUnique.mockResolvedValue(channelRow({ version: 2 }))
    prisma.notificationEventChannelMessageMedia.findMany.mockResolvedValue([
      { mediaAssetId: oldAssetId },
    ])
    prisma.notificationEventChannel.upsert.mockResolvedValue(channelRow({ version: 3 }))
    prisma.notificationEventChannel.findMany.mockResolvedValue([channelRow({ version: 3 })])
    const service = createService(prisma, createAuditMock(), media)
    const input: NotificationEventConfigUpdateDto = {
      channels: [{
        channel: 'IN_APP',
        sendMethod: 'IN_APP',
        targetMode: 'USERS',
        targetConfig: { userIds: [] },
        expectedVersion: 2,
        messages: [{ kind: 'TEXT', payload: { content: '仅保留文本' } }],
      }],
    }

    await service.update(
      { actorUserId: '00000000-0000-4000-8000-000000000001', requestId: 'request-1' },
      EVENT_TYPE,
      input,
    )

    expect(media.retention.markUnreferencedForTrash).toHaveBeenCalledWith(
      prisma,
      oldAssetId,
    )
  })

  it('rejects unknown event types', async () => {
    const service = createService(createPrismaMock())
    await expect(service.get('UNKNOWN_EVENT')).rejects.toBeInstanceOf(ApiException)
  })
})
