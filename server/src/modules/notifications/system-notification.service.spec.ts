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
})
