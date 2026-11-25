/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言 mock 调用参数。 */
import { ConfigService } from '@nestjs/config'

import type { WecomConfiguration } from '../../config/wecom.config'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { WecomDispatchService } from './wecom-dispatch.service'
import type { WecomSecretService } from './wecom-secret.service'
import type { WecomTokenService } from './wecom-token.service'
import type { WecomAppTransport, WecomRobotTransport } from './wecom.types'

const configuration: WecomConfiguration = {
  baseUrl: 'https://qyapi.weixin.qq.com',
  workerEnabled: true,
  pollMs: 5_000,
  batchSize: 20,
  requestTimeoutMs: 1_000,
  appMinSendIntervalMs: 1_000,
  robotMinSendIntervalMs: 3_000,
  maxTextBytes: 2_048,
}

function configService(): ConfigService {
  return { get: () => configuration } as unknown as ConfigService
}

const secretService = {
  decrypt: jest.fn().mockReturnValue('plain-secret'),
} as unknown as WecomSecretService

const tokenService = {
  getAccessToken: jest.fn().mockResolvedValue({ ok: true, accessToken: 'token-1' }),
  invalidate: jest.fn(),
} as unknown as WecomTokenService

function robotDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    notification_id: 'notification-1',
    app_id: null,
    transport: 'ROBOT',
    recipient_user_id: null,
    target_id: 'target-1',
    attempt_count: 0,
    rendered_content: '正文',
    mention_mode: null,
    content_sent_at: null,
    ...overrides,
  }
}

function appDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-2',
    notification_id: 'notification-1',
    app_id: 'app-1',
    transport: 'APP',
    recipient_user_id: 'user-1',
    target_id: null,
    attempt_count: 0,
    rendered_content: '正文',
    mention_mode: null,
    content_sent_at: null,
    ...overrides,
  }
}

function basePrisma(overrides: Record<string, unknown> = {}) {
  return {
    notification: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'notification-1',
        eventType: 'PURCHASE_REVIEW_PENDING',
        expiresAt: new Date(Date.now() + 3_600_000),
        priority: 'NORMAL',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    notificationUserMute: { findFirst: jest.fn().mockResolvedValue(null) },
    notificationChannelPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
    notificationEventChannel: { findUnique: jest.fn().mockResolvedValue(null) },
    notificationDeliveryMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notificationInboxItem: { count: jest.fn().mockResolvedValue(0) },
    mediaAsset: { findUnique: jest.fn().mockResolvedValue(null) },
    wecomMediaCache: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    wecomDelivery: {
      groupBy: jest.fn().mockResolvedValue([{ _count: { _all: 1 }, status: 'ACCEPTED' }]),
      update: jest.fn().mockResolvedValue({}),
    },
    wecomDeliveryMedia: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  }
}

function service(
  prisma: Record<string, unknown>,
  robotTransport: WecomRobotTransport,
  appTransport: WecomAppTransport = {
    sendText: jest.fn(),
    uploadImage: jest.fn(),
    uploadImageUrl: jest.fn(),
    sendImage: jest.fn(),
    sendMpnews: jest.fn(),
  },
  mediaOverrides: Record<string, unknown> = {},
): WecomDispatchService {
  const mediaService = {
    read: jest.fn(),
    prepareAppImage: jest.fn(),
    prepareRobotImage: jest.fn(),
    prepareMpnewsInlineImage: jest.fn(),
    ...mediaOverrides,
  }
  return new WecomDispatchService(
    prisma as unknown as PrismaService,
    configService(),
    secretService,
    tokenService,
    mediaService as unknown as import('./wecom-media.service').WecomMediaService,
    appTransport,
    robotTransport,
  )
}

async function runDelivery(
  instance: WecomDispatchService,
  delivery: Record<string, unknown>,
  defaultQuietHours: null = null,
): Promise<void> {
  const dispatch = (instance as unknown as {
    dispatchDelivery: (row: Record<string, unknown>, quiet: null) => Promise<void>
  }).dispatchDelivery
  await dispatch.call(instance, delivery, defaultQuietHours)
}

describe('WecomDispatchService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(secretService.decrypt as jest.Mock).mockReturnValue('plain-secret')
    ;(tokenService.getAccessToken as jest.Mock).mockResolvedValue({ ok: true, accessToken: 'token-1' })
  })

  it('sends a robot text message and marks the delivery accepted', async () => {
    const prisma = basePrisma({
      wecomTarget: {
        findUnique: jest.fn().mockResolvedValue({
          webhookKeyEncrypted: 'encrypted-key',
          enabled: true,
          internalOnly: true,
        }),
      },
    })
    const robot = {
      sendText: jest.fn().mockResolvedValue({ ok: true, msgId: null }),
      sendImage: jest.fn(),
    }
    const instance = service(prisma, robot)

    await runDelivery(instance, robotDelivery())

    expect(robot.sendText).toHaveBeenCalledWith({
      webhookKey: 'plain-secret',
      content: '正文',
    })
    expect(prisma.wecomDelivery.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'delivery-1' },
      data: expect.objectContaining({
        contentSentAt: expect.any(Date),
        mentionMode: 'NONE',
        failureCode: null,
      }),
    })
    expect(prisma.wecomDelivery.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'delivery-1' },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    })
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'notification-1' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    })
  })

  it('passes @all to the robot when the policy configures it', async () => {
    const prisma = basePrisma({
      notificationEventChannel: {
        findUnique: jest.fn().mockResolvedValue({
          targetConfig: { mention: { mode: 'ALL' } },
        }),
      },
      wecomTarget: {
        findUnique: jest.fn().mockResolvedValue({
          webhookKeyEncrypted: 'encrypted-key',
          enabled: true,
          internalOnly: true,
        }),
      },
    })
    const robot = {
      sendText: jest.fn().mockResolvedValue({ ok: true, msgId: null }),
      sendImage: jest.fn(),
    }
    const instance = service(prisma, robot)

    await runDelivery(instance, robotDelivery())

    expect(robot.sendText).toHaveBeenCalledWith({
      webhookKey: 'plain-secret',
      content: '正文',
      mentionedUserIds: ['@all'],
    })
    expect(prisma.wecomDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({ mentionMode: 'ALL', mentionedCount: 1 }),
    })
  })

  it('sends an app text message using the app token and member id', async () => {
    const prisma = basePrisma({
      wecomApp: {
        findUnique: jest.fn().mockResolvedValue({
          key: 'default',
          agentId: 1000001,
          corpId: 'ww-1',
          enabled: true,
          status: 'ACTIVE',
          secretEncrypted: 'encrypted-secret',
        }),
      },
      wecomBinding: {
        findUnique: jest.fn().mockResolvedValue({
          wecomUserId: 'zhangsan',
          status: 'ACTIVE',
          verifiedAt: new Date(),
        }),
      },
      wecomAppMembership: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          verifiedAt: new Date(),
        }),
      },
    })
    const app = {
      sendText: jest.fn().mockResolvedValue({ ok: true, msgId: 'msg-1' }),
      uploadImage: jest.fn(),
      uploadImageUrl: jest.fn(),
      sendImage: jest.fn(),
      sendMpnews: jest.fn(),
    }
    const instance = service(prisma, { sendText: jest.fn(), sendImage: jest.fn() }, app)

    await runDelivery(instance, appDelivery())

    expect(tokenService.getAccessToken).toHaveBeenCalledWith({
      appKey: 'default',
      corpId: 'ww-1',
      secret: 'plain-secret',
    })
    expect(app.sendText).toHaveBeenCalledWith({
      accessToken: 'token-1',
      agentId: 1000001,
      toUser: 'zhangsan',
      content: '正文',
    })
    expect(prisma.wecomDelivery.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'delivery-2' },
      data: expect.objectContaining({ contentSentAt: expect.any(Date), providerMsgId: 'msg-1' }),
    })
    expect(prisma.wecomDelivery.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'delivery-2' },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    })
  })

  it('skips when the member is not in the app visible scope', async () => {
    const prisma = basePrisma({
      wecomApp: {
        findUnique: jest.fn().mockResolvedValue({
          key: 'default',
          agentId: 1000001,
          corpId: 'ww-1',
          enabled: true,
          status: 'ACTIVE',
          secretEncrypted: 'encrypted-secret',
        }),
      },
      wecomBinding: {
        findUnique: jest.fn().mockResolvedValue({
          wecomUserId: 'zhangsan',
          status: 'ACTIVE',
          verifiedAt: new Date(),
        }),
      },
      wecomAppMembership: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'INVALID',
          verifiedAt: null,
        }),
      },
    })
    const app = { sendText: jest.fn(), uploadImage: jest.fn(), uploadImageUrl: jest.fn(), sendImage: jest.fn(), sendMpnews: jest.fn() }
    const instance = service(prisma, { sendText: jest.fn(), sendImage: jest.fn() }, app)

    await runDelivery(instance, appDelivery())

    expect(app.sendText).not.toHaveBeenCalled()
    expect(prisma.wecomDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-2' },
      data: expect.objectContaining({
        status: 'SKIPPED',
        failureCode: 'NOT_IN_APP_SCOPE',
      }),
    })
  })

  it('defers a normal delivery during quiet hours', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-24T14:30:00.000Z'))
    try {
      const prisma = basePrisma({
        notification: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'notification-1',
            eventType: 'PURCHASE_REVIEW_PENDING',
            expiresAt: new Date('2026-11-25T12:00:00.000Z'),
            priority: 'NORMAL',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        notificationEventChannel: {
          findUnique: jest.fn().mockResolvedValue({
            quietHours: { start: '22:00', end: '09:00', timezone: 'Asia/Shanghai' },
          }),
        },
      })
      const robot = { sendText: jest.fn(), sendImage: jest.fn() }
      const instance = service(prisma, robot)

      await runDelivery(instance, robotDelivery())

      expect(robot.sendText).not.toHaveBeenCalled()
      expect(prisma.wecomDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({ status: 'PENDING' }),
      })
    }
    finally {
      jest.useRealTimers()
    }
  })

  it('sends app delivery message items in order', async () => {
    const prisma = basePrisma({
      wecomApp: {
        findUnique: jest.fn().mockResolvedValue({
          key: 'wecom-app',
          agentId: 100001,
          corpId: 'corp-1',
          enabled: true,
          status: 'ACTIVE',
          secretEncrypted: 'encrypted-secret',
        }),
      },
      wecomBinding: {
        findUnique: jest.fn().mockResolvedValue({
          wecomUserId: 'zhangsan',
          status: 'ACTIVE',
          verifiedAt: new Date('2026-11-25T10:00:00.000Z'),
        }),
      },
      wecomAppMembership: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          verifiedAt: new Date('2026-11-25T10:00:00.000Z'),
        }),
      },
      notificationDeliveryMessage: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'delivery-message-1',
          deliveryId: 'delivery-2',
          renderedMessageId: 'rendered-1',
          sortOrder: 0,
          status: 'PENDING',
          attemptCount: 0,
          nextAttemptAt: new Date('2026-11-25T10:00:00.000Z'),
          providerMsgId: null,
          failureCode: null,
          failureMessage: null,
          acceptedAt: null,
          renderedMessage: {
            kind: 'TEXT',
            payloadSnapshot: { content: '新正文' },
          },
        }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    })
    const app = {
      sendText: jest.fn().mockResolvedValue({ ok: true, msgId: 'msg-1' }),
      uploadImage: jest.fn(),
      uploadImageUrl: jest.fn(),
      sendImage: jest.fn(),
      sendMpnews: jest.fn(),
    }
    const instance = service(prisma, { sendText: jest.fn(), sendImage: jest.fn() }, app)

    await runDelivery(instance, appDelivery())

    expect(app.sendText).toHaveBeenCalledWith({
      accessToken: 'token-1',
      agentId: 100001,
      toUser: 'zhangsan',
      content: '新正文',
    })
    expect(prisma.notificationDeliveryMessage.update).toHaveBeenCalledWith({
      where: { id: 'delivery-message-1' },
      data: expect.objectContaining({
        status: 'ACCEPTED',
        providerMsgId: 'msg-1',
      }),
    })
    expect(prisma.wecomDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-2' },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    })
  })

  it('stops robot delivery message items when a later item fails', async () => {
    const prisma = basePrisma({
      wecomTarget: {
        findUnique: jest.fn().mockResolvedValue({
          webhookKeyEncrypted: 'encrypted-key',
          enabled: true,
          internalOnly: true,
        }),
      },
      notificationDeliveryMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'delivery-message-1',
            deliveryId: 'delivery-1',
            renderedMessageId: 'rendered-1',
            sortOrder: 0,
            status: 'PENDING',
            attemptCount: 0,
            nextAttemptAt: new Date('2026-11-25T10:00:00.000Z'),
            providerMsgId: null,
            failureCode: null,
            failureMessage: null,
            acceptedAt: null,
            renderedMessage: { kind: 'TEXT', payloadSnapshot: { content: '第一' } },
          },
          {
            id: 'delivery-message-2',
            deliveryId: 'delivery-1',
            renderedMessageId: 'rendered-2',
            sortOrder: 1,
            status: 'PENDING',
            attemptCount: 0,
            nextAttemptAt: new Date('2026-11-25T10:00:00.000Z'),
            providerMsgId: null,
            failureCode: null,
            failureMessage: null,
            acceptedAt: null,
            renderedMessage: { kind: 'TEXT', payloadSnapshot: { content: '第二' } },
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    })
    const robot = {
      sendText: jest.fn()
        .mockResolvedValueOnce({ ok: true, msgId: null })
        .mockResolvedValueOnce({ ok: false, kind: 'REJECTED', code: 'WECOM_REJECTED', message: '拒绝' }),
      sendImage: jest.fn(),
    }
    const instance = service(prisma, robot)

    await runDelivery(instance, robotDelivery())

    expect(robot.sendText).toHaveBeenNthCalledWith(1, {
      webhookKey: 'plain-secret',
      content: '第一',
    })
    expect(robot.sendText).toHaveBeenNthCalledWith(2, {
      webhookKey: 'plain-secret',
      content: '第二',
    })
    expect(prisma.notificationDeliveryMessage.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'delivery-message-1' },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    })
    expect(prisma.notificationDeliveryMessage.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'delivery-message-2' },
      data: expect.objectContaining({ status: 'FAILED' }),
    })
    expect(prisma.wecomDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({ status: 'PARTIAL' }),
    })
  })

  it('sends an mpnews item with cover media and inline image URL', async () => {
    const coverId = '00000000-0000-4000-8000-000000000099'
    const inlineId = '00000000-0000-4000-8000-000000000097'
    const asset = {
      mediaType: 'IMAGE',
      status: 'READY',
      deletedAt: null,
      objectKey: 'image.png',
      mimeType: 'image/png',
      originalFilename: 'image.png',
    }
    const prisma = basePrisma({
      wecomApp: {
        findUnique: jest.fn().mockResolvedValue({
          key: 'wecom-app',
          agentId: 100001,
          corpId: 'corp-1',
          enabled: true,
          status: 'ACTIVE',
          secretEncrypted: 'encrypted-secret',
        }),
      },
      wecomBinding: {
        findUnique: jest.fn().mockResolvedValue({
          wecomUserId: 'zhangsan',
          status: 'ACTIVE',
          verifiedAt: new Date('2026-11-25T10:00:00.000Z'),
        }),
      },
      wecomAppMembership: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          verifiedAt: new Date('2026-11-25T10:00:00.000Z'),
        }),
      },
      mediaAsset: {
        findUnique: jest.fn().mockResolvedValue(asset),
      },
      notificationDeliveryMessage: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'delivery-message-mpnews',
          deliveryId: 'delivery-2',
          renderedMessageId: 'rendered-mpnews',
          sortOrder: 0,
          status: 'PENDING',
          attemptCount: 0,
          nextAttemptAt: new Date('2026-11-25T10:00:00.000Z'),
          providerMsgId: null,
          failureCode: null,
          failureMessage: null,
          acceptedAt: null,
          renderedMessage: {
            kind: 'MPNEWS',
            payloadSnapshot: {
              coverAssetId: coverId,
              title: '采购通知',
              author: null,
              digest: null,
              contentSourceUrl: null,
              content: `<p>正文</p><img data-asset-id="${inlineId}">`,
              assetIds: [coverId, inlineId],
            },
          },
        }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    })
    const app = {
      sendText: jest.fn(),
      uploadImage: jest.fn().mockResolvedValue({ ok: true, mediaId: 'thumb-1' }),
      uploadImageUrl: jest.fn().mockResolvedValue({ ok: true, url: 'https://wecom.example/image' }),
      sendImage: jest.fn(),
      sendMpnews: jest.fn().mockResolvedValue({ ok: true, msgId: 'msg-2' }),
    }
    const prepared = {
      ok: true,
      buffer: Buffer.from('image'),
      mimeType: 'image/png',
      filename: 'image.png',
    }
    const instance = service(prisma, { sendText: jest.fn(), sendImage: jest.fn() }, app, {
      read: jest.fn().mockResolvedValue(Buffer.from('source')),
      prepareAppImage: jest.fn().mockResolvedValue(prepared),
      prepareMpnewsInlineImage: jest.fn().mockResolvedValue(prepared),
    })

    await runDelivery(instance, appDelivery())

    expect(app.uploadImage).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'token-1' }))
    expect(app.uploadImageUrl).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'token-1' }))
    expect(app.sendMpnews).toHaveBeenCalledWith({
      accessToken: 'token-1',
      agentId: 100001,
      toUser: 'zhangsan',
      articles: [expect.objectContaining({
        title: '采购通知',
        thumbMediaId: 'thumb-1',
        content: expect.stringContaining('src="https://wecom.example/image"'),
      })],
    })
    expect(prisma.wecomMediaCache.upsert).toHaveBeenCalledTimes(2)
    expect(prisma.notificationDeliveryMessage.update).toHaveBeenCalledWith({
      where: { id: 'delivery-message-mpnews' },
      data: expect.objectContaining({ status: 'ACCEPTED', providerMsgId: 'msg-2' }),
    })
  })
})
