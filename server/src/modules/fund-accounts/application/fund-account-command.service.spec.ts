import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { FundAccountCommandService } from './fund-account-command.service'
import { FundPostingError } from './fund-posting.errors'

const ACTOR_USER_ID = '11111111-1111-4111-a111-111111111111'
const TARGET_USER_ID = '22222222-2222-4222-a222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-a333-333333333333'
const CONTEXT = {
  actorUserId: ACTOR_USER_ID,
  requestId: 'request-1',
  correlationId: 'correlation-1',
}

function accountRow(options: {
  ownerType?: 'USER' | 'COMPANY'
  shareRate?: string | null
  version?: number
} = {}) {
  const ownerType = options.ownerType ?? 'USER'
  const shareRate = options.shareRate === undefined ? '30' : options.shareRate
  return {
    id: ACCOUNT_ID,
    ownerType,
    userId: ownerType === 'USER' ? TARGET_USER_ID : null,
    currency: 'CNY',
    balance: new Prisma.Decimal('0'),
    userShareRate: shareRate === null ? null : new Prisma.Decimal(shareRate),
    version: options.version ?? 1,
    shareRateUpdatedAt: new Date('2026-08-18T01:00:00.000Z'),
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T01:00:00.000Z'),
    user: ownerType === 'USER'
      ? {
          id: TARGET_USER_ID,
          username: 'zhangsan',
          displayName: '张三',
          status: 'ACTIVE' as const,
        }
      : null,
  }
}

function fixture() {
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>(),
    fundAccount: {
      create: jest.fn<Promise<unknown>, [unknown]>(),
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
    },
  }
  const prisma = {
    $transaction: jest.fn<
      Promise<unknown>,
      [(client: typeof transaction) => Promise<unknown>]
    >(callback => callback(transaction)),
  }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>()
      .mockResolvedValue({ id: 'audit-1' }),
  }
  const service = new FundAccountCommandService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { audit, prisma, service, transaction }
}

async function expectFundReject(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(FundPostingError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('FundAccountCommandService createUserAccount', () => {
  it('creates a zero-balance CNY account and Audit in one transaction', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TARGET_USER_ID,
        existingAccountId: null,
      }])
    transaction.fundAccount.create.mockResolvedValue({ id: ACCOUNT_ID })
    transaction.fundAccount.findUnique.mockResolvedValue(accountRow())

    const result = await service.createUserAccount(CONTEXT, {
      userId: TARGET_USER_ID,
      userShareRate: '30',
    })

    expect(result).toMatchObject({
      id: ACCOUNT_ID,
      balance: '0.0000',
      currency: 'CNY',
      userShareRate: '30.0000',
      companyShareRate: '70.0000',
      version: 1,
    })
    const createArguments = transaction.fundAccount.create.mock.calls[0]?.[0] as {
      data: {
        ownerType: string
        userId: string
        currency: string
        balance: Prisma.Decimal
        userShareRate: Prisma.Decimal
        nextSequence: bigint
        version: number
        shareRateUpdatedAt: unknown
      }
      select: { id: boolean }
    }
    const { shareRateUpdatedAt, ...createData } = createArguments.data
    expect(shareRateUpdatedAt).toBeInstanceOf(Date)
    expect(createData).toEqual({
      ownerType: 'USER',
      userId: TARGET_USER_ID,
      currency: 'CNY',
      balance: new Prisma.Decimal('0.0000'),
      userShareRate: new Prisma.Decimal('30.0000'),
      nextSequence: 1n,
      version: 1,
    })
    expect(createArguments.select).toEqual({ id: true })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'FUND_ACCOUNT_CREATED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: ACTOR_USER_ID,
        targetType: 'FundAccount',
        targetId: ACCOUNT_ID,
        requestId: 'request-1',
        correlationId: 'correlation-1',
        metadata: {
          userId: TARGET_USER_ID,
          userShareRate: '30.0000',
        },
      }),
    )
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.fundAccount.create.mock.invocationCallOrder[0],
    )
    const timeoutSql = transaction.$queryRaw.mock.calls[0]?.[0] as {
      strings?: readonly string[]
    }
    expect(timeoutSql.strings?.join(' ')).toContain("set_config('lock_timeout'")
    const targetSql = transaction.$queryRaw.mock.calls[1]?.[0] as {
      strings?: readonly string[]
    }
    expect(targetSql.strings?.join(' ')).toContain('FOR SHARE OF users')
    expect(targetSql.strings?.join(' ')).not.toContain('users."status" =')
  })

  it('rejects a missing user and friendly duplicate before create', async () => {
    const missing = fixture()
    missing.transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await expectFundReject(
      missing.service.createUserAccount(CONTEXT, {
        userId: TARGET_USER_ID,
        userShareRate: '30',
      }),
      'FUND_USER_NOT_FOUND',
    )
    expect(missing.transaction.fundAccount.create).not.toHaveBeenCalled()
    expect(missing.audit.record).not.toHaveBeenCalled()

    const duplicate = fixture()
    duplicate.transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TARGET_USER_ID,
        existingAccountId: ACCOUNT_ID,
      }])
    await expectFundReject(
      duplicate.service.createUserAccount(CONTEXT, {
        userId: TARGET_USER_ID,
        userShareRate: '30',
      }),
      'FUND_ACCOUNT_ALREADY_EXISTS',
    )
    expect(duplicate.transaction.fundAccount.create).not.toHaveBeenCalled()
  })

  it('uses the database unique constraint as the concurrent duplicate guard', async () => {
    const { service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TARGET_USER_ID,
        existingAccountId: null,
      }])
    transaction.fundAccount.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['userId'] },
    })

    await expectFundReject(
      service.createUserAccount(CONTEXT, {
        userId: TARGET_USER_ID,
        userShareRate: '30',
      }),
      'FUND_ACCOUNT_ALREADY_EXISTS',
    )
  })

  it('fails closed when Audit cannot be written in the transaction', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TARGET_USER_ID,
        existingAccountId: null,
      }])
    transaction.fundAccount.create.mockResolvedValue({ id: ACCOUNT_ID })
    transaction.fundAccount.findUnique.mockResolvedValue(accountRow())
    audit.record.mockRejectedValue(new Error('must-not-leak database detail'))

    await expectFundReject(
      service.createUserAccount(CONTEXT, {
        userId: TARGET_USER_ID,
        userShareRate: '30',
      }),
      'FUND_INTERNAL_ERROR',
    )
  })
})

describe('FundAccountCommandService updateUserShareRate', () => {
  it('locks, checks version, updates only the account and writes Audit', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([accountRow()])
      .mockResolvedValueOnce([{
        userShareRate: new Prisma.Decimal('45'),
        version: 2,
        shareRateUpdatedAt: new Date('2026-08-18T02:00:00.000Z'),
        updatedAt: new Date('2026-08-18T02:00:00.000Z'),
      }])

    const result = await service.updateUserShareRate(CONTEXT, {
      accountId: ACCOUNT_ID,
      userShareRate: '45',
      expectedVersion: 1,
      reason: ' 调整 合作比例 ',
    })

    expect(result).toMatchObject({
      changed: true,
      account: {
        id: ACCOUNT_ID,
        userShareRate: '45.0000',
        companyShareRate: '55.0000',
        version: 2,
        shareRateUpdatedAt: '2026-08-18T02:00:00.000Z',
      },
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'FUND_ACCOUNT_SHARE_RATE_UPDATED',
        metadata: {
          previousUserShareRate: '30.0000',
          reason: '调整 合作比例',
          userId: TARGET_USER_ID,
          userShareRate: '45.0000',
        },
      }),
    )

    const updateSql = transaction.$queryRaw.mock.calls[2]?.[0] as {
      strings?: readonly string[]
    }
    expect(updateSql.strings?.join(' ')).toContain('UPDATE "fund_accounts"')
    expect(updateSql.strings?.join(' ')).toContain('AND "version" =')
    expect(updateSql.strings?.join(' ')).not.toContain('fund_posting_batches')
    expect(updateSql.strings?.join(' ')).not.toContain('fund_ledger_entries')
  })

  it('returns a no-op without update, version increment or Audit', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([accountRow()])

    const result = await service.updateUserShareRate(CONTEXT, {
      accountId: ACCOUNT_ID,
      userShareRate: '30.0000',
      expectedVersion: 1,
      reason: '无需变化',
    })

    expect(result).toMatchObject({ changed: false, account: { version: 1 } })
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2)
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rejects stale versions, missing accounts and company accounts', async () => {
    const stale = fixture()
    stale.transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([accountRow({ version: 2 })])
    await expectFundReject(
      stale.service.updateUserShareRate(CONTEXT, {
        accountId: ACCOUNT_ID,
        userShareRate: '45',
        expectedVersion: 1,
        reason: '过期版本',
      }),
      'FUND_ACCOUNT_STATE_CHANGED',
    )
    expect(stale.audit.record).not.toHaveBeenCalled()

    const missing = fixture()
    missing.transaction.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await expectFundReject(
      missing.service.updateUserShareRate(CONTEXT, {
        accountId: ACCOUNT_ID,
        userShareRate: '45',
        expectedVersion: 1,
        reason: '账户不存在',
      }),
      'FUND_ACCOUNT_NOT_FOUND',
    )

    const company = fixture()
    company.transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([accountRow({
        ownerType: 'COMPANY',
        shareRate: null,
      })])
    await expectFundReject(
      company.service.updateUserShareRate(CONTEXT, {
        accountId: ACCOUNT_ID,
        userShareRate: '45',
        expectedVersion: 1,
        reason: '公司账户不可修改',
      }),
      'FUND_ACCOUNT_UNAVAILABLE',
    )
    expect(company.audit.record).not.toHaveBeenCalled()
  })
})
