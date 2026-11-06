import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { AssistantAdminService } from './assistant-admin.service'
import { FakeAssistantTransport } from './fake-assistant.transport'
import type { AssistantAdminTransport } from './notification.types'

/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言 mock 调用参数。 */

const configuration: AssistantConfiguration = {
  baseUrl: 'https://api.geweapi.com',
  token: 'test-token',
  workerEnabled: true,
  pollMs: 5_000,
  batchSize: 20,
  requestTimeoutMs: 1_000,
}

const context = { actorUserId: 'user-1', requestId: 'req-1' }

function adminTransport(online = true) {
  return {
    checkOnline: jest.fn().mockResolvedValue(online),
    getOwnQrCode: jest.fn(),
  } as unknown as AssistantAdminTransport & { checkOnline: jest.Mock, getOwnQrCode: jest.Mock }
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1',
    name: '公司号-01',
    appId: 'wx-app',
    wxid: 'wxid_bot',
    nickname: '千树小助理',
    avatarUrl: null,
    status: 'ONLINE',
    enabled: true,
    lastOnlineAt: new Date('2026-11-06T00:00:00.000Z'),
    lastLoginAt: null,
    version: 1,
    ...overrides,
  }
}

function service(
  prisma: Record<string, unknown>,
  transport = new FakeAssistantTransport(),
  admin: AssistantAdminTransport = adminTransport(),
  audit: { record: jest.Mock } = { record: jest.fn() },
) {
  return new AssistantAdminService(
    prisma as unknown as PrismaService,
    { get: () => configuration } as unknown as ConfigService,
    audit,
    transport,
    admin,
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

  it('sends the channel self-test to the company account filehelper after an online check', async () => {
    const transport = new FakeAssistantTransport()
    const admin = adminTransport(true)
    const prisma = {
      assistantAccount: { findFirst: jest.fn().mockResolvedValue({ appId: 'wx-app' }) },
    }
    const result = await service(prisma, transport, admin).testChannel()

    expect(result).toEqual({ accepted: true })
    expect(admin.checkOnline).toHaveBeenCalledWith('wx-app')
    expect(transport.calls).toEqual([expect.objectContaining({ appId: 'wx-app', toWxid: 'filehelper' })])
  })

  it('imports an online GeWe node without creating a pending appId', async () => {
    const created = accountRow()
    const transaction = {
      assistantAccount: { create: jest.fn().mockResolvedValue(created) },
    }
    const prisma = {
      assistantAccount: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    }
    const admin = adminTransport(true)
    const audit = { record: jest.fn() }

    const result = await service(prisma, new FakeAssistantTransport(), admin, audit).createAccount(context, {
      name: ' 公司号-01 ',
      appId: ' wx-app ',
      wxid: ' wxid_bot ',
      nickname: ' 千树小助理 ',
    })

    expect(admin.checkOnline).toHaveBeenCalledWith('wx-app')
    expect(transaction.assistantAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '公司号-01',
        appId: 'wx-app',
        wxid: 'wxid_bot',
        nickname: '千树小助理',
        status: 'ONLINE',
        enabled: true,
      }),
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'ASSISTANT_ACCOUNT_LOGGED_IN',
        metadata: expect.objectContaining({ mode: 'CONSOLE_IMPORT' }),
      }),
    )
    expect(result).toMatchObject({ appId: 'wx-app', status: 'ONLINE', enabled: true })
  })

  it('rejects importing a node that GeWe reports offline', async () => {
    const prisma = {
      assistantAccount: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    }
    const admin = adminTransport(false)

    await expect(service(prisma, new FakeAssistantTransport(), admin).createAccount(context, {
      name: '公司号-01',
      appId: 'wx-offline',
      wxid: 'wxid_bot',
    })).rejects.toMatchObject({ code: 'ASSISTANT_ACCOUNT_OFFLINE' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects importing an appId that is already present', async () => {
    const prisma = {
      assistantAccount: { findUnique: jest.fn().mockResolvedValue({ id: 'other-account' }) },
    }
    const admin = adminTransport(true)

    await expect(service(prisma, new FakeAssistantTransport(), admin).createAccount(context, {
      name: '公司号-01',
      appId: 'wx-app',
      wxid: 'wxid_bot',
    })).rejects.toMatchObject({ code: 'ASSISTANT_ACCOUNT_APP_ID_EXISTS' })
    expect(admin.checkOnline).not.toHaveBeenCalled()
  })

  it('re-points an account to another online node with an optimistic version check', async () => {
    const transaction = {
      assistantAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(accountRow({ appId: 'wx-new', version: 2 })),
      },
    }
    const prisma = {
      assistantAccount: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(accountRow())
          .mockResolvedValueOnce(null),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    }
    const admin = adminTransport(true)
    const audit = { record: jest.fn() }

    const result = await service(prisma, new FakeAssistantTransport(), admin, audit).updateAccount(context, 'account-1', {
      appId: ' wx-new ',
      expectedVersion: 1,
    })

    expect(admin.checkOnline).toHaveBeenCalledWith('wx-new')
    expect(transaction.assistantAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'account-1', version: 1 },
      data: expect.objectContaining({ appId: 'wx-new', status: 'ONLINE', enabled: true, version: { increment: 1 } }),
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'ASSISTANT_ACCOUNT_LOGGED_IN',
        metadata: expect.objectContaining({ mode: 'CONSOLE_IMPORT_UPDATE', previousAppId: 'wx-app' }),
      }),
    )
    expect(result).toMatchObject({ appId: 'wx-new', version: 2 })
  })

  it('refreshes the local status from checkOnline without touching the GeWe lifecycle', async () => {
    const prisma = {
      assistantAccount: {
        findUnique: jest.fn().mockResolvedValue(accountRow()),
        update: jest.fn().mockResolvedValue(accountRow({ status: 'OFFLINE', version: 2 })),
      },
    }
    const admin = adminTransport(false)

    const result = await service(prisma, new FakeAssistantTransport(), admin).checkAccountStatus('account-1')

    expect(admin.checkOnline).toHaveBeenCalledWith('wx-app')
    expect(prisma.assistantAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: expect.objectContaining({
        status: 'OFFLINE',
        lastErrorCode: 'ASSISTANT_ACCOUNT_OFFLINE',
      }),
    })
    expect(result.status).toBe('OFFLINE')
  })

  it('refuses to issue a personal QR before the node is imported', async () => {
    const prisma = {
      assistantAccount: { findUnique: jest.fn().mockResolvedValue(accountRow({ appId: 'pending-legacy' })) },
    }
    const admin = adminTransport(true)

    await expect(service(prisma, new FakeAssistantTransport(), admin).accountQrCode('account-1'))
      .rejects.toMatchObject({ code: 'ASSISTANT_ACCOUNT_NOT_IMPORTED' })
    expect(admin.getOwnQrCode).not.toHaveBeenCalled()
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
