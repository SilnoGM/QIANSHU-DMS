import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../audit/audit.service'
import { NotificationAdminService } from './notification-admin.service'
import { FakeAssistantTransport } from './fake-assistant.transport'

const configuration: AssistantConfiguration = {
  baseUrl: 'https://api.geweapi.com',
  token: 'test-token',
  workerEnabled: true,
  pollMs: 5_000,
  batchSize: 20,
  requestTimeoutMs: 1_000,
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

describe('NotificationAdminService', () => {
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
})
