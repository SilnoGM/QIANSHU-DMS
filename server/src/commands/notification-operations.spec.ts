/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Jest mock.calls 的类型是 any。 */
import type { PrismaService } from '../infrastructure/database/prisma.service'
import { cleanupNotificationData } from './notification-operations'

describe('cleanupNotificationData', () => {
  it('deletes expired inbox items, deliveries and empty notifications in bounded order', async () => {
    const inboxFindMany = jest.fn()
      .mockResolvedValueOnce([{ id: 'inbox-old' }])
      .mockResolvedValueOnce([{ id: 'inbox-archived-old' }])
    const inboxDeleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const deliveryFindMany = jest.fn().mockResolvedValue([{ id: 'delivery-old' }])
    const deliveryDeleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const notificationFindMany = jest.fn().mockResolvedValue([{ id: 'notification-old' }])
    const notificationDeleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      notificationSettings: {
        findUnique: jest.fn().mockResolvedValue({
          notificationRetentionDays: 180,
          deliveryRetentionDays: 90,
        }),
      },
      notificationInboxItem: {
        findMany: inboxFindMany,
        deleteMany: inboxDeleteMany,
      },
      assistantDelivery: {
        findMany: deliveryFindMany,
        deleteMany: deliveryDeleteMany,
      },
      notification: {
        findMany: notificationFindMany,
        deleteMany: notificationDeleteMany,
      },
    } as unknown as PrismaService

    const result = await cleanupNotificationData(prisma, {
      now: () => new Date('2026-11-08T00:00:00.000Z'),
      batchSize: 500,
    })

    expect(result).toMatchObject({
      status: 'completed',
      timeBudgetReached: false,
      counts: {
        inboxUnarchivedDeleted: 1,
        inboxArchivedDeleted: 1,
        deliveriesDeleted: 1,
        notificationsDeleted: 1,
      },
    })
    expect(inboxFindMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        archivedAt: null,
        createdAt: { lte: new Date('2026-05-12T00:00:00.000Z') },
      }),
      take: 500,
    }))
    expect(inboxFindMany.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        archivedAt: { not: null, lte: new Date('2025-11-08T00:00:00.000Z') },
      }),
      take: 500,
    }))
    expect(notificationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        createdAt: { lte: new Date('2026-05-12T00:00:00.000Z') },
        inboxItems: { none: {} },
        deliveries: { none: {} },
      }),
      take: 500,
    }))
  })
})
