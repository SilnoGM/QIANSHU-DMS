/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言 mock 调用参数。 */
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { AssistantDispatchService } from './assistant-dispatch.service'
import type { AssistantMediaUrlService } from './assistant-media-url'
import { FakeAssistantTransport } from './fake-assistant.transport'

const configuration: AssistantConfiguration = {
  baseUrl: 'https://api.geweapi.com',
  token: 'test-token',
  workerEnabled: true,
  pollMs: 5_000,
  batchSize: 20,
  requestTimeoutMs: 1_000,
  minSendIntervalMs: 3_000,
}

function service(
  prisma: Record<string, unknown>,
  transport: FakeAssistantTransport = new FakeAssistantTransport(),
): AssistantDispatchService {
  return new AssistantDispatchService(
    prisma as unknown as PrismaService,
    { get: () => configuration } as unknown as ConfigService,
    transport,
    { sign: (id: string) => `https://dms.example.com/api/public/notification-media/${id}` } as unknown as AssistantMediaUrlService,
  )
}

function claimedDelivery(overrides: Record<string, unknown> = {}) {
  return {
    account_id: 'account-1',
    attempt_count: 0,
    content_sent_at: null,
    id: 'delivery-1',
    notification_id: 'notification-1',
    recipient_user_id: 'user-1',
    rendered_content: '正文',
    target_id: null,
    ...overrides,
  }
}

function mediaItem(overrides: Record<string, unknown> = {}) {
  return {
    attemptCount: 0,
    id: 'delivery-media-1',
    mediaAssetId: '11111111-1111-4111-8111-111111111111',
    nextAttemptAt: new Date(Date.now() - 1_000),
    sortOrder: 0,
    status: 'PENDING',
    ...overrides,
  }
}

/** dispatchDelivery 的私有依赖：只覆盖它实际读写的表。 */
function deliveryPrisma(options: {
  readonly contentSentAt?: Date | null
  readonly mediaFirst?: readonly Record<string, unknown>[]
  readonly mediaFinal?: readonly Record<string, unknown>[]
}) {
  const deliveryMediaFindMany = jest.fn()
    .mockResolvedValueOnce(options.mediaFirst ?? [])
    .mockResolvedValueOnce(options.mediaFinal ?? [])
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'assistant-dispatch' }]),
    notification: {
      findUnique: jest.fn().mockResolvedValue({
        eventType: 'SALES_RECEIPT_REVIEW_PENDING',
        expiresAt: new Date(Date.now() + 3_600_000),
        id: 'notification-1',
        priority: 'NORMAL',
      }),
      update: jest.fn(),
    },
    notificationChannelPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
    notificationUserMute: { findFirst: jest.fn().mockResolvedValue(null) },
    assistantAccount: {
      findUnique: jest.fn().mockResolvedValue({
        appId: 'wx-app',
        enabled: true,
        id: 'account-1',
        name: '公司号',
        status: 'ONLINE',
      }),
      update: jest.fn(),
    },
    assistantBinding: { findFirst: jest.fn().mockResolvedValue({ wxid: 'wxid-user' }) },
    assistantDelivery: {
      update: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([{ _count: { _all: 1 }, status: 'ACCEPTED' }]),
    },
    assistantDeliveryMedia: {
      findMany: deliveryMediaFindMany,
      update: jest.fn().mockResolvedValue({}),
    },
    notificationInboxItem: { count: jest.fn().mockResolvedValue(0) },
  }
}

async function runDelivery(
  prisma: Record<string, unknown>,
  transport: FakeAssistantTransport,
  delivery: Record<string, unknown>,
): Promise<void> {
  const instance = service(prisma, transport)
  const dispatch = (instance as unknown as {
    dispatchDelivery: (row: Record<string, unknown>, quietHours: null) => Promise<void>
  }).dispatchDelivery
  await dispatch.call(instance, delivery, null)
}

describe('AssistantDispatchService', () => {
  it('does nothing when the lease is held by another instance', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      notificationChannelSettings: { findUnique: jest.fn() },
    }
    await service(prisma).dispatchOnce(20)
    expect(prisma.notificationChannelSettings.findUnique).not.toHaveBeenCalled()
  })

  it('does nothing when the assistant channel is disabled', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'assistant-dispatch' }]),
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: false }) },
      assistantDelivery: { findMany: jest.fn() },
    }
    await service(prisma).dispatchOnce(20)
    expect(prisma.assistantDelivery.findMany).not.toHaveBeenCalled()
  })

  it('returns when no delivery is due', async () => {
    const prisma = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: 'assistant-dispatch' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
      assistantDelivery: { findMany: jest.fn().mockResolvedValue([]) },
    }
    await service(prisma).dispatchOnce(20)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3)
  })

  it('defers NORMAL deliveries during the quiet window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-10T14:30:00.000Z'))
    try {
      const update = jest.fn()
      const prisma = {
        $queryRaw: jest.fn()
          .mockResolvedValueOnce([{ id: 'assistant-dispatch' }])
          .mockResolvedValueOnce([{
            account_id: null,
            attempt_count: 0,
            id: 'delivery-1',
            notification_id: 'notification-1',
            recipient_user_id: 'user-1',
            rendered_content: 'test',
            target_id: null,
          }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 'assistant-dispatch' }]),
        notification: {
          findUnique: jest.fn().mockResolvedValue({
            eventType: 'PROXY_NODE_EXPIRING',
            expiresAt: new Date('2026-11-12T00:00:00.000Z'),
            id: 'notification-1',
            priority: 'NORMAL',
          }),
          update: jest.fn(),
        },
        notificationUserMute: { findFirst: jest.fn().mockResolvedValue(null) },
        notificationChannelPolicy: {
          findUnique: jest.fn().mockResolvedValue({
            quietHours: { end: '09:00', start: '22:00', timezone: 'Asia/Shanghai' },
          }),
        },
        notificationChannelSettings: {
          findUnique: jest.fn().mockResolvedValue({
            defaultQuietHours: { end: '09:00', start: '22:00', timezone: 'Asia/Shanghai' },
            enabled: true,
          }),
        },
        assistantDelivery: {
          findMany: jest.fn().mockResolvedValue([]),
          groupBy: jest.fn().mockResolvedValue([{ _count: { _all: 1 }, status: 'PENDING' }]),
          update,
        },
        notificationInboxItem: { count: jest.fn().mockResolvedValue(0) },
      }

      await service(prisma).dispatchOnce(20)

      expect(update).toHaveBeenCalledWith({
        data: { nextAttemptAt: new Date('2026-11-11T01:00:00.000Z'), status: 'PENDING' },
        where: { id: 'delivery-1' },
      })
    }
    finally {
      jest.useRealTimers()
    }
  })

  it('interleaves high and normal lanes with a 3:1 burst', async () => {
    const claimedDelivery = (id: string) => ({
      account_id: null,
      attempt_count: 0,
      id,
      notification_id: `notification-${id}`,
      recipient_user_id: 'user-1',
      rendered_content: id,
      target_id: null,
    })
    const high = [
      claimedDelivery('high-1'),
      claimedDelivery('high-2'),
      claimedDelivery('high-3'),
    ]
    const normal = [claimedDelivery('normal-1')]
    const $queryRaw = jest.fn()
      .mockResolvedValueOnce(high)
      .mockResolvedValueOnce(normal)
    const instance = service({ $queryRaw })
    const claim = (instance as unknown as {
      claimDeliveries: (batchSize: number) => Promise<Array<{ id: string }>>
    }).claimDeliveries

    const result = await claim.call(instance, 4)

    expect(result.map(item => item.id)).toEqual([
      'high-1',
      'high-2',
      'high-3',
      'normal-1',
    ])
    expect($queryRaw).toHaveBeenCalledTimes(2)
  })

  it('uses the full remaining batch for normal lane when high lane is empty', async () => {
    const claimedDelivery = (id: string) => ({
      account_id: null,
      attempt_count: 0,
      id,
      notification_id: `notification-${id}`,
      recipient_user_id: 'user-1',
      rendered_content: id,
      target_id: null,
    })
    const normal = [
      claimedDelivery('normal-1'),
      claimedDelivery('normal-2'),
      claimedDelivery('normal-3'),
    ]
    const $queryRaw = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(normal)
    const instance = service({ $queryRaw })
    const claim = (instance as unknown as {
      claimDeliveries: (batchSize: number) => Promise<Array<{ id: string }>>
    }).claimDeliveries

    const result = await claim.call(instance, 3)

    expect(result.map(item => item.id)).toEqual(['normal-1', 'normal-2', 'normal-3'])
  })

  it('keeps claiming high lane when normal lane is empty', async () => {
    const claimedDelivery = (id: string) => ({
      account_id: null,
      attempt_count: 0,
      id,
      notification_id: `notification-${id}`,
      recipient_user_id: 'user-1',
      rendered_content: id,
      target_id: null,
    })
    const $queryRaw = jest.fn()
      .mockResolvedValueOnce([claimedDelivery('high-1'), claimedDelivery('high-2'), claimedDelivery('high-3')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([claimedDelivery('high-4')])
    const instance = service({ $queryRaw })
    const claim = (instance as unknown as {
      claimDeliveries: (batchSize: number) => Promise<Array<{ id: string }>>
    }).claimDeliveries

    const result = await claim.call(instance, 4)

    expect(result.map(item => item.id)).toEqual(['high-1', 'high-2', 'high-3', 'high-4'])
  })

  it('requeues stale SENDING deliveries and fails exhausted attempts', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      assistantDelivery: {
        findMany: jest.fn().mockResolvedValue([
          { attemptCount: 0, id: 'delivery-retry', notificationId: 'notification-retry' },
          { attemptCount: 3, id: 'delivery-final', notificationId: 'notification-final' },
        ]),
        groupBy: jest.fn().mockResolvedValue([{ _count: { _all: 1 }, status: 'PENDING' }]),
        updateMany,
      },
      notification: { update: jest.fn() },
      notificationInboxItem: { count: jest.fn().mockResolvedValue(0) },
    }
    const instance = service(prisma)
    const recover = (instance as unknown as {
      recoverStaleSendingDeliveries: (config?: AssistantConfiguration) => Promise<void>
    }).recoverStaleSendingDeliveries

    await recover.call(instance, configuration)

    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: { in: ['delivery-retry'] }, status: 'SENDING' },
      data: expect.objectContaining({
        attemptCount: { increment: 1 },
        failureCode: 'SENDING_RECOVERED',
        status: 'PENDING',
      }),
    }))
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: { in: ['delivery-final'] }, status: 'SENDING' },
      data: expect.objectContaining({
        attemptCount: { increment: 1 },
        failureCode: 'SENDING_RECOVERED',
        status: 'FAILED',
      }),
    }))
  })

  it('skips a queued delivery when the recipient muted the event after publish', async () => {
    const prisma = deliveryPrisma({})
    prisma.notificationUserMute = { findFirst: jest.fn().mockResolvedValue({ id: 'mute-1' }) }
    const transport = new FakeAssistantTransport()

    await runDelivery(prisma, transport, claimedDelivery())

    expect(prisma.notificationUserMute.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', eventType: 'SALES_RECEIPT_REVIEW_PENDING', channel: 'ASSISTANT' },
      select: { id: true },
    })
    expect(transport.calls).toEqual([])
    expect(prisma.assistantDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({ status: 'SKIPPED', failureCode: 'USER_MUTED' }),
    })
  })

  describe('media attachments', () => {
    it('sends the text once and then every attachment in order', async () => {
      const first = mediaItem({ id: 'media-1', sortOrder: 0 })
      const second = mediaItem({
        id: 'media-2',
        mediaAssetId: '22222222-2222-4222-8222-222222222222',
        sortOrder: 1,
      })
      const prisma = deliveryPrisma({
        mediaFirst: [first, second],
        mediaFinal: [
          { status: 'ACCEPTED', nextAttemptAt: new Date() },
          { status: 'ACCEPTED', nextAttemptAt: new Date() },
        ],
      })
      const transport = new FakeAssistantTransport()

      await runDelivery(prisma, transport, claimedDelivery())

      expect(transport.calls).toEqual([{ appId: 'wx-app', content: '正文', toWxid: 'wxid-user' }])
      expect(transport.imageCalls).toEqual([
        { appId: 'wx-app', imageUrl: 'https://dms.example.com/api/public/notification-media/media-1', toWxid: 'wxid-user' },
        { appId: 'wx-app', imageUrl: 'https://dms.example.com/api/public/notification-media/media-2', toWxid: 'wxid-user' },
      ])
      expect(prisma.assistantDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: {
          contentSentAt: expect.any(Date),
          attemptCount: { increment: 1 },
          providerMsgId: 'fake-msg-id',
          providerNewMsgId: 'fake-new-msg-id',
          failureCode: null,
          failureMessage: null,
        },
      })
      expect(prisma.assistantDelivery.update).toHaveBeenLastCalledWith({
        where: { id: 'delivery-1' },
        data: { status: 'ACCEPTED', acceptedAt: expect.any(Date), failureCode: null, failureMessage: null },
      })
      expect(prisma.assistantDeliveryMedia.update).toHaveBeenCalledTimes(2)
    })

    it('retries only the failed attachment after the text was already sent', async () => {
      const prisma = deliveryPrisma({
        mediaFirst: [mediaItem({ id: 'media-2', sortOrder: 1 })],
        mediaFinal: [
          { status: 'ACCEPTED', nextAttemptAt: new Date() },
          { status: 'FAILED', nextAttemptAt: new Date() },
        ],
      })
      const transport = new FakeAssistantTransport([], [{
        ok: false,
        kind: 'REJECTED',
        code: 'ASSISTANT_REJECTED_400',
        message: '图片不可下载',
      }])

      await runDelivery(prisma, transport, claimedDelivery({ content_sent_at: new Date() }))

      expect(transport.calls).toEqual([])
      expect(transport.imageCalls).toHaveLength(1)
      expect(prisma.assistantDelivery.update).toHaveBeenLastCalledWith({
        where: { id: 'delivery-1' },
        data: {
          status: 'PARTIAL',
          acceptedAt: null,
          failureCode: 'MEDIA_ATTACHMENT_FAILED',
          failureMessage: '1 个附件未发送',
        },
      })
    })

    it('does not touch attachments when the text itself fails', async () => {
      const prisma = deliveryPrisma({ mediaFirst: [mediaItem()] })
      const transport = new FakeAssistantTransport([{
        ok: false,
        kind: 'NETWORK',
        code: 'ASSISTANT_NETWORK_ERROR',
        message: '网络错误',
      }])

      await runDelivery(prisma, transport, claimedDelivery())

      expect(transport.imageCalls).toEqual([])
      expect(prisma.assistantDeliveryMedia.findMany).not.toHaveBeenCalled()
      expect(prisma.assistantDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }))
    })
  })
})
