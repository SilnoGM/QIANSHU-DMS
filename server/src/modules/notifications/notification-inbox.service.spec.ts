/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言查询参数。 */
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { NotificationInboxService } from './notification-inbox.service'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    eventType: 'PURCHASE_REVIEW_PENDING',
    titleSnapshot: '采购单 CG-1 待审核',
    bodySnapshot: '客户：测试客户',
    linkUrlSnapshot: null,
    readAt: null,
    archivedAt: null,
    createdAt: new Date('2026-11-08T00:00:00.000Z'),
    ...overrides,
  }
}

describe('NotificationInboxService', () => {
  it('counts only unread, unarchived items', async () => {
    const count = jest.fn().mockResolvedValue(3)
    const service = new NotificationInboxService({
      notificationInboxItem: { count },
    } as unknown as PrismaService)

    await expect(service.unreadCount('user-1')).resolves.toEqual({ total: 3 })
    expect(count).toHaveBeenCalledWith({
      where: { userId: 'user-1', readAt: null, archivedAt: null },
    })
  })

  it('maps a missing or foreign item to 404', async () => {
    const service = new NotificationInboxService({
      notificationInboxItem: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService)

    await expect(service.get('user-1', '00000000-0000-4000-8000-000000000001'))
      .rejects.toMatchObject({ code: 'NOTIFICATION_INBOX_NOT_FOUND' })
  })

  it('archives an unread item and marks it read', async () => {
    const original = row()
    const archived = row({ readAt: new Date(), archivedAt: new Date() })
    const findFirst = jest.fn()
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(archived)
    const update = jest.fn().mockResolvedValue({})
    const service = new NotificationInboxService({
      notificationInboxItem: { findFirst, update },
    } as unknown as PrismaService)

    const result = await service.archive('user-1', original.id)

    expect(update).toHaveBeenCalledWith({
      where: { id: original.id },
      data: { archivedAt: expect.any(Date), readAt: expect.any(Date) },
    })
    expect(result.readAt).not.toBeNull()
    expect(result.archivedAt).not.toBeNull()
  })

  it('returns no historical items on the first incremental request', async () => {
    const count = jest.fn().mockResolvedValue(2)
    const findMany = jest.fn()
    const service = new NotificationInboxService({
      notificationInboxItem: { count, findMany },
    } as unknown as PrismaService)

    const result = await service.newItems('user-1', { limit: 20 })

    expect(result.items).toEqual([])
    expect(result.unreadTotal).toBe(2)
    expect(result.nextCursor.length).toBeGreaterThan(0)
    expect(result.hasMore).toBe(false)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('filters list results by the derived event domain', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(0)
    const service = new NotificationInboxService({
      notificationInboxItem: { findMany, count },
      $transaction: jest.fn(async (promises: Promise<unknown>[]) => Promise.all(promises)),
    } as unknown as PrismaService)

    await service.list('user-1', { status: 'all', domain: 'purchase', page: 1, pageSize: 20 })

    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'user-1',
        archivedAt: null,
        eventType: { in: expect.arrayContaining(['PURCHASE_REVIEW_PENDING']) },
      }),
    })
  })

  it.each([
    ['finance', ['FUND_WITHDRAWAL_REVIEW_PENDING', 'PACKAGING_COST_PAYMENT_PENDING', 'PURCHASE_PAYABLE_PENDING']],
    ['sales', []],
    ['system', []],
  ] as const)('maps the %s domain to its registered event types', async (domain, eventTypes) => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(0)
    const service = new NotificationInboxService({
      notificationInboxItem: { findMany, count },
      $transaction: jest.fn(async (promises: Promise<unknown>[]) => Promise.all(promises)),
    } as unknown as PrismaService)

    await service.list('user-1', { status: 'all', domain, page: 1, pageSize: 20 })

    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'user-1',
        eventType: { in: eventTypes },
      }),
    })
  })
})
