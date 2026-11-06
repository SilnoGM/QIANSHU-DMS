import type { PrismaService } from '../../infrastructure/database/prisma.service'
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
    messageKind: 'TEXT',
    bodyTemplate: '采购单 {{orderNo}} 待审核',
    linkUrlTemplate: null,
    variables: [{ name: 'orderNo', required: true }],
    maxLength: 2_000,
    enabled: true,
    version: 1,
    ...overrides,
  }
}

describe('SystemNotificationService.publish', () => {
  it('returns the existing notification for a duplicate dedupe key', async () => {
    const transaction = {
      notification: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }) },
    }
    const service = new SystemNotificationService({} as PrismaService)

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
    const service = new SystemNotificationService({} as PrismaService)

    const result = await service.publish(command, { transaction: transaction as never })

    expect(result.notificationId).toBe('n1')
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EVENT_NOT_CONFIGURED' }),
    ]))
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
    const service = new SystemNotificationService({} as PrismaService)

    const result = await service.publish(command, { transaction: transaction as never })

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TEMPLATE_NOT_FOUND' }),
    ]))
    const updateCalls = transaction.notification.update.mock.calls as unknown as Array<
      Array<{ data?: { status?: string } }>
    >
    expect(updateCalls[0]?.[0]?.data?.status).toBe('FAILED')
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
    }
    const service = new SystemNotificationService({} as PrismaService)

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
        renderedContent: '采购单 CG-1 待审核',
      })],
    })
    expect(transaction.notification.update).toHaveBeenCalledWith({
      where: { id: 'n3' },
      data: { status: 'PENDING' },
    })
  })
})
