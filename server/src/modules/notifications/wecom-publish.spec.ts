import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { SystemNotificationService } from './system-notification.service'
import type { SystemNotificationPublishCommand } from './notification.types'

const command: SystemNotificationPublishCommand = {
  eventType: 'PURCHASE_REVIEW_PENDING',
  source: { type: 'PURCHASE_ORDER', id: 'order-1' },
  target: { kind: 'USERS', userIds: ['11111111-1111-4111-8111-111111111111'] },
  templateKey: 'purchase.review.pending',
  variables: { orderNo: 'CG-1' },
  dedupeKey: 'purchase-review:order-1',
}

function wecomPolicy(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'WECOM',
    targetMode: 'COMMAND_TARGET',
    targetConfig: {},
    allowSensitive: true,
    ttlSeconds: 86_400,
    priority: 'NORMAL',
    enabled: true,
    ...overrides,
  }
}

function wecomTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    key: 'purchase.review.pending',
    channel: 'WECOM',
    titleTemplate: null,
    bodyTemplate: '采购单 {{orderNo}} 待审核',
    linkUrlTemplate: null,
    variables: [{ name: 'orderNo', required: true }],
    mediaPolicy: {},
    maxLength: 2_000,
    maxBytes: 2_048,
    enabled: true,
    version: 3,
    ...overrides,
  }
}

function createNumbering() {
  return {
    generateScopedInTransaction: jest.fn().mockResolvedValue({
      idempotentReplay: false,
      issuanceId: 'issuance-1',
      issuedAt: '2026-11-24T00:00:00.000Z',
      number: 'NTF/20261124-000001',
      ruleCode: 'NOTIFICATION_NO',
      ruleRevision: 1,
    }),
  } as unknown as NumberingGeneratorService
}

function baseTransaction(overrides: Record<string, unknown> = {}) {
  return {
    notification: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    notificationChannelPolicy: { findMany: jest.fn().mockResolvedValue([wecomPolicy()]) },
    notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
    notificationTemplate: { findUnique: jest.fn().mockResolvedValue(wecomTemplate()) },
    notificationUserMute: { findMany: jest.fn().mockResolvedValue([]) },
    notificationInboxItem: { count: jest.fn().mockResolvedValue(0) },
    assistantDelivery: { count: jest.fn().mockResolvedValue(0) },
    wecomDelivery: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111' }]),
    ...overrides,
  }
}

function service(): SystemNotificationService {
  return new SystemNotificationService({} as PrismaService, createNumbering())
}

describe('SystemNotificationService WECOM branch', () => {
  it('creates robot deliveries for a group policy', async () => {
    const transaction = baseTransaction({
      notificationChannelPolicy: {
        findMany: jest.fn().mockResolvedValue([wecomPolicy({
          targetMode: 'GROUP',
          targetConfig: { targetKeys: ['finance'], mention: { mode: 'ALL' } },
        })]),
      },
      wecomTarget: {
        findMany: jest.fn().mockResolvedValue([{ id: 'target-1' }]),
      },
    })

    const result = await service().publish(command, { transaction: transaction as never })

    expect(result.channels).toEqual([
      expect.objectContaining({ channel: 'WECOM', status: 'PENDING', recipientCount: 1 }),
    ])
    expect(transaction.wecomDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          appId: null,
          transport: 'ROBOT',
          targetId: 'target-1',
          recipientUserId: null,
          status: 'PENDING',
          mentionMode: 'ALL',
          renderedContent: '采购单 CG-1 待审核',
        }),
      ],
    })
    expect(transaction.notification.update).toHaveBeenCalledWith({
      where: { id: 'notification-1' },
      data: { status: 'PENDING' },
    })
  })

  it('creates app deliveries through the event route and verifies membership', async () => {
    const transaction = baseTransaction({
      wecomAppEventRoute: {
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          app: { id: 'app-1', enabled: true, status: 'ACTIVE' },
        }),
      },
      wecomBinding: {
        findMany: jest.fn().mockResolvedValue([{
          userId: '11111111-1111-4111-8111-111111111111',
        }]),
      },
      wecomAppMembership: {
        findMany: jest.fn().mockResolvedValue([{
          userId: '11111111-1111-4111-8111-111111111111',
        }]),
      },
    })

    const result = await service().publish(command, { transaction: transaction as never })

    expect(result.channels).toEqual([
      expect.objectContaining({ channel: 'WECOM', status: 'PENDING', recipientCount: 1 }),
    ])
    expect(transaction.wecomDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          appId: 'app-1',
          transport: 'APP',
          recipientUserId: '11111111-1111-4111-8111-111111111111',
          targetId: null,
          status: 'PENDING',
          templateVersion: 3,
        }),
      ],
    })
  })

  it('skips WECOM without failing other channels when the text exceeds max_bytes', async () => {
    const transaction = baseTransaction({
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue(wecomTemplate({
          bodyTemplate: '中'.repeat(700),
          maxBytes: 2_048,
        })),
      },
    })

    const result = await service().publish(command, { transaction: transaction as never })

    expect(result.channels).toEqual([
      expect.objectContaining({ channel: 'WECOM', status: 'SKIPPED', skipReason: 'TEXT_TOO_LONG' }),
    ])
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TEXT_TOO_LONG' }),
    ]))
    expect(transaction.wecomDelivery.createMany).not.toHaveBeenCalled()
  })

  it('skips app messages when the routed app is disabled', async () => {
    const transaction = baseTransaction({
      wecomAppEventRoute: {
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          app: { id: 'app-1', enabled: false, status: 'DISABLED' },
        }),
      },
    })

    const result = await service().publish(command, { transaction: transaction as never })

    expect(result.channels).toEqual([
      expect.objectContaining({ channel: 'WECOM', status: 'SKIPPED', skipReason: 'APP_DISABLED' }),
    ])
    expect(transaction.wecomDelivery.createMany).not.toHaveBeenCalled()
  })
})
