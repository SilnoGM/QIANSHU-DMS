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
})
