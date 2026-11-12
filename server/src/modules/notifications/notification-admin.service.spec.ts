/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言查询参数。 */
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../audit/audit.service'
import { NotificationAdminService } from './notification-admin.service'
import { NOTIFICATION_DOMAIN_LABELS, NOTIFICATION_EVENT_DOMAIN, NOTIFICATION_EVENT_TEMPLATE_DOMAIN } from './notification.types'
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

function service(prisma: Record<string, unknown>) {
  return new NotificationAdminService(
    prisma as unknown as PrismaService,
    { get: () => configuration } as unknown as ConfigService,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- 测试替身只需要 record。
    { record: jest.fn() } as unknown as AuditService,
    new FakeAssistantTransport(),
  )
}

function recordRow(overrides: Record<string, unknown> = {}) {
  const publishedAt = new Date('2026-11-09T02:00:00.000Z')
  return {
    id: '00000000-0000-4000-8000-000000000001',
    notificationNo: 'NTF/20261109-000001',
    eventType: 'PURCHASE_REVIEW_PENDING',
    sourceType: 'PURCHASE_ORDER',
    sourceId: 'CG-20261109-0001',
    dedupeKey: 'dedupe-1',
    priority: 'NORMAL',
    status: 'PENDING',
    templateKey: 'purchase.review.pending',
    requestedChannels: ['IN_APP', 'ASSISTANT'],
    variables: {},
    expiresAt: new Date('2026-11-10T02:00:00.000Z'),
    publishedAt,
    completedAt: null,
    requestedByUserId: 'user-1',
    createdAt: publishedAt,
    updatedAt: publishedAt,
    requestedBy: { displayName: '张三' },
    ...overrides,
  }
}

describe('NotificationAdminService', () => {
  it('lists registered events with labels, variables and default template keys', () => {
    const result = service({}).listEvents()

    const purchase = result.find(event => event.eventType === 'PURCHASE_REVIEW_PENDING')
    expect(purchase).toMatchObject({
      label: '采购审核',
      domain: 'PURCHASE',
      implemented: true,
      variablesKnown: true,
      defaultTemplateKey: 'purchase.review.pending',
    })
    expect(purchase?.variables).toEqual(expect.arrayContaining(['orderNo', 'customerName']))
    const orderNo = purchase?.variableDefinitions.find(variable => variable.name === 'orderNo')
    expect(orderNo).toMatchObject({
      label: '采购单号',
      sensitive: false,
      maxLength: 64,
      required: true,
    })
    expect(orderNo?.description).toContain('采购单编号')
    expect(purchase?.variableDefinitions.find(variable => variable.name === 'totalAmount')).toMatchObject({
      sensitive: true,
      maxLength: 32,
    })

    const withdrawal = result.find(event => event.eventType === 'FUND_WITHDRAWAL_REVIEW_PENDING')
    expect(withdrawal).toMatchObject({
      label: '提现审核',
      domain: 'FINANCE',
      implemented: true,
      variablesKnown: true,
      defaultTemplateKey: 'fund.withdrawal.pending',
    })
    expect(withdrawal?.variables).toEqual(['withdrawalNo', 'applicantName', 'amount'])
    expect(withdrawal?.variableDefinitions.find(variable => variable.name === 'amount')).toMatchObject({
      sensitive: true,
    })
    expect(result).toHaveLength(39)
    for (const event of result) {
      expect(event.variablesKnown).toBe(true)
      expect(event.defaultTemplateKey).not.toBeNull()
      expect(event.variableDefinitions).toHaveLength(event.variables.length)
      expect(event.implemented).toBe(true)
    }
  })

  it('uses the same eight-domain model for events and inbox filtering', () => {
    expect(Object.keys(NOTIFICATION_DOMAIN_LABELS)).toEqual([
      'sales',
      'purchase',
      'shipment',
      'finance',
      'invoice',
      'reconciliation',
      'operations',
      'system',
    ])
    expect(NOTIFICATION_EVENT_DOMAIN.PURCHASE_PAYABLE_PENDING).toBe('finance')
    expect(NOTIFICATION_EVENT_DOMAIN.PROXY_NODE_EXPIRING).toBe('operations')
    for (const [eventType, domain] of Object.entries(NOTIFICATION_EVENT_DOMAIN)) {
      expect(NOTIFICATION_EVENT_TEMPLATE_DOMAIN[eventType as keyof typeof NOTIFICATION_EVENT_TEMPLATE_DOMAIN])
        .toBe(domain.toUpperCase())
    }
  })

  it('renders a template preview with sample variables', async () => {
    const prisma = {
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'template-1',
          bodyTemplate: '采购单 {{orderNo}} 待审核',
          linkUrlTemplate: null,
          variables: [{ name: 'orderNo', required: true }],
          maxLength: 200,
        }),
      },
    }
    const result = await service(prisma).previewTemplate('template-1', {
      variables: { orderNo: 'CG-1' },
    })

    expect(result).toEqual({
      content: '采购单 CG-1 待审核',
      linkUrl: null,
      truncated: false,
      warnings: [],
    })
  })

  it('rejects a template that uses single-brace placeholders', async () => {
    await expect(service({}).createTemplate(
      { actorUserId: 'user-1', requestId: 'req-1' },
      {
        key: 'test.template',
        channel: 'ASSISTANT',
        name: '测试模板',
        bodyTemplate: '采购单 {orderNo} 待审核',
        variables: [{ name: 'orderNo', required: true }],
      },
    )).rejects.toMatchObject({ code: 'NOTIFICATION_TEMPLATE_SINGLE_BRACE' })
  })

  it('rejects an unregistered event type', async () => {
    await expect(service({}).upsertPolicy(
      { actorUserId: 'user-1', requestId: 'req-1' },
      'UNKNOWN_EVENT',
      'ASSISTANT',
      {
        targetMode: 'COMMAND_TARGET',
        targetConfig: {},
        priority: 'NORMAL',
        ttlSeconds: 86_400,
        allowSensitive: false,
        enabled: true,
        expectedVersion: 0,
      },
    )).rejects.toMatchObject({ code: 'NOTIFICATION_EVENT_TYPE_INVALID' })
  })

  it('rejects a group target on the in-app channel', async () => {
    await expect(service({}).upsertPolicy(
      { actorUserId: 'user-1', requestId: 'req-1' },
      'PURCHASE_REVIEW_PENDING',
      'IN_APP',
      {
        targetMode: 'GROUP',
        targetConfig: { targetKeys: ['finance'] },
        priority: 'NORMAL',
        allowSensitive: false,
        enabled: true,
        expectedVersion: 0,
      },
    )).rejects.toMatchObject({ code: 'NOTIFICATION_POLICY_TARGET_INVALID' })
  })

  it('rejects a policy template that does not exist on the channel', async () => {
    await expect(service({
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
    }).upsertPolicy(
      { actorUserId: 'user-1', requestId: 'req-1' },
      'PURCHASE_REVIEW_PENDING',
      'ASSISTANT',
      {
        targetMode: 'COMMAND_TARGET',
        targetConfig: {},
        templateKey: 'purchase.review.pending.short',
        priority: 'NORMAL',
        ttlSeconds: 86_400,
        allowSensitive: false,
        enabled: true,
        expectedVersion: 0,
      },
    )).rejects.toMatchObject({ code: 'NOTIFICATION_POLICY_TEMPLATE_NOT_FOUND' })
  })

  it('rejects a policy template whose placeholders are not provided by the event', async () => {
    await expect(service({
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'template-2',
          bodyTemplate: '采购单 {{orderNo}} 货件 {{partNumbers}}',
          titleTemplate: null,
          linkUrlTemplate: null,
          variables: [{ name: 'orderNo' }, { name: 'partNumbers' }],
        }),
      },
    }).upsertPolicy(
      { actorUserId: 'user-1', requestId: 'req-1' },
      'PURCHASE_REVIEW_PENDING',
      'ASSISTANT',
      {
        targetMode: 'COMMAND_TARGET',
        targetConfig: {},
        templateKey: 'purchase.review.pending.short',
        priority: 'NORMAL',
        ttlSeconds: 86_400,
        allowSensitive: false,
        enabled: true,
        expectedVersion: 0,
      },
    )).rejects.toMatchObject({ code: 'NOTIFICATION_POLICY_TEMPLATE_VARIABLES_INVALID' })
  })

  it('rejects a template domain that conflicts with the other channel', async () => {
    const createPrisma = {
      notificationTemplate: { findFirst: jest.fn().mockResolvedValue({ domain: 'FINANCE' }) },
    }
    await expect(service(createPrisma).createTemplate(
      { actorUserId: 'user-1', requestId: 'req-1' },
      {
        key: 'purchase.review.pending',
        channel: 'ASSISTANT',
        name: '采购审核提醒',
        domain: 'PURCHASE',
        bodyTemplate: '采购单待审核',
        variables: [],
      },
    )).rejects.toMatchObject({ code: 'NOTIFICATION_TEMPLATE_DOMAIN_CONFLICT' })

    const updatePrisma = {
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'template-1',
          key: 'purchase.review.pending',
          channel: 'ASSISTANT',
          version: 1,
          titleTemplate: null,
          bodyTemplate: '采购单待审核',
          linkUrlTemplate: null,
          variables: [],
        }),
        findFirst: jest.fn().mockResolvedValue({ domain: 'FINANCE' }),
      },
    }
    await expect(service(updatePrisma).updateTemplate(
      { actorUserId: 'user-1', requestId: 'req-1' },
      'template-1',
      { domain: 'PURCHASE', expectedVersion: 1 },
    )).rejects.toMatchObject({ code: 'NOTIFICATION_TEMPLATE_DOMAIN_CONFLICT' })
  })

  it('returns the updater name from template and policy toggle responses', async () => {
    const updatedAt = new Date('2026-11-09T08:00:00.000Z')
    const template = {
      id: 'template-1',
      key: 'invoice.review.pending',
      channel: 'ASSISTANT',
      name: '开票审核提醒',
      titleTemplate: null,
      bodyTemplate: '开票申请待审核',
      linkUrlTemplate: null,
      variables: [],
      maxLength: 2000,
      enabled: true,
      version: 1,
      updatedAt,
      updatedBy: { displayName: '超级管理员' },
    }
    const templateTransaction = {
      notificationTemplate: {
        update: jest.fn().mockResolvedValue({ ...template, enabled: false }),
      },
    }
    const templatePrisma = {
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(template) },
      $transaction: jest.fn(async (callback: (tx: typeof templateTransaction) => Promise<unknown>) => callback(templateTransaction)),
    }

    const templateResult = await service(templatePrisma).updateTemplate(
      { actorUserId: 'user-1', requestId: 'req-1' },
      'template-1',
      { enabled: false, expectedVersion: 1 },
    )

    expect(templateTransaction.notificationTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      include: { updatedBy: { select: { displayName: true } } },
    }))
    expect(templateResult.updatedByName).toBe('超级管理员')
    expect(templateResult).not.toHaveProperty('messageKind')

    const policy = {
      id: 'policy-1',
      eventType: 'PURCHASE_REVIEW_PENDING',
      channel: 'ASSISTANT',
      targetMode: 'COMMAND_TARGET',
      targetConfig: {},
      templateKey: 'purchase.review.pending',
      priority: 'NORMAL',
      ttlSeconds: 86_400,
      quietHours: null,
      allowSensitive: false,
      enabled: true,
      version: 1,
      updatedAt,
      updatedBy: { displayName: '超级管理员' },
    }
    const policyTransaction = {
      notificationChannelPolicy: {
        upsert: jest.fn().mockResolvedValue({ ...policy, enabled: false }),
      },
    }
    const policyPrisma = {
      notificationChannelPolicy: { findUnique: jest.fn().mockResolvedValue(policy) },
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'template-1',
          bodyTemplate: '采购单 {{orderNo}} 待审核',
          titleTemplate: null,
          linkUrlTemplate: null,
          variables: [{ name: 'orderNo' }],
        }),
      },
      $transaction: jest.fn(async (callback: (tx: typeof policyTransaction) => Promise<unknown>) => callback(policyTransaction)),
    }

    const policyResult = await service(policyPrisma).upsertPolicy(
      { actorUserId: 'user-1', requestId: 'req-1' },
      'PURCHASE_REVIEW_PENDING',
      'ASSISTANT',
      {
        targetMode: 'COMMAND_TARGET',
        targetConfig: {},
        templateKey: 'purchase.review.pending',
        priority: 'NORMAL',
        ttlSeconds: 86_400,
        allowSensitive: false,
        enabled: false,
        expectedVersion: 1,
      },
    )

    expect(policyTransaction.notificationChannelPolicy.upsert).toHaveBeenCalledWith(expect.objectContaining({
      include: { updatedBy: { select: { displayName: true } } },
    }))
    expect(policyResult.updatedByName).toBe('超级管理员')
  })

  it('filters notification records and summarizes in-app and assistant channels', async () => {
    const row = recordRow()
    const findMany = jest.fn().mockResolvedValue([row])
    const count = jest.fn().mockResolvedValue(1)
    const deliveryGroupBy = jest.fn().mockResolvedValue([
      { notificationId: row.id, status: 'FAILED', _count: { _all: 1 } },
    ])
    const inboxGroupBy = jest.fn()
      .mockResolvedValueOnce([{ notificationId: row.id, _count: { _all: 3 } }])
      .mockResolvedValueOnce([{ notificationId: row.id, _count: { _all: 2 } }])
    const prisma = {
      notification: { count, findMany },
      assistantDelivery: { groupBy: deliveryGroupBy },
      notificationInboxItem: { groupBy: inboxGroupBy },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    }

    const result = await service(prisma).listRecords({
      eventType: 'PURCHASE_REVIEW_PENDING',
      domain: 'PURCHASE',
      channel: 'IN_APP',
      status: 'PENDING',
      priority: 'HIGH',
      publishedFrom: '2026-11-01T00:00:00.000Z',
      publishedTo: '2026-11-09T23:59:59.999Z',
      keyword: '采购',
      page: 1,
      pageSize: 20,
    })

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { requestedBy: { select: { displayName: true } } },
      where: expect.objectContaining({
        eventType: 'PURCHASE_REVIEW_PENDING',
        status: 'PENDING',
        priority: 'HIGH',
        requestedChannels: { array_contains: ['IN_APP'] },
        publishedAt: {
          gte: new Date('2026-11-01T00:00:00.000Z'),
          lte: new Date('2026-11-09T23:59:59.999Z'),
        },
        AND: expect.arrayContaining([
          { eventType: { in: expect.arrayContaining(['PURCHASE_REVIEW_PENDING', 'PURCHASE_REVIEW_APPROVED']) } },
          { OR: expect.any(Array) },
        ]),
      }),
    }))
    expect(result.items[0]).toMatchObject({
      notificationNo: 'NTF/20261109-000001',
      eventLabel: '采购审核',
      domain: 'PURCHASE',
      requestedByName: '张三',
      channels: ['IN_APP', 'ASSISTANT'],
      inAppItemCount: 3,
      inAppUnreadCount: 2,
      deliveryCounts: { FAILED: 1 },
    })
  })

  it('rejects an inverted published time range before querying', async () => {
    await expect(service({}).listRecords({
      publishedFrom: '2026-11-09T00:00:00.000Z',
      publishedTo: '2026-11-01T00:00:00.000Z',
      page: 1,
      pageSize: 20,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('lists record event options without exposing template variables', () => {
    const options = service({}).listRecordOptions()

    expect(options.events).toHaveLength(39)
    expect(options.events.find(event => event.eventType === 'PURCHASE_REVIEW_PENDING')).toEqual({
      eventType: 'PURCHASE_REVIEW_PENDING',
      label: '采购审核',
      domain: 'PURCHASE',
    })
  })

  it('returns record detail with requested-by, channel summaries and deliveries', async () => {
    const row = recordRow({ status: 'PARTIAL' })
    const delivery = {
      id: '00000000-0000-4000-8000-000000000101',
      recipientUser: { displayName: '李华' },
      target: null,
      status: 'ACCEPTED',
      attemptCount: 1,
      templateKey: 'purchase.review.pending',
      failureCode: null,
      failureMessage: null,
      acceptedAt: new Date('2026-11-09T02:00:03.000Z'),
    }
    const prisma = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(row),
      },
      assistantDelivery: {
        findMany: jest.fn().mockResolvedValue([delivery]),
      },
      notificationInboxItem: {
        groupBy: jest.fn()
          .mockResolvedValueOnce([{ notificationId: row.id, _count: { _all: 3 } }])
          .mockResolvedValueOnce([{ notificationId: row.id, _count: { _all: 1 } }]),
      },
    }

    const result = await service(prisma).getRecord(row.id)

    expect(prisma.notification.findUnique).toHaveBeenCalledWith({
      where: { id: row.id },
      include: { requestedBy: { select: { displayName: true } } },
    })
    expect(result).toMatchObject({
      notificationNo: 'NTF/20261109-000001',
      eventLabel: '采购审核',
      domain: 'PURCHASE',
      requestedByName: '张三',
      channels: ['IN_APP', 'ASSISTANT'],
      inAppItemCount: 3,
      inAppUnreadCount: 1,
      deliveryCounts: { ACCEPTED: 1 },
      deliveries: [expect.objectContaining({
        recipientName: '李华',
        status: 'ACCEPTED',
        acceptedAt: '2026-11-09T02:00:03.000Z',
      })],
    })
  })

  it('cancels pending deliveries and recomputes the notification status', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 })
    const update = jest.fn().mockResolvedValue({})
    const transaction = {
      assistantDelivery: {
        updateMany,
        groupBy: jest.fn().mockResolvedValue([
          { status: 'CANCELLED', _count: { _all: 2 } },
        ]),
      },
      notification: { update },
    }
    const prisma = {
      notification: {
        findUnique: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000001',
          status: 'PENDING',
        }),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    }

    const result = await service(prisma).cancelRecord(
      { actorUserId: 'user-1', requestId: 'req-1' },
      '00000000-0000-4000-8000-000000000001',
    )

    expect(updateMany).toHaveBeenCalledWith({
      where: { notificationId: '00000000-0000-4000-8000-000000000001', status: 'PENDING' },
      data: { status: 'CANCELLED', failureCode: 'CANCELLED', failureMessage: '管理员取消' },
    })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: '00000000-0000-4000-8000-000000000001' },
      data: { status: 'CANCELLED', completedAt: expect.any(Date) },
    }))
    expect(result).toEqual({ cancelled: 2, status: 'CANCELLED' })
  })
})
