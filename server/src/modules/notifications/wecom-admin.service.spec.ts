/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言 mock 调用参数。 */
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AuditService } from '../audit/audit.service'
import { WecomAdminService } from './wecom-admin.service'
import type { WecomSecretService } from './wecom-secret.service'
import type { WecomTokenService } from './wecom-token.service'
import type { WecomAppTransport, WecomRobotTransport } from './wecom.types'

const now = new Date('2026-11-24T10:00:00.000Z')

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    wecomApp: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({
        id: 'app-1',
        key: 'default',
        name: '千树 DMS',
        corpId: 'ww-1',
        agentId: 1000001,
        isDefault: true,
        enabled: false,
        status: 'PENDING',
        secretEncrypted: 'enc:secret',
        lastCheckedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        version: 1,
        updatedAt: now,
        _count: { eventRoutes: 0, memberships: 0 },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
    },
    wecomBinding: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    wecomAppMembership: {
      createMany: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
    },
    wecomAppEventRoute: {
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    wecomTarget: {
      create: jest.fn().mockResolvedValue({
        id: 'target-1',
        key: 'finance',
        name: '财务群',
        purpose: null,
        enabled: true,
        internalOnly: true,
        lastTestedAt: null,
        version: 1,
        updatedAt: now,
      }),
      update: jest.fn(),
    },
    notificationChannelSettings: {
      update: jest.fn().mockResolvedValue({
        channel: 'WECOM',
        enabled: true,
        defaultQuietHours: { start: '20:00', end: '08:00', timezone: 'Asia/Shanghai' },
        version: 2,
        updatedAt: now,
      }),
    },
    ...overrides,
  }
}

function service(
  prisma: Record<string, unknown>,
  options: {
    readonly appTransport?: WecomAppTransport
    readonly robotTransport?: WecomRobotTransport
  } = {},
): WecomAdminService {
  const secret = {
    available: true,
    encrypt: jest.fn((value: string) => `enc:${value}`),
    decrypt: jest.fn(() => 'plain-secret'),
  } as unknown as WecomSecretService
  const token = {
    getAccessToken: jest.fn().mockResolvedValue({ ok: true, accessToken: 'token-1' }),
    invalidate: jest.fn(),
  } as unknown as WecomTokenService
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService
  return new WecomAdminService(
    prisma as unknown as PrismaService,
    audit,
    secret,
    token,
    options.appTransport ?? { sendText: jest.fn(), uploadImage: jest.fn(), sendImage: jest.fn() },
    options.robotTransport ?? { sendText: jest.fn(), sendImage: jest.fn() },
  )
}

describe('WecomAdminService', () => {
  it('creates the default app with an encrypted secret', async () => {
    const tx = transaction()
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => Promise.resolve(callback(tx))),
    }

    const result = await service(prisma).createApp(
      { actorUserId: 'actor-1', requestId: 'request-1' },
      {
        key: 'default',
        name: '千树 DMS',
        corpId: 'ww-1',
        agentId: 1000001,
        secret: 'super-secret',
      },
    )

    expect(tx.wecomApp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'default',
        isDefault: true,
        enabled: false,
        status: 'PENDING',
        secretEncrypted: 'enc:super-secret',
      }),
      include: { _count: { select: { eventRoutes: true, memberships: true } } },
    })
    expect(result).toMatchObject({ key: 'default', isDefault: true, hasSecret: true })
  })

  it('rejects an event already assigned to another app', async () => {
    const prisma = {
      wecomApp: { findUnique: jest.fn().mockResolvedValue({ id: 'app-1', key: 'default' }) },
      wecomAppEventRoute: {
        findMany: jest.fn().mockResolvedValue([
          { eventType: 'PURCHASE_REVIEW_PENDING', app: { name: '千帆审批' } },
        ]),
      },
    }

    await expect(service(prisma).setAppEvents(
      { actorUserId: 'actor-1', requestId: 'request-1' },
      'app-1',
      { eventTypes: ['PURCHASE_REVIEW_PENDING'] },
    )).rejects.toThrow('事件已被其他应用占用')
  })

  it('sends a default app test message and verifies the binding', async () => {
    const tx = transaction({
      wecomBinding: { update: jest.fn().mockResolvedValue({}) },
    })
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => Promise.resolve(callback(tx))),
      wecomBinding: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'binding-1',
          userId: 'user-1',
          wecomUserId: 'zhangsan',
          status: 'ACTIVE',
        }),
      },
      wecomApp: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'app-1',
          key: 'default',
          corpId: 'ww-1',
          agentId: 1000001,
          secretEncrypted: 'enc:secret',
        }),
      },
    }
    const appTransport = { sendText: jest.fn().mockResolvedValue({ ok: true, msgId: 'msg-1' }), uploadImage: jest.fn(), sendImage: jest.fn() }

    const result = await service(prisma, { appTransport }).verifyBinding(
      { actorUserId: 'actor-1', requestId: 'request-1' },
      'binding-1',
      {},
    )

    expect(result).toEqual({ ok: true, message: null })
    expect(appTransport.sendText).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-1',
      agentId: 1000001,
      toUser: 'zhangsan',
      content: expect.stringContaining('企业微信绑定测试'),
    }))
    expect(tx.wecomBinding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'binding-1' },
      data: expect.objectContaining({ status: 'ACTIVE' }),
    }))
  })

  it('encrypts a target webhook key and forces internal-only', async () => {
    const tx = transaction()
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => Promise.resolve(callback(tx))),
    }

    const result = await service(prisma).createTarget(
      { actorUserId: 'actor-1', requestId: 'request-1' },
      { key: 'finance', name: '财务群', webhookKey: 'webhook-key' },
    )

    expect(tx.wecomTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'finance',
        webhookKeyEncrypted: 'enc:webhook-key',
        internalOnly: true,
        enabled: true,
      }),
    })
    expect(result).toMatchObject({ key: 'finance', internalOnly: true })
  })

  it('updates the channel setting and returns the actor name', async () => {
    const tx = transaction()
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => Promise.resolve(callback(tx))),
      notificationChannelSettings: {
        findUnique: jest.fn().mockResolvedValue({ version: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ displayName: '管理员' }),
      },
    }

    const result = await service(prisma).updateChannel(
      { actorUserId: 'actor-1', requestId: 'request-1' },
      { enabled: true, expectedVersion: 1 },
    )

    expect(tx.notificationChannelSettings.update).toHaveBeenCalledWith({
      where: { channel: 'WECOM' },
      data: expect.objectContaining({ enabled: true, updatedByUserId: 'actor-1' }),
    })
    expect(result).toMatchObject({ enabled: true, version: 2, updatedByName: '管理员' })
  })
})
