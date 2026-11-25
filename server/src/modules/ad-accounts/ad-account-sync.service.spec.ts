import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../audit/audit.service'
import { SystemNotificationService } from '../notifications/system-notification.service'
import { AdAccountSyncService } from './ad-account-sync.service'
import type { CheetahGoAccount, CheetahGoClient } from './cheetahgo.client'

const NOW = new Date('2026-11-22T10:00:00+08:00')
const ACCOUNT_UUID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

function vendorAccount(overrides: Partial<CheetahGoAccount> = {}): CheetahGoAccount {
  return {
    accountId: '183000000000097',
    accountName: 'QS-LB-14',
    accountSource: 'SELF',
    companyCn: '聊城千树文化传媒有限公司',
    accountStatus: 1,
    accountStatusText: 'ACTIVE',
    freeze: 2,
    disableReason: 0,
    spendCap: '100.01',
    amountSpent: '80.00',
    dailySpendLimit: '1000.00',
    disabledTransferAmount: '0.00',
    createdTime: new Date('2026-09-01T00:00:00+08:00'),
    vendorUpdatedAt: new Date('2026-11-22T09:00:00+08:00'),
    ...overrides,
  }
}

function authorizedAccount(overrides: Partial<CheetahGoAccount> = {}): CheetahGoAccount {
  return {
    accountId: '1411178864332686',
    accountName: 'QS-FS-01',
    accountSource: 'AUTHORIZED',
    companyCn: null,
    accountStatus: 1,
    accountStatusText: 'ACTIVE',
    freeze: null,
    disableReason: 0,
    spendCap: '1100.01',
    amountSpent: '930.99',
    dailySpendLimit: null,
    disabledTransferAmount: '0.00',
    createdTime: new Date('2026-10-13T18:02:35+08:00'),
    vendorUpdatedAt: null,
    ...overrides,
  }
}

function createService(options: {
  account?: CheetahGoAccount
  authorizedAccounts?: CheetahGoAccount[]
  authorizedError?: boolean
  assignedUserId?: string | null
  alertedAt?: Date | null
  assignedUserStatus?: string | null
  spend?: Array<{ accountId: string, date: string, spend: string }>
}) {
  const account = options.account ?? vendorAccount()
  const publish = jest.fn().mockResolvedValue({})
  const record = jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue(undefined)
  const update = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({})
  const upsertDaily = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({})

  const transaction = {
    $queryRaw: jest.fn<Promise<Array<{ locked: boolean }>>, [unknown]>().mockResolvedValue([{ locked: true }]),
    adAccount: {
      updateMany: jest.fn<Promise<{ count: number }>, [unknown]>().mockResolvedValue({ count: 0 }),
      upsert: jest
        .fn<Promise<{ id: string, lowBalanceAlertedAt: Date | null }>, [unknown]>()
        .mockResolvedValue({
          id: ACCOUNT_UUID,
          lowBalanceAlertedAt: options.alertedAt ?? null,
        }),
      findUnique: jest
        .fn<Promise<{ assignedUserId: string | null } | null>, [unknown]>()
        .mockResolvedValue({
          assignedUserId: options.assignedUserId === undefined ? USER_ID : options.assignedUserId,
        }),
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
      update,
    },
    adAccountSpendDaily: { upsert: upsertDaily },
    user: {
      findUnique: jest
        .fn<Promise<{ id: string, status: string } | null>, [unknown]>()
        .mockResolvedValue(
          options.assignedUserStatus === null
            ? null
            : { id: USER_ID, status: options.assignedUserStatus ?? 'ACTIVE' },
        ),
    },
  }

  const transactionRunner = jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>()
  transactionRunner.mockImplementation((callback) => Promise.resolve(callback(transaction)))

  const prisma = { $transaction: transactionRunner } as unknown as PrismaService

  const client = {
    listAccounts: jest.fn<Promise<CheetahGoAccount[]>, []>().mockResolvedValue([account]),
    listAuthorizedAccounts: jest.fn<Promise<CheetahGoAccount[]>, []>().mockImplementation(() => (
      options.authorizedError === true
        ? Promise.reject(new Error('authorized accounts unavailable'))
        : Promise.resolve(options.authorizedAccounts ?? [])
    )),
    listDailySpend: jest
      .fn<Promise<Array<{ accountId: string, date: string, spend: string }>>, [string, string]>()
      .mockResolvedValue(options.spend ?? []),
  } as unknown as CheetahGoClient

  const service = new AdAccountSyncService(
    prisma,
    { publish } as unknown as SystemNotificationService,
    { record } as unknown as AuditService,
    client,
  )

  return { service, publish, record, update, upsertDaily, updateMany: transaction.adAccount.updateMany, client }
}

describe('AdAccountSyncService', () => {
  it('skips when the vendor client is not configured', async () => {
    const prisma = {
      $transaction: jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>(),
    } as unknown as PrismaService
    const service = new AdAccountSyncService(
      prisma,
      { publish: jest.fn<Promise<unknown>, [unknown, unknown]>() } as unknown as SystemNotificationService,
      { record: jest.fn<Promise<unknown>, [unknown, unknown]>() } as unknown as AuditService,
      null,
    )

    await expect(service.sync({ now: () => NOW })).resolves.toMatchObject({
      status: 'skipped',
      reason: 'disabled',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('publishes a low balance alert once and marks the account', async () => {
    // 100.01 - 90.00 = 10.01 < 30
    const { service, publish, update } = createService({
      account: vendorAccount({ amountSpent: '90.00' }),
    })

    const result = await service.sync({ now: () => NOW })

    expect(result).toMatchObject({ status: 'completed', accounts: 1, alerts: 1, resets: 0 })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'AD_ACCOUNT_BALANCE_LOW',
      target: { kind: 'USERS', userIds: [USER_ID] },
      dedupeKey: 'ad-account-balance-low:183000000000097:2026-11-22',
      variables: expect.objectContaining({
        adAccountName: 'QS-LB-14',
        availableBalance: '10.01',
        balanceThreshold: '30.00',
      }) as unknown,
    }), expect.objectContaining({ now: NOW }))
    expect(update).toHaveBeenCalledWith({
      where: { id: ACCOUNT_UUID },
      data: { lowBalanceAlertedAt: NOW },
    })
  })

  it('does not repeat the alert while the flag is set', async () => {
    const { service, publish } = createService({
      account: vendorAccount({ amountSpent: '90.00' }),
      alertedAt: new Date('2026-11-21T00:00:00+08:00'),
    })

    const result = await service.sync({ now: () => NOW })

    expect(result.alerts).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  it('clears the flag when the balance recovers', async () => {
    const { service, publish, update } = createService({
      account: vendorAccount({ amountSpent: '10.00' }),
      alertedAt: new Date('2026-11-21T00:00:00+08:00'),
    })

    const result = await service.sync({ now: () => NOW })

    expect(result).toMatchObject({ alerts: 0, resets: 1 })
    expect(publish).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({
      where: { id: ACCOUNT_UUID },
      data: { lowBalanceAlertedAt: null },
    })
  })

  it('ignores accounts without a spend cap', async () => {
    const { service, publish } = createService({
      account: vendorAccount({ spendCap: '0.00', amountSpent: '0.00' }),
    })

    const result = await service.sync({ now: () => NOW })

    expect(result.alerts).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  it('falls back to the manage permission when the assignee is inactive', async () => {
    const { service, publish } = createService({
      account: vendorAccount({ amountSpent: '90.00' }),
      assignedUserStatus: 'DISABLED',
    })

    await service.sync({ now: () => NOW })

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'PERMISSION', permissionCode: 'ad-accounts:manage' },
    }), expect.anything())
  })

  it('writes daily spend rows and computes the average over covered days', async () => {
    const { service, upsertDaily, publish } = createService({
      account: vendorAccount({ amountSpent: '10.00' }),
      spend: [
        { accountId: '183000000000097', date: '2026-11-20', spend: '7.00' },
        { accountId: '183000000000097', date: '2026-11-21', spend: '7.00' },
      ],
    })

    const result = await service.sync({ now: () => NOW })

    expect(result.spendRows).toBe(2)
    expect(upsertDaily).toHaveBeenCalledTimes(2)
    expect(publish).not.toHaveBeenCalled()
  })

  it('merges the allowlisted authorized account and reports authorizedSynced', async () => {
    const { service, record } = createService({
      account: vendorAccount({ amountSpent: '10.00' }),
      authorizedAccounts: [authorizedAccount()],
    })

    const result = await service.sync({ now: () => NOW })

    expect(result).toMatchObject({ accounts: 2, authorizedSynced: true })
    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      metadata: expect.objectContaining({ accounts: 2, authorizedSynced: true }) as unknown,
    }))
  })

  it('keeps authorized snapshots when the authorized list fails', async () => {
    const { service, updateMany } = createService({
      account: vendorAccount({ amountSpent: '10.00' }),
      authorizedError: true,
    })

    const result = await service.sync({ now: () => NOW })

    expect(result).toMatchObject({ accounts: 1, authorizedSynced: false })
    // 授权接口失败时只标记自开户缺失，不能把 QS-FS-01 的上一轮快照误标为未同步。
    expect(updateMany).toHaveBeenCalledWith({
      where: { vendorMissing: false, accountSource: 'SELF' },
      data: { vendorMissing: true },
    })
  })

  it('alerts for an unassigned authorized account without inventing daily spend', async () => {
    const { service, publish } = createService({
      account: vendorAccount({ amountSpent: '10.00' }),
      authorizedAccounts: [authorizedAccount({ amountSpent: '1090.01' })],
      assignedUserId: null,
    })

    await service.sync({ now: () => NOW })

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'PERMISSION', permissionCode: 'ad-accounts:manage' },
      variables: expect.objectContaining({
        availableBalance: '10.00',
        sevenDayAverage: '—',
        expectedDays: '—',
        companyName: '授权账户',
      }) as unknown,
    }), expect.anything())
  })
})
