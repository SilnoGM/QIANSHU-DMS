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
    fetchBriefInfo: jest.fn().mockResolvedValue([]),
    checkRelations: jest.fn().mockResolvedValue([]),
    getOwnQrCode: jest.fn(),
  } as unknown as AssistantAdminTransport & {
    checkOnline: jest.Mock
    fetchBriefInfo: jest.Mock
    checkRelations: jest.Mock
    getOwnQrCode: jest.Mock
  }
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

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'binding-1',
    userId: 'old-user',
    accountId: 'account-1',
    wxid: 'wxid-user',
    wechatNickname: '旧员工',
    wechatAvatarUrl: null,
    status: 'ACTIVE',
    verifiedAt: new Date('2026-11-06T00:00:00.000Z'),
    friendCheckedAt: null,
    boundAt: new Date('2026-11-06T00:00:00.000Z'),
    user: { displayName: '旧员工' },
    account: { name: '公司号-01', appId: 'wx-app' },
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

  it('stores the real WeChat nickname and avatar returned by GeWe on import', async () => {
    const created = accountRow({ nickname: '真实微信昵称', avatarUrl: 'https://wx.qlogo.cn/avatar.jpg' })
    const transaction = {
      assistantAccount: { create: jest.fn().mockResolvedValue(created) },
    }
    const prisma = {
      assistantAccount: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    }
    const admin = adminTransport(true)
    admin.fetchBriefInfo.mockResolvedValue([{
      wxid: 'wxid_bot',
      nickname: '真实微信昵称',
      remark: null,
      alias: null,
      avatarUrl: 'https://wx.qlogo.cn/avatar.jpg',
    }])

    await service(prisma, new FakeAssistantTransport(), admin).createAccount(context, {
      name: '公司号-01',
      appId: 'wx-app',
      wxid: 'wxid_bot',
      nickname: '手工昵称',
    })

    expect(admin.fetchBriefInfo).toHaveBeenCalledWith('wx-app', ['wxid_bot'])
    expect(transaction.assistantAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nickname: '真实微信昵称',
        avatarUrl: 'https://wx.qlogo.cn/avatar.jpg',
      }),
    })
  })

  it('refreshes the WeChat profile when checking node status', async () => {
    const account = accountRow({ nickname: '旧昵称', avatarUrl: null })
    const updated = accountRow({
      nickname: '新微信昵称',
      avatarUrl: 'https://wx.qlogo.cn/new-avatar.jpg',
      version: 2,
    })
    const prisma = {
      assistantAccount: {
        findUnique: jest.fn().mockResolvedValue(account),
        update: jest.fn().mockResolvedValue(updated),
      },
    }
    const admin = adminTransport(true)
    admin.fetchBriefInfo.mockResolvedValue([{
      wxid: 'wxid_bot',
      nickname: '新微信昵称',
      remark: null,
      alias: null,
      avatarUrl: 'https://wx.qlogo.cn/new-avatar.jpg',
    }])

    const result = await service(prisma, new FakeAssistantTransport(), admin).checkAccountStatus('account-1')

    expect(admin.fetchBriefInfo).toHaveBeenCalledWith('wx-app', ['wxid_bot'])
    expect(prisma.assistantAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: expect.objectContaining({
        nickname: '新微信昵称',
        avatarUrl: 'https://wx.qlogo.cn/new-avatar.jpg',
        status: 'ONLINE',
      }),
    })
    expect(result.nickname).toBe('新微信昵称')
    expect(result.avatarUrl).toBe('https://wx.qlogo.cn/new-avatar.jpg')
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

  it('sends custom verify content after reserving the binding cooldown', async () => {
    const binding = bindingRow()
    const transaction = {
      assistantBinding: { update: jest.fn().mockResolvedValue(binding) },
      audit: { record: jest.fn() },
    }
    const prisma = {
      assistantBinding: {
        findUnique: jest.fn().mockResolvedValue(binding),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    }
    const transport = new FakeAssistantTransport()

    const result = await service(prisma, transport).verifyBinding(context, 'binding-1', {
      content: '  自定义测试内容  ',
    })

    expect(prisma.assistantBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'binding-1',
        OR: [
          { lastTestSentAt: null },
          { lastTestSentAt: { lte: expect.any(Date) } },
        ],
      },
      data: { lastTestSentAt: expect.any(Date) },
    })
    expect(transport.calls).toEqual([
      expect.objectContaining({ appId: 'wx-app', toWxid: 'wxid-user', content: '自定义测试内容' }),
    ])
    expect(transaction.assistantBinding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'binding-1' },
      data: expect.objectContaining({ status: 'ACTIVE', verifiedAt: expect.any(Date) }),
    }))
    expect(result.userName).toBe('旧员工')
  })

  it('rejects empty or oversized verify content before reserving the cooldown', async () => {
    const prisma = {
      assistantBinding: { findUnique: jest.fn(), updateMany: jest.fn() },
    }
    const transport = new FakeAssistantTransport()
    const assistant = service(prisma, transport)

    await expect(assistant.verifyBinding(context, 'binding-1', { content: '   ' }))
      .rejects.toMatchObject({ code: 'ASSISTANT_BINDING_CONTENT_INVALID' })
    await expect(assistant.verifyBinding(context, 'binding-1', { content: 'x'.repeat(501) }))
      .rejects.toMatchObject({ code: 'ASSISTANT_BINDING_CONTENT_INVALID' })
    expect(prisma.assistantBinding.findUnique).not.toHaveBeenCalled()
    expect(transport.calls).toEqual([])
  })

  it('rejects verify requests during the binding cooldown without sending', async () => {
    const binding = bindingRow()
    const prisma = {
      assistantBinding: {
        findUnique: jest.fn().mockResolvedValue(binding),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const transport = new FakeAssistantTransport()

    await expect(service(prisma, transport).verifyBinding(context, 'binding-1', {
      content: '冷却中的测试内容',
    })).rejects.toMatchObject({ code: 'ASSISTANT_BINDING_TEST_COOLDOWN' })
    expect(transport.calls).toEqual([])
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

  it('refreshes profiles for all bindings and checks only active friend relations', async () => {
    const active = bindingRow({
      id: 'binding-active',
      wxid: 'wxid-active',
      wechatNickname: '旧昵称',
      wechatAvatarUrl: null,
      status: 'ACTIVE',
    })
    const disabled = bindingRow({
      id: 'binding-disabled',
      wxid: 'wxid-disabled',
      wechatNickname: '旧昵称-停用',
      wechatAvatarUrl: null,
      status: 'DISABLED',
    })
    const prisma = {
      assistantBinding: {
        findMany: jest.fn().mockResolvedValue([active, disabled]),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        audit: { record: jest.fn() },
      })),
    }
    const admin = adminTransport(true)
    admin.fetchBriefInfo.mockResolvedValue([
      { wxid: 'wxid-active', nickname: '新昵称', remark: null, alias: null, avatarUrl: 'https://wx.qlogo.cn/a.jpg' },
      { wxid: 'wxid-disabled', nickname: '新昵称-停用', remark: null, alias: null, avatarUrl: 'https://wx.qlogo.cn/b.jpg' },
    ])
    admin.checkRelations.mockResolvedValue([{ wxid: 'wxid-active', relation: 1 }])

    const result = await service(prisma, new FakeAssistantTransport(), admin).checkBindings(context)

    expect(admin.fetchBriefInfo).toHaveBeenCalledWith('wx-app', ['wxid-active', 'wxid-disabled'])
    expect(admin.checkRelations).toHaveBeenCalledWith('wx-app', ['wxid-active'])
    expect(prisma.assistantBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding-active' },
      data: expect.objectContaining({
        wechatNickname: '新昵称',
        wechatAvatarUrl: 'https://wx.qlogo.cn/a.jpg',
        status: 'INVALID',
      }),
    })
    expect(prisma.assistantBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding-disabled' },
      data: expect.objectContaining({
        wechatNickname: '新昵称-停用',
        wechatAvatarUrl: 'https://wx.qlogo.cn/b.jpg',
      }),
    })
    expect(prisma.assistantBinding.update).not.toHaveBeenCalledWith({
      where: { id: 'binding-disabled' },
      data: expect.objectContaining({ status: expect.anything() }),
    })
    expect(result).toEqual({ checked: 2, invalidated: 1 })
  })

  it('returns the plaintext wxid in binding list responses', async () => {
    const binding = bindingRow({ wxid: 'wxid_full_plaintext' })
    const prisma = {
      assistantBinding: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([binding]),
      },
      $transaction: jest.fn(async (promises: Promise<unknown>[]) => Promise.all(promises)),
    }

    const result = await service(prisma).listBindings({ page: 1, pageSize: 20 })

    expect(result.items[0]).toMatchObject({
      wxid: 'wxid_full_plaintext',
      wxidMasked: expect.stringContaining('*'),
      wechatNickname: '旧员工',
    })
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

  it('reassigns an existing binding and clears its verification', async () => {
    const transaction = {
      assistantBinding: {
        update: jest.fn().mockResolvedValue(bindingRow({
          userId: 'new-user',
          boundByUserId: 'user-1',
          verifiedAt: null,
          user: { displayName: '新员工' },
        })),
      },
    }
    const prisma = {
      assistantBinding: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(bindingRow())
          .mockResolvedValueOnce(null),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'new-user', status: 'ACTIVE' }) },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    }
    const audit = { record: jest.fn() }

    const result = await service(prisma, new FakeAssistantTransport(), adminTransport(), audit)
      .reassignBinding(context, 'binding-1', { userId: 'new-user' })

    expect(transaction.assistantBinding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'binding-1' },
      data: expect.objectContaining({
        userId: 'new-user',
        boundByUserId: 'user-1',
        verifiedAt: null,
        verifiedByUserId: null,
        status: 'ACTIVE',
      }),
    }))
    expect(audit.record).toHaveBeenCalledTimes(2)
    expect(result.userId).toBe('new-user')
  })

  it('rejects reassigning a binding to a user already bound to the account', async () => {
    const prisma = {
      assistantBinding: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(bindingRow())
          .mockResolvedValueOnce({ id: 'other-binding' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'new-user', status: 'ACTIVE' }) },
    }

    await expect(service(prisma).reassignBinding(context, 'binding-1', { userId: 'new-user' }))
      .rejects.toMatchObject({ code: 'ASSISTANT_BINDING_USER_CONFLICT' })
  })

  it('updates the semantic target key and rejects a duplicate', async () => {
    const target = {
      id: 'target-1',
      key: 'chatroom-1',
      chatroomId: 'chatroom-1',
      name: '测试群',
      purpose: null,
      internalOnly: false,
      memberCount: null,
      enabled: true,
      lastSyncedAt: null,
    }
    const update = jest.fn().mockResolvedValue({ ...target, key: 'finance' })
    const prisma = {
      assistantTarget: {
        findUnique: jest.fn().mockResolvedValue(target),
        update,
      },
    }

    const result = await service(prisma).updateTarget('target-1', { key: ' finance ' })

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'target-1' },
      data: expect.objectContaining({ key: 'finance' }),
    }))
    expect(result.key).toBe('finance')

    update.mockRejectedValueOnce({ code: 'P2002' })
    await expect(service(prisma).updateTarget('target-1', { key: 'operations' }))
      .rejects.toMatchObject({ code: 'ASSISTANT_TARGET_KEY_EXISTS' })
  })
})
