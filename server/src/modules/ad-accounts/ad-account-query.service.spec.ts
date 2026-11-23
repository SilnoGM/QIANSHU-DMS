import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AdAccountQueryService } from './ad-account-query.service'

const NOW = new Date('2026-11-23T10:00:00+08:00')

function accountRow(overrides: Record<string, unknown>) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    accountId: '1411178864332686',
    accountName: 'QS-FS-01',
    accountSource: 'AUTHORIZED',
    companyCn: null,
    accountStatus: 1,
    accountStatusText: 'ACTIVE',
    freeze: null,
    disableReason: 0,
    spendCap: new Prisma.Decimal('1100.01'),
    amountSpent: new Prisma.Decimal('930.99'),
    dailySpendLimit: null,
    disabledTransferAmount: new Prisma.Decimal('0.00'),
    vendorMissing: false,
    createdTime: new Date('2026-10-13T18:02:35+08:00'),
    vendorUpdatedAt: null,
    lastSyncedAt: NOW,
    assignedUser: null,
    ...overrides,
  }
}

function createService(
  accounts: ReturnType<typeof accountRow>[],
  spendRows: Array<{ adAccountId: string, spend: Prisma.Decimal }> = [],
) {
  const prisma = {
    adAccount: { findMany: jest.fn().mockResolvedValue(accounts) },
    adAccountSpendDaily: { findMany: jest.fn().mockResolvedValue(spendRows) },
  } as unknown as PrismaService

  return new AdAccountQueryService(prisma)
}

describe('AdAccountQueryService authorized accounts', () => {
  it('returns null daily average and upstream update time for an authorized account', async () => {
    const service = createService([accountRow({})])

    const result = await service.listMine('user-1')

    expect(result.list).toHaveLength(1)
    expect(result.list[0]).toMatchObject({
      accountSource: 'AUTHORIZED',
      availableBalance: '169.02',
      sevenDayAverage: null,
      sustainableDays: null,
      vendorUpdatedAt: null,
      lowBalance: false,
    })
  })

  it('still reports exhausted when an authorized account has no available balance', async () => {
    const service = createService([
      accountRow({
        spendCap: new Prisma.Decimal('930.99'),
        amountSpent: new Prisma.Decimal('930.99'),
      }),
    ])

    const result = await service.listMine('user-1')

    expect(result.list[0]).toMatchObject({
      availableBalance: '0.00',
      sevenDayAverage: null,
      sustainableDays: 0,
    })
  })

  it('keeps the computed average for self-owned accounts', async () => {
    const self = accountRow({
      accountSource: 'SELF',
      accountId: '183000000000097',
      accountName: 'QS-LB-14',
      spendCap: new Prisma.Decimal('100.01'),
      amountSpent: new Prisma.Decimal('50.00'),
      vendorUpdatedAt: new Date('2026-11-23T09:00:00+08:00'),
    })
    const service = createService([self], [
      { adAccountId: self.id, spend: new Prisma.Decimal('14.00') },
    ])

    const result = await service.listMine('user-1')

    expect(result.list[0]).toMatchObject({
      accountSource: 'SELF',
      sevenDayAverage: '2.00',
      sustainableDays: 25,
      vendorUpdatedAt: '2026-11-23T01:00:00.000Z',
    })
  })
})
