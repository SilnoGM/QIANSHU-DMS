import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AssistantAdminService } from './assistant-admin.service'
import { FakeAssistantTransport } from './fake-assistant.transport'
import type { AssistantAdminTransport } from './notification.types'

const configuration: AssistantConfiguration = {
  baseUrl: 'https://api.geweapi.com',
  token: 'test-token',
  workerEnabled: true,
  pollMs: 5_000,
  batchSize: 20,
  requestTimeoutMs: 1_000,
}

const context = { actorUserId: 'user-1', requestId: 'req-1' }

function service(prisma: Record<string, unknown>, transport = new FakeAssistantTransport()) {
  return new AssistantAdminService(
    prisma as unknown as PrismaService,
    { get: () => configuration } as unknown as ConfigService,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- 测试替身只需要 record。
    { record: jest.fn() } as unknown as AuditService,
    transport,
    {} as unknown as AssistantAdminTransport,
  )
}

describe('AssistantAdminService', () => {
  it('reads channel state and token configuration', async () => {
    const prisma = {
      notificationChannelSettings: {
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          defaultQuietHours: { start: '20:00', end: '08:00', timezone: 'Asia/Shanghai' },
          version: 3,
        }),
      },
    }
    const result = await service(prisma).getChannel()

    expect(result).toEqual({
      enabled: true,
      tokenConfigured: true,
      defaultQuietHours: { start: '20:00', end: '08:00', timezone: 'Asia/Shanghai' },
      version: 3,
    })
  })

  it('rejects channel updates when the version has changed', async () => {
    const transaction = {
      notificationChannelSettings: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    }
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    }
    await expect(service(prisma).updateChannel(context, {
      enabled: true,
      expectedVersion: 2,
    })).rejects.toMatchObject({ code: 'ASSISTANT_CHANNEL_STATE_CHANGED' })
  })

  it('sends the channel self-test to the company account filehelper', async () => {
    const transport = new FakeAssistantTransport()
    const prisma = {
      assistantAccount: { findFirst: jest.fn().mockResolvedValue({ appId: 'wx-app' }) },
    }
    const result = await service(prisma, transport).testChannel()

    expect(result).toEqual({ accepted: true })
    expect(transport.calls).toEqual([expect.objectContaining({ appId: 'wx-app', toWxid: 'filehelper' })])
  })

  it('rejects a binding when the employee is missing or disabled', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      assistantAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'account-1' }) },
    }
    await expect(service(prisma).createBinding(context, {
      userId: '00000000-0000-4000-8000-000000000001',
      wxid: 'wxid-user',
    })).rejects.toMatchObject({ code: 'ASSISTANT_BINDING_USER_INVALID' })
  })
})
