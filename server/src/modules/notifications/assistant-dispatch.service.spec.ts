import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { AssistantDispatchService } from './assistant-dispatch.service'
import { FakeAssistantTransport } from './fake-assistant.transport'

const configuration: AssistantConfiguration = {
  baseUrl: 'https://api.geweapi.com',
  token: 'test-token',
  workerEnabled: true,
  pollMs: 5_000,
  batchSize: 20,
  requestTimeoutMs: 1_000,
}

function service(prisma: Record<string, unknown>): AssistantDispatchService {
  return new AssistantDispatchService(
    prisma as unknown as PrismaService,
    { get: () => configuration } as unknown as ConfigService,
    new FakeAssistantTransport(),
  )
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
        .mockResolvedValueOnce([]),
      notificationChannelSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
      assistantDelivery: { findMany: jest.fn().mockResolvedValue([]) },
    }
    await service(prisma).dispatchOnce(20)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
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
})
