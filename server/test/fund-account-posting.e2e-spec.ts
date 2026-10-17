import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { FundConfigurationCommandService } from '../src/modules/fund-accounts/application/fund-configuration-command.service'
import { FundPostingService } from '../src/modules/fund-accounts/application/fund-posting.contract'
import type {
  FundPostingContext,
  PostBusinessEventInput,
} from '../src/modules/fund-accounts/application/fund-posting.contract'
import { FUND_POSTING_ERROR_CODES } from '../src/modules/fund-accounts/application/fund-posting.errors'
import { FundPostingApplicationService } from '../src/modules/fund-accounts/application/fund-posting.service'
import { FundTransactionQueryService } from '../src/modules/fund-accounts/application/fund-transaction-query.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'

const BUSINESS_TYPE_CODES = [
  'ORDER_SETTLEMENT',
  'USER_WITHDRAWAL',
  'PURCHASE_PAYMENT',
  'RENT_UTILITIES',
  'BUSINESS_ACCOUNT_FEE',
  'ADVERTISING_FEE',
  'NETWORK_IP_VPN_FEE',
  'INVOICE_FEE',
] as const
const SOURCE_CODE = 'FUND_E2E_DOMAIN'
const UNAUTHORIZED_SOURCE_CODE = 'FUND_E2E_ORDER_ONLY'

interface AccountSnapshot {
  balance: string
  nextSequence: bigint
  version: number
}

function requestId(prefix: string): string {
  // requestId 的公共契约上限为 64 字符；只保留短场景标签，避免测试名称长度
  // 偶然改变请求合法性，UUID 仍保证并发验收中的唯一性。
  return `fund_${prefix.slice(0, 8)}_${randomUUID()}`
}

describe('fund account posting against isolated PostgreSQL', () => {
  jest.setTimeout(90_000)

  let application: INestApplication
  let prisma: PrismaService
  let passwords: PasswordProvider
  let accountCommands: FundAccountCommandService
  let configurationCommands: FundConfigurationCommandService
  let businessPostings: FundPostingService
  let postings: FundPostingApplicationService
  let transactions: FundTransactionQueryService
  let audit: AuditService
  let actorUserId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()

    prisma = application.get(PrismaService)
    passwords = application.get(PasswordProvider)
    accountCommands = application.get(FundAccountCommandService)
    configurationCommands = application.get(FundConfigurationCommandService)
    businessPostings = application.get(FundPostingService)
    postings = application.get(FundPostingApplicationService)
    transactions = application.get(FundTransactionQueryService)
    audit = application.get(AuditService)

    actorUserId = await createUser('actor')
    const postingTypes = await prisma.fundPostingType.findMany({
      where: { code: { in: [...BUSINESS_TYPE_CODES] } },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    })
    expect(postingTypes).toHaveLength(BUSINESS_TYPE_CODES.length)
    const postingTypeIds = postingTypes.map(item => item.id)
    const orderTypeId = postingTypes.find(
      item => item.code === 'ORDER_SETTLEMENT',
    )?.id
    expect(orderTypeId).toBeDefined()

    await configurationCommands.createBusinessSource(
      commandContext('source_all'),
      {
        code: SOURCE_CODE,
        name: '资金 E2E 业务域',
        description: '只存在于一次性 PostgreSQL 的 Server E2E 来源',
        enabled: true,
        allowedPostingTypeIds: postingTypeIds,
      },
    )
    await configurationCommands.createBusinessSource(
      commandContext('source_order_only'),
      {
        code: UNAUTHORIZED_SOURCE_CODE,
        name: '资金 E2E 仅订单业务域',
        description: '验证来源不可越权选择成本类型',
        enabled: true,
        allowedPostingTypeIds: [orderTypeId as string],
      },
    )
  })

  afterAll(async () => {
    await application.close()
  })

  function commandContext(prefix: string) {
    return {
      actorUserId,
      requestId: requestId(`fund_e2e_${prefix}`),
    }
  }

  function postingContext(
    prefix: string,
    sourceCode = SOURCE_CODE,
  ): FundPostingContext {
    return {
      consumerCode: 'FUND_E2E_CONSUMER',
      sourceCode,
      requestId: requestId(`fund_e2e_${prefix}`),
      correlationId: `fund-e2e:${prefix}`,
    }
  }

  async function createUser(label: string): Promise<string> {
    const suffix = randomUUID().replaceAll('-', '')
    const username = `fund_e2e_${label}_${suffix}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: `资金 E2E ${label}`,
        passwordHash: await passwords.hash(`Fund-${suffix.slice(0, 12)}!7`),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        profile: { create: {} },
      },
      select: { id: true },
    })
    return user.id
  }

  async function createAccount(userId: string, userShareRate = '30') {
    return accountCommands.createUserAccount(commandContext('account'), {
      userId,
      userShareRate,
    })
  }

  function businessInput(
    postingTypeCode: string,
    amount: string,
    options: {
      businessId?: string
      businessNo?: string
      idempotencyKey?: string
      userId?: string
    } = {},
  ): PostBusinessEventInput {
    const suffix = randomUUID()
    return {
      postingTypeCode,
      ...(options.userId === undefined ? {} : { userId: options.userId }),
      amount,
      businessId: options.businessId ?? `fund-e2e-business-${suffix}`,
      businessNo: options.businessNo ?? `E2E-${suffix}`,
      summary: `资金 E2E ${postingTypeCode}`,
      metadata: { scenario: 'isolated-postgresql' },
      businessOccurredAt: new Date().toISOString(),
      idempotencyKey: options.idempotencyKey ?? `fund-e2e-key-${suffix}`,
    }
  }

  async function accountSnapshot(accountId: string): Promise<AccountSnapshot> {
    const account = await prisma.fundAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { balance: true, nextSequence: true, version: true },
    })
    return {
      balance: account.balance.toFixed(2),
      nextSequence: account.nextSequence,
      version: account.version,
    }
  }

  it('starts with one CNY company account, no user seed, and enforces one account plus 0/100 boundaries', async () => {
    const seedCounts = await prisma.fundAccount.groupBy({
      by: ['ownerType'],
      _count: { _all: true },
    })
    expect(seedCounts).toEqual([{
      _count: { _all: 1 },
      ownerType: 'COMPANY',
    }])
    await expect(prisma.fundAccount.findFirstOrThrow({
      where: { ownerType: 'COMPANY' },
      select: { currency: true, userId: true, userShareRate: true },
    })).resolves.toEqual({
      currency: 'CNY',
      userId: null,
      userShareRate: null,
    })

    const zeroUserId = await createUser('zero_share')
    const fullUserId = await createUser('full_share')
    const duplicateUserId = await createUser('duplicate')
    const [zeroAccount, fullAccount] = await Promise.all([
      createAccount(zeroUserId, '0'),
      createAccount(fullUserId, '100'),
    ])
    expect(zeroAccount).toMatchObject({
      balance: '0.00',
      currency: 'CNY',
      userShareRate: '0.00',
    })
    expect(fullAccount).toMatchObject({
      balance: '0.00',
      currency: 'CNY',
      userShareRate: '100.00',
    })

    const duplicateAttempts = await Promise.allSettled([
      createAccount(duplicateUserId, '30'),
      createAccount(duplicateUserId, '50'),
    ])
    expect(duplicateAttempts.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = duplicateAttempts.find(item => item.status === 'rejected')
    expect(rejected).toMatchObject({
      reason: { code: FUND_POSTING_ERROR_CODES.ACCOUNT_ALREADY_EXISTS },
    })
    await expect(prisma.fundAccount.count({
      where: { userId: duplicateUserId },
    })).resolves.toBe(1)

    const zeroPosting = await businessPostings.postBusinessEvent(
      postingContext('zero_share'),
      businessInput('ORDER_SETTLEMENT', '10', { userId: zeroUserId }),
    )
    const fullPosting = await businessPostings.postBusinessEvent(
      postingContext('full_share'),
      businessInput('ORDER_SETTLEMENT', '10', { userId: fullUserId }),
    )
    expect(zeroPosting.entries).toEqual([
      expect.objectContaining({ accountTarget: 'COMPANY', amount: '10.00' }),
    ])
    expect(fullPosting.entries).toEqual([
      expect.objectContaining({ accountTarget: 'USER', amount: '10.00' }),
    ])
  })

  it('posts all nine initialized types, permits negative balances, and rejects source overreach', async () => {
    const userId = await createUser('all_types')
    const account = await createAccount(userId, '30')
    const cases = [
      ['ORDER_SETTLEMENT', '-100', 'REVENUE'],
      ['ORDER_SETTLEMENT', '100', 'REVENUE'],
      ['USER_WITHDRAWAL', '10', 'NEUTRAL'],
      ['PURCHASE_PAYMENT', '10', 'COST'],
      ['RENT_UTILITIES', '10', 'COST'],
      ['BUSINESS_ACCOUNT_FEE', '10', 'COST'],
      ['ADVERTISING_FEE', '10', 'COST'],
      ['NETWORK_IP_VPN_FEE', '10', 'COST'],
      ['INVOICE_FEE', '10', 'COST'],
    ] as const
    const results = []
    for (const [code, amount, category] of cases) {
      const result = await businessPostings.postBusinessEvent(
        postingContext(`type_${code}`),
        businessInput(code, amount, {
          ...(code === 'RENT_UTILITIES' ? {} : { userId }),
        }),
      )
      expect(result).toMatchObject({
        postingTypeCode: code,
        businessCategory: category,
      })
      results.push(result)
    }

    const numberedBatch = await prisma.fundPostingBatch.findUniqueOrThrow({
      where: { id: results[0].batchId },
      select: { batchNo: true, numberingIssuanceId: true },
    })
    expect(numberedBatch.batchNo).toMatch(/^FUND\/\d{8}-\d{5}$/u)
    expect(numberedBatch.numberingIssuanceId).not.toBeNull()
    await expect(prisma.numberingIssuance.findUniqueOrThrow({
      where: { id: numberedBatch.numberingIssuanceId! },
      select: { generatedNumber: true, consumerCode: true },
    })).resolves.toEqual({
      generatedNumber: numberedBatch.batchNo,
      consumerCode: 'FUND_POSTING',
    })

    const adjustment = await postings.postManualAdjustment(
      commandContext('manual_type'),
      {
        userAccountId: account.id,
        amount: '-20',
        adjustmentMode: 'USER_ONLY',
        reason: '九种初始化类型 E2E',
        idempotencyKey: `fund-e2e-adjustment-${randomUUID()}`,
      },
    )
    expect(adjustment).toMatchObject({
      postingTypeCode: 'ADMIN_MANUAL_ADJUSTMENT',
      businessCategory: 'ADJUSTMENT',
      businessAmount: '-20.00',
    })
    expect(new Set([
      ...results.map(item => item.postingTypeCode),
      adjustment.postingTypeCode,
    ])).toEqual(new Set([
      ...BUSINESS_TYPE_CODES,
      'ADMIN_MANUAL_ADJUSTMENT',
    ]))
    expect((await accountSnapshot(account.id)).balance.startsWith('-')).toBe(true)

    await expect(businessPostings.postBusinessEvent(
      postingContext('source_overreach', UNAUTHORIZED_SOURCE_CODE),
      businessInput('PURCHASE_PAYMENT', '10', { userId }),
    )).rejects.toMatchObject({
      code: FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_ALLOWED,
    })
  })

  it('recovers idempotency races, serializes account updates, keeps sequences continuous, and rolls back Audit failure', async () => {
    const userId = await createUser('concurrency')
    const account = await createAccount(userId, '30')
    const idempotencyKey = `fund-e2e-race-${randomUUID()}`
    const input = businessInput('ORDER_SETTLEMENT', '10', {
      businessId: `fund-e2e-race-business-${randomUUID()}`,
      idempotencyKey,
      userId,
    })
    const replays = await Promise.all([
      businessPostings.postBusinessEvent(postingContext('race_a'), input),
      businessPostings.postBusinessEvent(postingContext('race_b'), input),
    ])
    expect(new Set(replays.map(item => item.batchId)).size).toBe(1)
    expect(replays.map(item => item.idempotentReplay).sort()).toEqual([false, true])

    await expect(businessPostings.postBusinessEvent(
      postingContext('race_conflict'),
      { ...input, amount: '11' },
    )).rejects.toMatchObject({
      code: FUND_POSTING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    })

    const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) => (
      businessPostings.postBusinessEvent(
        postingContext(`same_account_${index}`),
        businessInput('ORDER_SETTLEMENT', '1', { userId }),
      )
    )))
    expect(concurrent).toHaveLength(12)
    const userSequences = await prisma.fundLedgerEntry.findMany({
      where: { accountId: account.id },
      select: { accountSequence: true },
      orderBy: { accountSequence: 'asc' },
    })
    expect(userSequences.map(item => Number(item.accountSequence))).toEqual(
      Array.from({ length: 13 }, (_, index) => index + 1),
    )
    expect((await accountSnapshot(account.id)).balance).toBe('6.60')

    const peerUserId = await createUser('lock_peer')
    const peerAccount = await createAccount(peerUserId, '70')
    const multiAccount = await Promise.all(Array.from({ length: 16 }, (_, index) => (
      businessPostings.postBusinessEvent(
        postingContext(`multi_account_${index}`),
        businessInput('PURCHASE_PAYMENT', '1', {
          userId: index % 2 === 0 ? userId : peerUserId,
        }),
      )
    )))
    expect(multiAccount).toHaveLength(16)
    expect((await accountSnapshot(peerAccount.id)).balance).toBe('-5.60')

    const rollbackUserId = await createUser('audit_rollback')
    const rollbackAccount = await createAccount(rollbackUserId, '30')
    const rollbackBusinessId = `fund-e2e-audit-${randomUUID()}`
    const auditSpy = jest.spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('injected audit failure'))
    await expect(businessPostings.postBusinessEvent(
      postingContext('audit_rollback'),
      businessInput('ORDER_SETTLEMENT', '10', {
        businessId: rollbackBusinessId,
        userId: rollbackUserId,
      }),
    )).rejects.toMatchObject({
      code: FUND_POSTING_ERROR_CODES.INTERNAL_ERROR,
    })
    auditSpy.mockRestore()
    await expect(accountSnapshot(rollbackAccount.id)).resolves.toEqual({
      balance: '0.00',
      nextSequence: 1n,
      version: 1,
    })
    await expect(prisma.fundPostingBatch.count({
      where: { businessId: rollbackBusinessId },
    })).resolves.toBe(0)
  })

  it('uses historical shares for concurrent partial reversals and closes the original entries exactly', async () => {
    const userId = await createUser('reversal')
    const account = await createAccount(userId, '30')
    const original = await businessPostings.postBusinessEvent(
      postingContext('reversal_original'),
      businessInput('ORDER_SETTLEMENT', '100', {
        businessNo: 'FUND-E2E-REVERSAL',
        userId,
      }),
    )
    const originalDetail = await transactions.getBatchDetail(original.batchId)
    expect(originalDetail).toMatchObject({
      businessCategory: 'REVENUE',
      businessAmount: '100.00',
      ruleRevision: 1,
      userShareRateSnapshot: '30.00',
      companyShareRateSnapshot: '70.00',
      reversalChain: { status: 'NONE', remainingAmount: '100.00' },
    })

    const updated = await accountCommands.updateUserShareRate(
      commandContext('reversal_share_change'),
      {
        accountId: account.id,
        userShareRate: '60',
        expectedVersion: (await accountSnapshot(account.id)).version,
        reason: '验证历史批次不读取当前比例',
      },
    )
    expect(updated.account.userShareRate).toBe('60.00')

    const first = await postings.reversePostingBatch(
      commandContext('reversal_first'),
      {
        originalBatchId: original.batchId,
        amount: '20',
        reason: '第一次部分冲账',
        idempotencyKey: `fund-e2e-reversal-first-${randomUUID()}`,
      },
    )
    expect(first).toMatchObject({
      businessAmount: '-20.00',
      businessCategory: 'REVENUE',
      userShareRateSnapshot: '30.00',
      companyShareRateSnapshot: '70.00',
    })
    expect(first.entries).toEqual([
      expect.objectContaining({ accountTarget: 'USER', amount: '6.00', direction: 'DEBIT' }),
      expect.objectContaining({ accountTarget: 'COMPANY', amount: '14.00', direction: 'DEBIT' }),
    ])

    const concurrent = await Promise.allSettled([
      postings.reversePostingBatch(commandContext('reversal_race_50'), {
        originalBatchId: original.batchId,
        amount: '50',
        reason: '并发冲账 50',
        idempotencyKey: `fund-e2e-reversal-50-${randomUUID()}`,
      }),
      postings.reversePostingBatch(commandContext('reversal_race_70'), {
        originalBatchId: original.batchId,
        amount: '70',
        reason: '并发冲账 70',
        idempotencyKey: `fund-e2e-reversal-70-${randomUUID()}`,
      }),
    ])
    expect(concurrent.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const rejectedReversal = concurrent.find(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    )
    const rejectionReason: unknown = rejectedReversal?.reason
    expect(rejectionReason).toMatchObject({
      code: FUND_POSTING_ERROR_CODES.REVERSAL_EXCEEDS_REMAINING,
    })

    const partialDetail = await transactions.getBatchDetail(original.batchId)
    expect(partialDetail.reversalChain.status).toBe('PARTIAL')
    const final = await postings.reversePostingBatch(
      commandContext('reversal_final'),
      {
        originalBatchId: original.batchId,
        amount: partialDetail.reversalChain.remainingAmount,
        reason: '最终精确闭合',
        idempotencyKey: `fund-e2e-reversal-final-${randomUUID()}`,
      },
    )
    expect(final.userShareRateSnapshot).toBe('30.00')

    const closed = await transactions.getBatchDetail(original.batchId)
    expect(closed.reversalChain).toMatchObject({
      originalAmount: '100.00',
      reversedAmount: '100.00',
      remainingAmount: '0.00',
      status: 'FULL',
    })
    expect(closed.reversalChain.reversals).toHaveLength(3)

    const reversalEntries = await prisma.fundLedgerEntry.groupBy({
      by: ['accountId', 'direction'],
      where: {
        batch: { reversalOfBatchId: original.batchId },
      },
      _sum: { amount: true },
    })
    const originalAmounts = new Map(
      original.entries.map(entry => [entry.accountId, entry.amount]),
    )
    expect(reversalEntries).toHaveLength(2)
    for (const entry of reversalEntries) {
      expect(entry.direction).toBe('DEBIT')
      expect(entry._sum.amount?.toFixed(2)).toBe(originalAmounts.get(entry.accountId))
    }

    const categoryAmounts = await prisma.fundPostingBatch.findMany({
      where: {
        OR: [
          { id: original.batchId },
          { reversalOfBatchId: original.batchId },
        ],
      },
      select: { businessAmount: true, businessCategorySnapshot: true },
    })
    expect(categoryAmounts.every(item => (
      item.businessCategorySnapshot === 'REVENUE'
    ))).toBe(true)
    expect(categoryAmounts.reduce(
      (total, item) => total + Number(item.businessAmount.toString()),
      0,
    )).toBe(0)

    await expect(prisma.$executeRaw`
      UPDATE fund_posting_batches
      SET summary = 'forbidden mutation'
      WHERE id = ${original.batchId}::uuid
    `).rejects.toBeDefined()
    await expect(prisma.$executeRaw`
      DELETE FROM fund_ledger_entries
      WHERE batch_id = ${original.batchId}::uuid
    `).rejects.toBeDefined()
    await expect(transactions.getBatchDetail(original.batchId)).resolves.toMatchObject({
      summary: originalDetail.summary,
      reversalChain: { status: 'FULL' },
    })
  })
})
