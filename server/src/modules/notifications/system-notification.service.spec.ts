/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言调用参数。 */
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { SystemNotificationService } from './system-notification.service'
import type { SystemNotificationPublishCommand } from './notification.types'

const command: SystemNotificationPublishCommand = {
  eventType: 'PURCHASE_REVIEW_PENDING',
  source: { type: 'PURCHASE_ORDER', id: 'order-1' },
  target: { kind: 'PERMISSION', permissionCode: 'purchase-orders:review' },
  templateKey: 'purchase.review.pending',
  variables: { orderNo: 'CG-1' },
  dedupeKey: 'purchase-review:order-1',
}

function assistantPolicy(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'ASSISTANT',
    targetMode: 'COMMAND_TARGET',
    targetConfig: {},
    allowSensitive: true,
    ttlSeconds: 86_400,
    priority: 'NORMAL',
    enabled: true,
    ...overrides,
  }
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    key: 'purchase.review.pending',
    channel: 'ASSISTANT',
    bodyTemplate: '采购单 {{orderNo}} 待审核',
    linkUrlTemplate: null,
    variables: [{ name: 'orderNo', required: true }],
    maxLength: 2_000,
    enabled: true,
    version: 1,
    ...overrides,
  }
}


function createNumbering() {
  return {
    generateScopedInTransaction: jest.fn().mockResolvedValue({
      idempotentReplay: false,
      issuanceId: 'issuance-1',
      issuedAt: '2026-11-11T00:00:00.000Z',
      number: 'NTF/20261111-000001',
      ruleCode: 'NOTIFICATION_NO',
      ruleRevision: 1,
    }),
  } as unknown as NumberingGeneratorService
}

function createService(
  prisma: PrismaService,
  numbering: NumberingGeneratorService = createNumbering(),
) {
  return new SystemNotificationService(prisma, numbering)
}

describe('SystemNotificationService.publish', () => {
  it('returns the existing notification for a duplicate dedupe key', async () => {
    const transaction = {
      notification: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }) },
    }
    const numbering = createNumbering()
    const service = createService({} as PrismaService, numbering)

    const result = await service.publish(command, { transaction: transaction as never })

    expect(result).toMatchObject({
      notificationId: 'existing',
      duplicated: true,
      channels: [],
    })
    expect(transaction.notification.findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: 'PURCHASE_REVIEW_PENDING:purchase-review:order-1' },
      select: { id: true },
    })
    expect(numbering.generateScopedInTransaction).not.toHaveBeenCalled()
  })

  it('records a failed notification when the event has no enabled policy', async () => {
    const transaction = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const service = createService({} as PrismaService)

    const result = await service.publish(command, { transaction: transaction as never })

    expect(result.notificationId).toBe('n1')
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EVENT_NOT_CONFIGURED' }),
    ]))
    expect(transaction.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationNo: 'NTF/20261111-000001',
        numberingIssuanceId: 'issuance-1',
      }),
      select: { id: true },
    })
    const updateCalls = transaction.notification.update.mock.calls as unknown as Array<
      Array<{ data?: { status?: string } }>
    >
    expect(updateCalls[0]?.[0]?.data?.status).toBe('FAILED')
  })

  it('records a failed notification when the template is missing', async () => {
    const transaction = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n2' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([assistantPolicy()]) },
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
    }
    const service = createService({} as PrismaService)

    const result = await service.publish(command, { transaction: transaction as never })

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TEMPLATE_NOT_FOUND' }),
    ]))
    const updateCalls = transaction.notification.update.mock.calls as unknown as Array<
      Array<{ data?: { status?: string } }>
    >
    expect(updateCalls[0]?.[0]?.data?.status).toBe('FAILED')
  })

  it('uses the channel policy priority instead of the command priority', async () => {
    const transaction = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n-priority' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([assistantPolicy({
        priority: 'NORMAL',
        targetMode: 'GROUP',
        targetConfig: { targetKeys: ['operations'] },
      })]) },
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(template()) },
      assistantTarget: { findMany: jest.fn().mockResolvedValue([{ id: 'target-1', internalOnly: true }]) },
      assistantAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'account-1' }) },
      assistantDelivery: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
      },
      notificationInboxItem: { count: jest.fn().mockResolvedValue(0) },
    }
    const service = createService({} as PrismaService)

    await service.publish({ ...command, priority: 'HIGH' }, { transaction: transaction as never })

    expect(transaction.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ priority: 'NORMAL' }),
      select: { id: true },
    })
  })

  it('uses the policy template key when it overrides the command key', async () => {
    const transaction = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n3' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([assistantPolicy({
        targetMode: 'GROUP',
        targetConfig: { targetKeys: ['operations'] },
        templateKey: 'purchase.review.pending.short',
      })]) },
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(template({
        key: 'purchase.review.pending.short',
        bodyTemplate: '采购单 {{orderNo}} 待审（简版）',
      })) },
      assistantTarget: { findMany: jest.fn().mockResolvedValue([{ id: 'target-1', internalOnly: true }]) },
      assistantAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'account-1' }) },
      assistantDelivery: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
      },
      notificationInboxItem: { count: jest.fn().mockResolvedValue(0) },
    }
    const service = createService({} as PrismaService)

    const result = await service.publish(command, { transaction: transaction as never })

    expect(transaction.notificationTemplate.findUnique).toHaveBeenCalledWith({
      where: { key_channel: { key: 'purchase.review.pending.short', channel: 'ASSISTANT' } },
    })
    expect(transaction.assistantDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        templateKey: 'purchase.review.pending.short',
        renderedContent: '采购单 CG-1 待审（简版）',
      })],
    })
    expect(result.channels).toEqual([
      { channel: 'ASSISTANT', status: 'PENDING', recipientCount: 1, skippedCount: 0 },
    ])
  })

  it('does not fall back to the command template when the policy template is missing', async () => {
    const transaction = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n3' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([assistantPolicy({
        templateKey: 'purchase.review.pending.short',
      })]) },
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
    }
    const service = createService({} as PrismaService)

    const result = await service.publish(command, { transaction: transaction as never })

    expect(transaction.notificationTemplate.findUnique).toHaveBeenCalledTimes(1)
    expect(transaction.notificationTemplate.findUnique).toHaveBeenCalledWith({
      where: { key_channel: { key: 'purchase.review.pending.short', channel: 'ASSISTANT' } },
    })
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TEMPLATE_NOT_FOUND' }),
    ]))
    const updateCalls = transaction.notification.update.mock.calls as unknown as Array<
      Array<{ data?: { status?: string } }>
    >
    expect(updateCalls[0]?.[0]?.data?.status).toBe('FAILED')
  })

  it('records the policy template key on in-app inbox items', async () => {
    const transaction = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n4' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([assistantPolicy({
        channel: 'IN_APP',
        targetMode: 'USERS',
        targetConfig: { userIds: ['user-1'] },
        ttlSeconds: null,
        templateKey: 'purchase.review.pending.short',
      })]) },
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(template({
        key: 'purchase.review.pending.short',
        channel: 'IN_APP',
        titleTemplate: '采购单 {{orderNo}} 待审核',
        bodyTemplate: '采购单 {{orderNo}} 待审核（简版）',
        linkUrlTemplate: null,
      })) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
      notificationInboxItem: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      assistantDelivery: { count: jest.fn().mockResolvedValue(0) },
    }
    const service = createService({} as PrismaService)

    await service.publish(command, { transaction: transaction as never })

    expect(transaction.notificationTemplate.findUnique).toHaveBeenCalledWith({
      where: { key_channel: { key: 'purchase.review.pending.short', channel: 'IN_APP' } },
    })
    expect(transaction.notificationInboxItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        notificationId: 'n4',
        userId: 'user-1',
        templateKey: 'purchase.review.pending.short',
        bodySnapshot: '采购单 CG-1 待审核（简版）',
      })],
      skipDuplicates: true,
    })
  })

  it('creates pending group deliveries for an internal group', async () => {
    const transaction = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n3' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([assistantPolicy({
        targetMode: 'GROUP',
        targetConfig: { targetKeys: ['operations'] },
      })]) },
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(template()) },
      assistantTarget: { findMany: jest.fn().mockResolvedValue([{ id: 'target-1', internalOnly: true }]) },
      assistantAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'account-1' }) },
      assistantDelivery: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
      },
      notificationInboxItem: { count: jest.fn().mockResolvedValue(0) },
    }
    const service = createService({} as PrismaService)

    const result = await service.publish(command, { transaction: transaction as never })

    expect(result.channels).toEqual([
      { channel: 'ASSISTANT', status: 'PENDING', recipientCount: 1, skippedCount: 0 },
    ])
    expect(transaction.assistantDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        notificationId: 'n3',
        targetId: 'target-1',
        accountId: 'account-1',
        status: 'PENDING',
        templateKey: 'purchase.review.pending',
        renderedContent: '采购单 CG-1 待审核',
      })],
    })
    expect(transaction.notification.update).toHaveBeenCalledWith({
      where: { id: 'n3' },
      data: { status: 'PENDING' },
    })
  })

  it('creates in-app inbox items inside the business transaction', async () => {
    const transaction = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n4' }),
        update: jest.fn().mockResolvedValue({}),
      },
      notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([assistantPolicy({
        channel: 'IN_APP',
        targetMode: 'USERS',
        targetConfig: { userIds: ['user-1'] },
        ttlSeconds: null,
      })]) },
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(template({
        channel: 'IN_APP',
        titleTemplate: '采购单 {{orderNo}} 待审核',
        bodyTemplate: '采购单 {{orderNo}} 待审核',
        linkUrlTemplate: null,
      })) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
      notificationInboxItem: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      assistantDelivery: { count: jest.fn().mockResolvedValue(0) },
    }
    const service = createService({} as PrismaService)

    const result = await service.publish(command, { transaction: transaction as never })

    expect(result.channels).toEqual([
      { channel: 'IN_APP', status: 'CREATED', recipientCount: 1, skippedCount: 0 },
    ])
    expect(transaction.notificationInboxItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        notificationId: 'n4',
        userId: 'user-1',
        eventType: 'PURCHASE_REVIEW_PENDING',
        titleSnapshot: '采购单 CG-1 待审核',
        bodySnapshot: '采购单 CG-1 待审核',
        linkUrlSnapshot: null,
      })],
      skipDuplicates: true,
    })
    expect(transaction.notification.update).toHaveBeenCalledWith({
      where: { id: 'n4' },
      data: { status: 'COMPLETED', completedAt: expect.any(Date) },
    })
  })

  describe('media attachments', () => {
    const FIRST_ASSET = '11111111-1111-4111-8111-111111111111'
    const SECOND_ASSET = '22222222-2222-4222-8222-222222222222'
    const readyImage = (id: string) => ({
      id,
      mediaType: 'IMAGE',
      status: 'READY',
      deletedAt: null,
      objectKey: `assets/sales/${id}.jpg`,
    })

    const mediaCommand: SystemNotificationPublishCommand = {
      ...command,
      eventType: 'SALES_RECEIPT_REVIEW_PENDING',
      templateKey: 'sales.receipt.pending',
      target: { kind: 'USERS', userIds: ['user-1'] },
      media: [{ assetId: FIRST_ASSET }, { assetId: SECOND_ASSET }],
    }

    function mediaTransaction(options: {
      readonly mediaPolicy?: Record<string, unknown>
      readonly allowSensitive?: boolean
      readonly assets?: readonly Record<string, unknown>[]
    } = {}) {
      return {
        notification: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'n-media' }),
          update: jest.fn().mockResolvedValue({}),
        },
        notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([assistantPolicy({
          allowSensitive: options.allowSensitive ?? true,
          targetMode: 'COMMAND_TARGET',
          targetConfig: {},
        })]) },
        notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
        notificationTemplate: {
          findUnique: jest.fn().mockResolvedValue(template({
            key: 'sales.receipt.pending',
            bodyTemplate: '收款 {{collectionNo}} 待审核',
            variables: [{ name: 'collectionNo', required: true }],
            mediaPolicy: options.mediaPolicy ?? { enabled: true, maxCount: 2, kinds: ['IMAGE'] },
          })),
        },
        mediaAsset: { findMany: jest.fn().mockResolvedValue(options.assets ?? [readyImage(FIRST_ASSET), readyImage(SECOND_ASSET)]) },
        notificationMedia: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
        assistantBinding: { findMany: jest.fn().mockResolvedValue([{ userId: 'user-1', accountId: 'account-1' }]) },
        assistantDelivery: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
          count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
        },
        assistantDeliveryMedia: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
        notificationInboxItem: { count: jest.fn().mockResolvedValue(0) },
      }
    }

    const publishCommand: SystemNotificationPublishCommand = {
      ...mediaCommand,
      variables: { collectionNo: 'SK-1' },
    }

    it('persists allowed attachments and per-delivery items in publish order', async () => {
      const transaction = mediaTransaction()
      const service = createService({} as PrismaService)

      const result = await service.publish(publishCommand, { transaction: transaction as never })

      expect(transaction.notificationMedia.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'n-media', mediaAssetId: FIRST_ASSET, sortOrder: 0, sourceKey: null, blockedReason: null },
          { notificationId: 'n-media', mediaAssetId: SECOND_ASSET, sortOrder: 1, sourceKey: null, blockedReason: null },
        ],
      })
      expect(transaction.assistantDeliveryMedia.createMany).toHaveBeenCalledWith({
        data: [
          { deliveryId: expect.any(String), mediaAssetId: FIRST_ASSET, sortOrder: 0 },
          { deliveryId: expect.any(String), mediaAssetId: SECOND_ASSET, sortOrder: 1 },
        ],
      })
      expect(result.warnings).toEqual([])
    })

    it('records blocked attachments instead of failing the notification', async () => {
      const transaction = mediaTransaction({ mediaPolicy: {} })
      const service = createService({} as PrismaService)

      const result = await service.publish(publishCommand, { transaction: transaction as never })

      expect(transaction.notificationMedia.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'n-media', mediaAssetId: FIRST_ASSET, sortOrder: 0, sourceKey: null, blockedReason: 'POLICY_DISABLED' },
          { notificationId: 'n-media', mediaAssetId: SECOND_ASSET, sortOrder: 1, sourceKey: null, blockedReason: 'POLICY_DISABLED' },
        ],
      })
      expect(transaction.assistantDeliveryMedia.createMany).not.toHaveBeenCalled()
      expect(result.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'MEDIA_ATTACHMENT_BLOCKED' }),
      ]))
    })

    it('blocks attachments when the policy does not allow sensitive content', async () => {
      const transaction = mediaTransaction({ allowSensitive: false })
      const service = createService({} as PrismaService)

      await service.publish(publishCommand, { transaction: transaction as never })

      expect(transaction.notificationMedia.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'n-media', mediaAssetId: FIRST_ASSET, sortOrder: 0, sourceKey: null, blockedReason: 'SENSITIVE_BLOCKED' },
          { notificationId: 'n-media', mediaAssetId: SECOND_ASSET, sortOrder: 1, sourceKey: null, blockedReason: 'SENSITIVE_BLOCKED' },
        ],
      })
      expect(transaction.assistantDeliveryMedia.createMany).not.toHaveBeenCalled()
    })

    it('never sends malformed asset ids to PostgreSQL', async () => {
      const transaction = mediaTransaction({ assets: [] })
      const service = createService({} as PrismaService)

      await service.publish({
        ...publishCommand,
        media: [{ assetId: 'not-a-uuid' }],
      }, { transaction: transaction as never })

      expect(transaction.mediaAsset.findMany).not.toHaveBeenCalled()
      expect(transaction.notificationMedia.createMany).toHaveBeenCalledWith({
        data: [{ notificationId: 'n-media', mediaAssetId: 'not-a-uuid', sortOrder: 0, sourceKey: null, blockedReason: 'ASSET_NOT_FOUND' }],
      })
    })

    it('filters attachments by declared and selected sources', async () => {
      const transaction = mediaTransaction({
        mediaPolicy: {
          enabled: true,
          maxCount: 3,
          kinds: ['IMAGE'],
          sources: ['advertising.qr'],
        },
      })
      const service = createService({} as PrismaService)

      await service.publish({
        ...publishCommand,
        eventType: 'ADVERTISING_RECHARGE_PAID',
        media: [
          { assetId: FIRST_ASSET, sourceKey: 'advertising.qr' },
          { assetId: SECOND_ASSET, sourceKey: 'advertising.proof' },
          { assetId: FIRST_ASSET, sourceKey: 'unknown.source' },
          { assetId: SECOND_ASSET },
        ],
      }, { transaction: transaction as never })

      expect(transaction.notificationMedia.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'n-media', mediaAssetId: FIRST_ASSET, sortOrder: 0, sourceKey: 'advertising.qr', blockedReason: null },
          { notificationId: 'n-media', mediaAssetId: SECOND_ASSET, sortOrder: 1, sourceKey: 'advertising.proof', blockedReason: 'SOURCE_NOT_SELECTED' },
          { notificationId: 'n-media', mediaAssetId: FIRST_ASSET, sortOrder: 2, sourceKey: 'unknown.source', blockedReason: 'SOURCE_NOT_DECLARED' },
          { notificationId: 'n-media', mediaAssetId: SECOND_ASSET, sortOrder: 3, sourceKey: null, blockedReason: 'SOURCE_NOT_SELECTED' },
        ],
      })
      expect(transaction.assistantDeliveryMedia.createMany).toHaveBeenCalledWith({
        data: [{ deliveryId: expect.any(String), mediaAssetId: FIRST_ASSET, sortOrder: 0 }],
      })
    })

    it('keeps unlabelled attachments working when the template does not select sources', async () => {
      const transaction = mediaTransaction()
      const service = createService({} as PrismaService)

      await service.publish({
        ...publishCommand,
        media: [{ assetId: FIRST_ASSET }],
      }, { transaction: transaction as never })

      expect(transaction.notificationMedia.createMany).toHaveBeenCalledWith({
        data: [{ notificationId: 'n-media', mediaAssetId: FIRST_ASSET, sortOrder: 0, sourceKey: null, blockedReason: null }],
      })
    })

    it('blocks attachments beyond the configured count and skips assets that are not ready', async () => {
      const transaction = mediaTransaction({
        mediaPolicy: { enabled: true, maxCount: 1, kinds: ['IMAGE'] },
        assets: [{ ...readyImage(FIRST_ASSET), status: 'UPLOADING', objectKey: null }],
      })
      const service = createService({} as PrismaService)

      await service.publish(publishCommand, { transaction: transaction as never })

      expect(transaction.notificationMedia.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'n-media', mediaAssetId: FIRST_ASSET, sortOrder: 0, sourceKey: null, blockedReason: 'ASSET_NOT_READY' },
          { notificationId: 'n-media', mediaAssetId: SECOND_ASSET, sortOrder: 1, sourceKey: null, blockedReason: 'ASSET_NOT_FOUND' },
        ],
      })
      expect(transaction.assistantDeliveryMedia.createMany).not.toHaveBeenCalled()
    })
  })
})
