import type { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { AuditService } from '../../audit/audit.service'
import {
  INITIAL_FUND_POSTING_RULES,
  type FundPostingRule,
} from '../domain'
import { normalizePostBusinessEventRequest } from './fund-input.normalizer'
import {
  insertFundLedgerEntries,
  insertFundPostingBatch,
  lockFundAccountsForPosting,
  lockFundBusinessSourceForPosting,
  lockFundPostingTypeForPosting,
  readFundAccountIdentitiesForPosting,
  readFundPostingTransactionTimestamp,
  readFundSourceTypeAuthorization,
  readIdempotentFundPosting,
  updateFundAccountForPosting,
} from './fund-posting.persistence'
import { FundPostingApplicationService } from './fund-posting.service'
import { FundPostingError } from './fund-posting.errors'

jest.mock('./fund-posting.persistence')

const SOURCE_ID = '11111111-1111-4111-a111-111111111111'
const TYPE_ID = '22222222-2222-4222-a222-222222222222'
const RULE_ID = '33333333-3333-4333-a333-333333333333'
const USER_ID = '44444444-4444-4444-a444-444444444444'
const COMPANY_ACCOUNT_ID = '55555555-5555-4555-a555-555555555555'
const USER_ACCOUNT_ID = '99999999-9999-4999-a999-999999999999'
const AS_OF = new Date('2026-08-18T08:00:00.000Z')
const CONTEXT = {
  consumerCode: 'ORDER',
  sourceCode: 'ORDER_SYSTEM',
  requestId: 'request-1',
  correlationId: 'correlation-1',
}

const mockedReadTimestamp = jest.mocked(readFundPostingTransactionTimestamp)
const mockedReadReplay = jest.mocked(readIdempotentFundPosting)
const mockedLockSource = jest.mocked(lockFundBusinessSourceForPosting)
const mockedLockType = jest.mocked(lockFundPostingTypeForPosting)
const mockedReadAuthorization = jest.mocked(readFundSourceTypeAuthorization)
const mockedReadIdentities = jest.mocked(readFundAccountIdentitiesForPosting)
const mockedLockAccounts = jest.mocked(lockFundAccountsForPosting)
const mockedInsertBatch = jest.mocked(insertFundPostingBatch)
const mockedUpdateAccount = jest.mocked(updateFundAccountForPosting)
const mockedInsertEntries = jest.mocked(insertFundLedgerEntries)

function requireInitialRule(code: string): FundPostingRule {
  const rule = INITIAL_FUND_POSTING_RULES.find(item => (
    item.postingTypeCode === code
  ))
  if (rule === undefined) throw new Error(`missing test rule: ${code}`)
  return rule
}

function postingTypeRecord(rule: FundPostingRule) {
  return {
    id: TYPE_ID,
    code: rule.postingTypeCode,
    name: `测试-${rule.postingTypeCode}`,
    businessCategory: rule.businessCategory,
    requiresUser: rule.requiresUser,
    amountSignPolicy: rule.amountSignPolicy,
    inputMode: rule.inputMode,
    enabled: true,
    currentRuleVersionId: RULE_ID,
    ruleVersion: {
      id: RULE_ID,
      revision: 1,
      status: 'ACTIVE' as const,
      legs: rule.legs,
    },
  }
}

function userAccount() {
  return {
    id: USER_ACCOUNT_ID,
    ownerType: 'USER' as const,
    userId: USER_ID,
    balance: '10.00',
    userShareRate: '30.00',
    nextSequence: 7n,
    version: 2,
  }
}

function companyAccount() {
  return {
    id: COMPANY_ACCOUNT_ID,
    ownerType: 'COMPANY' as const,
    userId: null,
    balance: '100.00',
    userShareRate: null,
    nextSequence: 11n,
    version: 4,
  }
}

function businessInput(postingTypeCode = 'ORDER_SETTLEMENT') {
  return {
    postingTypeCode,
    userId: USER_ID,
    amount: '100',
    businessId: 'settlement-1',
    businessNo: '0000011',
    summary: '订单结算',
    metadata: { orderChannel: 'WEB', retry: false },
    idempotencyKey: 'order-settlement:settlement-1',
  }
}

function fixture() {
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue([]),
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
  const service = new FundPostingApplicationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { audit, prisma, service, transaction }
}

function configureSuccessfulPosting(rule: FundPostingRule): void {
  mockedReadTimestamp.mockResolvedValue(AS_OF)
  mockedReadReplay.mockResolvedValue(null)
  mockedLockSource.mockResolvedValue({
    id: SOURCE_ID,
    code: CONTEXT.sourceCode,
    name: '订单系统',
    enabled: true,
  })
  mockedLockType.mockResolvedValue(postingTypeRecord(rule))
  mockedReadAuthorization.mockResolvedValue(true)

  const requiresCompany = rule.legs.some(leg => leg.accountTarget === 'COMPANY')
  mockedReadIdentities.mockResolvedValue({
    userAccountId: rule.requiresUser ? USER_ACCOUNT_ID : null,
    companyAccountId: requiresCompany ? COMPANY_ACCOUNT_ID : null,
  })
  mockedLockAccounts.mockResolvedValue([
    ...(requiresCompany ? [companyAccount()] : []),
    ...(rule.requiresUser ? [userAccount()] : []),
  ])
  mockedInsertBatch.mockResolvedValue(undefined)
  mockedUpdateAccount.mockResolvedValue(true)
  mockedInsertEntries.mockResolvedValue(undefined)
}

function replayRecord(
  requestFingerprintHash: Buffer,
  postingTypeCode = 'ORDER_SETTLEMENT',
) {
  return {
    requestFingerprintHash,
    batchId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    postingTypeCode,
    businessCategory: 'REVENUE' as const,
    businessAmount: '100.00',
    userShareRateSnapshot: '30.00',
    companyShareRateSnapshot: '70.00',
    entries: [{
      entryId: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
      accountId: USER_ACCOUNT_ID,
      accountTarget: 'USER' as const,
      direction: 'CREDIT' as const,
      amount: '30.00',
      balanceBefore: '10.00',
      balanceAfter: '40.00',
      accountSequence: '7',
    }],
    postedAt: AS_OF,
  }
}

async function expectFundReject(
  promise: Promise<unknown>,
  code: string,
  field?: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(FundPostingError)
  await expect(promise).rejects.toMatchObject({
    code,
    ...(field === undefined ? {} : { field }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('FundPostingApplicationService business rules', () => {
  it.each([
    ['ORDER_SETTLEMENT', '100', 'CREDIT', 2],
    ['USER_WITHDRAWAL', '100', 'DEBIT', 1],
    ['PURCHASE_PAYMENT', '100', 'DEBIT', 2],
    ['RENT_UTILITIES', '100', 'DEBIT', 1],
    ['BUSINESS_ACCOUNT_FEE', '100', 'DEBIT', 2],
    ['ADVERTISING_FEE', '100', 'DEBIT', 2],
    ['NETWORK_IP_VPN_FEE', '100', 'DEBIT', 2],
    ['INVOICE_FEE', '100', 'DEBIT', 2],
  ] as const)(
    'posts %s through the unified business port',
    async (code, amount, direction, entryCount) => {
      const rule = requireInitialRule(code)
      configureSuccessfulPosting(rule)
      const { service } = fixture()
      const input = {
        ...businessInput(code),
        amount,
        ...(rule.requiresUser ? {} : { userId: undefined }),
      }

      const result = await service.postBusinessEvent(CONTEXT, input)

      expect(result).toMatchObject({
        postingTypeCode: code,
        businessCategory: rule.businessCategory,
        businessAmount: `${amount}.00`,
        idempotentReplay: false,
      })
      expect(result.entries).toHaveLength(entryCount)
      expect(result.entries.every(entry => entry.direction === direction)).toBe(true)
    },
  )

  it('posts a negative settlement by sharing the loss and permits negative balances', async () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')
    configureSuccessfulPosting(rule)
    const { audit, service, transaction } = fixture()

    const result = await service.postBusinessEvent(CONTEXT, {
      ...businessInput(),
      amount: '-100',
    })

    expect(result).toMatchObject({
      postingTypeCode: 'ORDER_SETTLEMENT',
      businessCategory: 'REVENUE',
      businessAmount: '-100.00',
      userShareRateSnapshot: '30.00',
      companyShareRateSnapshot: '70.00',
      postedAt: AS_OF.toISOString(),
      idempotentReplay: false,
      entries: [
        {
          accountId: USER_ACCOUNT_ID,
          accountTarget: 'USER',
          direction: 'DEBIT',
          amount: '30.00',
          balanceBefore: '10.00',
          balanceAfter: '-20.00',
          accountSequence: '7',
        },
        {
          accountId: COMPANY_ACCOUNT_ID,
          accountTarget: 'COMPANY',
          direction: 'DEBIT',
          amount: '70.00',
          balanceBefore: '100.00',
          balanceAfter: '30.00',
          accountSequence: '11',
        },
      ],
    })
    expect(mockedLockAccounts).toHaveBeenCalledWith(
      transaction,
      [COMPANY_ACCOUNT_ID, USER_ACCOUNT_ID],
    )
    expect(mockedInsertBatch).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        kind: 'BUSINESS',
        postingTypeId: TYPE_ID,
        postingTypeCodeSnapshot: 'ORDER_SETTLEMENT',
        businessCategorySnapshot: 'REVENUE',
        businessSourceId: SOURCE_ID,
        businessSourceCodeSnapshot: 'ORDER_SYSTEM',
        ruleVersionId: RULE_ID,
        ruleRevisionSnapshot: 1,
        userId: USER_ID,
        businessAmount: '-100.00',
        userShareRateSnapshot: '30.00',
        companyShareRateSnapshot: '70.00',
        businessId: 'settlement-1',
        businessNo: '0000011',
        businessOccurredAt: AS_OF,
        postedAt: AS_OF,
      }),
    )
    const batchInput = mockedInsertBatch.mock.calls[0]?.[1]
    expect(batchInput?.id).toMatch(/^[0-9a-f-]{36}$/u)
    expect(batchInput?.batchNo).toBe(
      `FUND_${batchInput?.id.replaceAll('-', '').toUpperCase()}`,
    )
    expect(mockedUpdateAccount.mock.calls.map(call => call[1].accountId)).toEqual([
      COMPANY_ACCOUNT_ID,
      USER_ACCOUNT_ID,
    ])
    expect(mockedUpdateAccount.mock.calls.map(call => call[1])).toEqual([
      {
        accountId: COMPANY_ACCOUNT_ID,
        expectedVersion: 4,
        expectedNextSequence: 11n,
        balanceAfter: '30.00',
        nextSequence: 12n,
        asOf: AS_OF,
      },
      {
        accountId: USER_ACCOUNT_ID,
        expectedVersion: 2,
        expectedNextSequence: 7n,
        balanceAfter: '-20.00',
        nextSequence: 8n,
        asOf: AS_OF,
      },
    ])
    expect(mockedInsertEntries).toHaveBeenCalledTimes(1)
    expect(mockedInsertEntries.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        lineNo: 1,
        accountId: USER_ACCOUNT_ID,
        accountSequence: 7n,
      }),
      expect.objectContaining({
        lineNo: 2,
        accountId: COMPANY_ACCOUNT_ID,
        accountSequence: 11n,
      }),
    ])
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'FUND_BUSINESS_POSTED',
        targetType: 'FundPostingBatch',
        targetId: result.batchId,
        requestId: 'request-1',
        correlationId: 'correlation-1',
      }),
    )
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mockedReadTimestamp.mock.invocationCallOrder[0],
    )
    expect(mockedReadTimestamp.mock.invocationCallOrder[0]).toBeLessThan(
      mockedReadReplay.mock.invocationCallOrder[0],
    )
    expect(mockedLockSource.mock.invocationCallOrder[0]).toBeLessThan(
      mockedLockType.mock.invocationCallOrder[0],
    )
    expect(mockedLockType.mock.invocationCallOrder[0]).toBeLessThan(
      mockedReadAuthorization.mock.invocationCallOrder[0],
    )
    expect(mockedReadIdentities.mock.invocationCallOrder[0]).toBeLessThan(
      mockedLockAccounts.mock.invocationCallOrder[0],
    )
    expect(mockedInsertBatch.mock.invocationCallOrder[0]).toBeLessThan(
      mockedUpdateAccount.mock.invocationCallOrder[0],
    )
    expect(mockedUpdateAccount.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mockedInsertEntries.mock.invocationCallOrder[0],
    )
    expect(mockedInsertEntries.mock.invocationCallOrder[0]).toBeLessThan(
      audit.record.mock.invocationCallOrder[0],
    )
  })

  it('omits a zero-value leg while keeping the batch strictly conserving', async () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')
    configureSuccessfulPosting(rule)
    mockedLockAccounts.mockResolvedValue([
      companyAccount(),
      { ...userAccount(), userShareRate: '0.00' },
    ])
    const { service } = fixture()

    const result = await service.postBusinessEvent(CONTEXT, businessInput())

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      accountTarget: 'COMPANY',
      amount: '100.00',
    })
    expect(mockedUpdateAccount).toHaveBeenCalledTimes(1)
  })

  it('rejects the reserved administrator type on the business port', async () => {
    const rule = requireInitialRule('ADMIN_MANUAL_ADJUSTMENT')
    configureSuccessfulPosting(rule)
    const { audit, service } = fixture()

    await expectFundReject(
      service.postBusinessEvent(CONTEXT, businessInput(rule.postingTypeCode)),
      'FUND_POSTING_TYPE_NOT_ALLOWED',
    )
    expect(mockedReadIdentities).not.toHaveBeenCalled()
    expect(mockedInsertBatch).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('enforces conditional user input without trusting caller account details', async () => {
    const required = requireInitialRule('USER_WITHDRAWAL')
    configureSuccessfulPosting(required)
    const missing = fixture()
    await expectFundReject(
      missing.service.postBusinessEvent(CONTEXT, {
        ...businessInput('USER_WITHDRAWAL'),
        userId: undefined,
      }),
      'FUND_USER_REQUIRED',
    )

    jest.clearAllMocks()
    const companyOnly = requireInitialRule('RENT_UTILITIES')
    configureSuccessfulPosting(companyOnly)
    const extra = fixture()
    await expectFundReject(
      extra.service.postBusinessEvent(CONTEXT, businessInput('RENT_UTILITIES')),
      'FUND_VALIDATION_FAILED',
      'userId',
    )
  })

  it('uses the normalized business occurrence time instead of replacing it', async () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')
    configureSuccessfulPosting(rule)
    const { service } = fixture()

    await service.postBusinessEvent(CONTEXT, {
      ...businessInput(),
      businessOccurredAt: '2026-08-17T00:00:00+08:00',
    })

    expect(mockedInsertBatch.mock.calls[0]?.[1].businessOccurredAt).toEqual(
      new Date('2026-08-16T16:00:00.000Z'),
    )
    expect(mockedInsertBatch.mock.calls[0]?.[1].postedAt).toBe(AS_OF)
  })
})

describe('FundPostingApplicationService idempotency and failures', () => {
  it('returns the original immutable result without new writes or Audit', async () => {
    const input = businessInput()
    const normalized = normalizePostBusinessEventRequest(CONTEXT, input)
    mockedReadTimestamp.mockResolvedValue(AS_OF)
    mockedReadReplay.mockResolvedValue(replayRecord(
      normalized.requestFingerprintHash,
    ))
    const { audit, service } = fixture()

    const result = await service.postBusinessEvent(CONTEXT, input)

    expect(result).toMatchObject({
      batchId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      idempotentReplay: true,
    })
    expect(mockedLockSource).not.toHaveBeenCalled()
    expect(mockedInsertBatch).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('uses timing-safe fingerprint semantics and rejects changed replay input', async () => {
    mockedReadTimestamp.mockResolvedValue(AS_OF)
    mockedReadReplay.mockResolvedValue(replayRecord(Buffer.alloc(32, 0xff)))
    const { service } = fixture()

    await expectFundReject(
      service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_IDEMPOTENCY_CONFLICT',
    )
  })

  it('recovers the unique-constraint winner in a second read-only transaction', async () => {
    const input = businessInput()
    const normalized = normalizePostBusinessEventRequest(CONTEXT, input)
    mockedReadReplay.mockResolvedValue(replayRecord(
      normalized.requestFingerprintHash,
    ))
    const { prisma, service, transaction } = fixture()
    prisma.$transaction
      .mockRejectedValueOnce({
        code: 'P2002',
        meta: {
          constraint: 'fund_posting_batches_consumer_source_idempotency_key',
        },
      })
      .mockImplementationOnce(callback => callback(transaction))

    const result = await service.postBusinessEvent(CONTEXT, input)

    expect(result.idempotentReplay).toBe(true)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1)
    expect(mockedLockSource).not.toHaveBeenCalled()
  })

  it('rejects unavailable configuration before resolving or locking accounts', async () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')
    configureSuccessfulPosting(rule)
    mockedLockSource.mockResolvedValue({
      id: SOURCE_ID,
      code: 'ORDER_SYSTEM',
      name: '订单系统',
      enabled: false,
    })
    const disabledSource = fixture()
    await expectFundReject(
      disabledSource.service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_BUSINESS_SOURCE_DISABLED',
    )

    jest.clearAllMocks()
    configureSuccessfulPosting(rule)
    mockedReadAuthorization.mockResolvedValue(false)
    const unauthorized = fixture()
    await expectFundReject(
      unauthorized.service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_POSTING_TYPE_NOT_ALLOWED',
    )
    expect(mockedReadIdentities).not.toHaveBeenCalled()
  })

  it('fails closed for missing, disabled or unpublished configuration', async () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')
    configureSuccessfulPosting(rule)
    mockedLockSource.mockResolvedValue(null)
    const missingSource = fixture()
    await expectFundReject(
      missingSource.service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_BUSINESS_SOURCE_NOT_FOUND',
    )

    jest.clearAllMocks()
    configureSuccessfulPosting(rule)
    mockedLockType.mockResolvedValue({
      ...postingTypeRecord(rule),
      enabled: false,
    })
    const disabledType = fixture()
    await expectFundReject(
      disabledType.service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_POSTING_TYPE_DISABLED',
    )

    jest.clearAllMocks()
    configureSuccessfulPosting(rule)
    mockedLockType.mockResolvedValue({
      ...postingTypeRecord(rule),
      currentRuleVersionId: null,
      ruleVersion: null,
    })
    const unpublished = fixture()
    await expectFundReject(
      unpublished.service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_POSTING_RULE_UNAVAILABLE',
    )
    expect(mockedReadIdentities).not.toHaveBeenCalled()
  })

  it('rejects an invalid stored rule before creating any batch facts', async () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')
    configureSuccessfulPosting(rule)
    mockedLockType.mockResolvedValue({
      ...postingTypeRecord(rule),
      ruleVersion: {
        id: RULE_ID,
        revision: 1,
        status: 'ACTIVE',
        legs: [],
      },
    })
    mockedReadIdentities.mockResolvedValue({
      userAccountId: USER_ACCOUNT_ID,
      companyAccountId: null,
    })
    mockedLockAccounts.mockResolvedValue([userAccount()])
    const { service } = fixture()

    await expectFundReject(
      service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_POSTING_RULE_INVALID',
    )
    expect(mockedInsertBatch).not.toHaveBeenCalled()
  })

  it('requires the singleton company account when the rule targets it', async () => {
    const rule = requireInitialRule('RENT_UTILITIES')
    configureSuccessfulPosting(rule)
    mockedReadIdentities.mockResolvedValue({
      userAccountId: null,
      companyAccountId: null,
    })
    const { service } = fixture()

    await expectFundReject(
      service.postBusinessEvent(CONTEXT, {
        ...businessInput('RENT_UTILITIES'),
        userId: undefined,
      }),
      'FUND_COMPANY_ACCOUNT_UNAVAILABLE',
    )
    expect(mockedLockAccounts).not.toHaveBeenCalled()
  })

  it('does not create ledger facts when an account is missing', async () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')
    configureSuccessfulPosting(rule)
    mockedReadIdentities.mockResolvedValue({
      userAccountId: null,
      companyAccountId: COMPANY_ACCOUNT_ID,
    })
    const { audit, service } = fixture()

    await expectFundReject(
      service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_ACCOUNT_NOT_FOUND',
    )
    expect(mockedLockAccounts).not.toHaveBeenCalled()
    expect(mockedInsertBatch).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('fails the transaction when account state or Audit persistence fails', async () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')
    configureSuccessfulPosting(rule)
    mockedUpdateAccount.mockResolvedValueOnce(false)
    const accountFailure = fixture()
    await expectFundReject(
      accountFailure.service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_CONCURRENT_STATE_CHANGED',
    )
    expect(mockedInsertEntries).not.toHaveBeenCalled()
    expect(accountFailure.audit.record).not.toHaveBeenCalled()

    jest.clearAllMocks()
    configureSuccessfulPosting(rule)
    const auditFailure = fixture()
    auditFailure.audit.record.mockRejectedValue(
      new Error('must-not-leak audit persistence detail'),
    )
    await expectFundReject(
      auditFailure.service.postBusinessEvent(CONTEXT, businessInput()),
      'FUND_INTERNAL_ERROR',
    )
  })
})


describe('sales receipt transaction ports', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    configureSuccessfulPosting(requireInitialRule('ORDER_SETTLEMENT'))
    mockedLockSource.mockResolvedValue({ id: SOURCE_ID, code: 'SALES_RECEIPT', name: '销售收款', enabled: true })
  })
  const context = { ...CONTEXT, sourceCode: 'SALES_RECEIPT', consumerCode: 'SALES_RECEIPT.APPROVE', actorUserId: SOURCE_ID }

  it('previews the locked rule and split without writing or opening a nested transaction', async () => {
    const { service, prisma, transaction } = fixture()
    const result = await service.previewBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, businessInput())
    expect(result).toMatchObject({ ruleVersionId: RULE_ID, userShareRate: '30.00', businessAmount: '100.00' })
    expect(result.entries.map(entry => entry.amount)).toEqual(['30.00', '70.00'])
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mockedInsertBatch).not.toHaveBeenCalled()
  })

  it('rejects changed locked share rate before all writes', async () => {
    const { service, transaction } = fixture()
    await expect(service.postBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, businessInput(), { ruleVersionId: RULE_ID, userShareRate: '29.00' })).rejects.toMatchObject({ code: 'FUND_CONCURRENT_STATE_CHANGED' })
    expect(mockedLockAccounts).toHaveBeenCalled()
    expect(mockedInsertBatch).not.toHaveBeenCalled()
  })

  it('rejects standalone receipt posting before opening a transaction', async () => {
    const { service, prisma } = fixture()
    await expect(service.postBusinessEvent({ ...CONTEXT, sourceCode: 'SALES_RECEIPT' }, businessInput())).rejects.toMatchObject({ code: 'FUND_POSTING_TYPE_NOT_ALLOWED' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('propagates database failure for the outer transaction to roll back', async () => {
    const { service, prisma, transaction } = fixture()
    const failure = new Error('unique-conflict')
    mockedInsertBatch.mockRejectedValue(failure)
    await expect(service.postBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, businessInput(), { ruleVersionId: RULE_ID, userShareRate: '30.00' })).rejects.toBe(failure)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mockedUpdateAccount).not.toHaveBeenCalled()
  })

  it('rejects a configured debit rule for receipt approval', async () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')
    mockedLockType.mockResolvedValue(postingTypeRecord({ ...rule, amountSignPolicy: 'POSITIVE_ONLY', legs: rule.legs.map(leg => ({ ...leg, directionPolicy: 'DEBIT' })) }))
    const { service, transaction } = fixture()
    await expect(service.previewBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, businessInput())).rejects.toMatchObject({ code: 'FUND_POSTING_RULE_UNAVAILABLE' })
    expect(mockedInsertBatch).not.toHaveBeenCalled()
  })

  it('rejects negative receipt income before ledger writes', async () => {
    const { service, transaction } = fixture()
    await expect(service.postBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, { ...businessInput(), amount: '-100.00' }, { ruleVersionId: RULE_ID, userShareRate: '30.00' })).rejects.toMatchObject({ code: 'FUND_POSTING_RULE_UNAVAILABLE' })
    expect(mockedInsertBatch).not.toHaveBeenCalled()
  })

  it('posts inside the caller transaction with the reviewer as actor', async () => {
    const { service, prisma, transaction, audit } = fixture()
    await service.postBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, businessInput(), { ruleVersionId: RULE_ID, userShareRate: '30.00' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mockedInsertBatch).toHaveBeenCalledWith(transaction, expect.objectContaining({ actorUserId: SOURCE_ID, userId: USER_ID }))
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({ actorUserId: SOURCE_ID, actorType: 'USER' }))
  })
})


describe('packaging cost transaction ports', () => {
  const context = { ...CONTEXT, sourceCode: 'PACKAGING_COST', consumerCode: 'PACKAGING_COST.PAY', actorUserId: SOURCE_ID }
  const input = () => ({ ...businessInput('WOODEN_PACKING_COST'), summary: '打木架费用付款' })
  const rule = (): FundPostingRule => ({ ...requireInitialRule('PURCHASE_PAYMENT'), postingTypeCode: 'WOODEN_PACKING_COST' })
  beforeEach(() => {
    jest.resetAllMocks()
    configureSuccessfulPosting(rule())
    mockedLockSource.mockResolvedValue({ id: SOURCE_ID, code: 'PACKAGING_COST', name: '打木架付款', enabled: true })
  })
  it('applies the configured owner share and company remainder in the caller transaction', async () => {
    const { service, transaction, prisma, audit } = fixture()
    const tx = transaction as unknown as Prisma.TransactionClient
    const preview = await service.previewBusinessEventInTransaction(tx, context, input())
    expect(preview.entries).toEqual([
      { accountTarget: 'USER', direction: 'DEBIT', amount: '30.00' },
      { accountTarget: 'COMPANY', direction: 'DEBIT', amount: '70.00' },
    ])
    await service.postBusinessEventInTransaction(tx, context, input(), preview)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mockedInsertBatch).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: USER_ID, actorUserId: SOURCE_ID, postingTypeCodeSnapshot: 'WOODEN_PACKING_COST', businessSourceCodeSnapshot: 'PACKAGING_COST' }))
    expect(mockedUpdateAccount).toHaveBeenCalledWith(tx, expect.objectContaining({ accountId: USER_ACCOUNT_ID, balanceAfter: '-20.00' }))
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ actorUserId: SOURCE_ID, actorType: 'USER' }))
  })
  it('cannot post independently of packaging payment', async () => {
    const { service, prisma } = fixture()
    await expect(service.postBusinessEvent({ ...CONTEXT, sourceCode: 'PACKAGING_COST', consumerCode: 'PACKAGING_COST.PAY' }, input())).rejects.toMatchObject({ code: 'FUND_POSTING_TYPE_NOT_ALLOWED' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it.each([
    { sourceCode: 'PACKAGING_COST', consumerCode: 'SALES_RECEIPT.APPROVE', postingTypeCode: 'WOODEN_PACKING_COST' },
    { sourceCode: 'SALES_RECEIPT', consumerCode: 'PACKAGING_COST.PAY', postingTypeCode: 'WOODEN_PACKING_COST' },
    { sourceCode: 'PACKAGING_COST', consumerCode: 'PACKAGING_COST.PAY', postingTypeCode: 'ORDER_SETTLEMENT' },
  ])('rejects mismatched business identity %j', async identity => {
    const { service, transaction } = fixture()
    await expect(service.previewBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, { ...context, ...identity }, { ...input(), postingTypeCode: identity.postingTypeCode })).rejects.toMatchObject({ code: 'FUND_POSTING_TYPE_NOT_ALLOWED' })
    expect(mockedLockSource).not.toHaveBeenCalled()
  })
  it.each(['CREDIT', 'REVENUE'] as const)('rejects a cost rule changed to %s', async invalid => {
    const base = rule()
    mockedLockType.mockResolvedValue(postingTypeRecord(invalid === 'CREDIT' ? { ...base, legs: base.legs.map(leg => ({ ...leg, directionPolicy: 'CREDIT' })) } : { ...base, businessCategory: 'REVENUE' }))
    const { service, transaction } = fixture()
    await expect(service.previewBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, input())).rejects.toMatchObject({ code: 'FUND_POSTING_RULE_UNAVAILABLE' })
    expect(mockedInsertBatch).not.toHaveBeenCalled()
  })
})


describe('purchase payment transaction ports', () => {
  const context = { ...CONTEXT, sourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PURCHASE_PAYMENT.PAY', actorUserId: SOURCE_ID }
  const stockContext = { ...context, consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY' }
  const input = () => ({ ...businessInput('PURCHASE_PAYMENT'), summary: '采购付款' })
  const stockInput = () => ({ ...input(), userId: undefined })
  beforeEach(() => {
    jest.resetAllMocks()
    configureSuccessfulPosting(requireInitialRule('PURCHASE_PAYMENT'))
    mockedLockSource.mockResolvedValue({ id: SOURCE_ID, code: 'PURCHASE_PAYMENT', name: '采购付款', enabled: true })
  })
  function configureStockAccounts() {
    mockedReadIdentities.mockResolvedValue({ userAccountId: null, companyAccountId: COMPANY_ACCOUNT_ID })
    mockedLockAccounts.mockResolvedValue([companyAccount()])
  }

  it('locks the complete sorted account union before a mixed-owner batch without posting any entry', async () => {
    const { service, transaction, prisma } = fixture()
    const tx = transaction as unknown as Prisma.TransactionClient
    const otherAccount = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    mockedReadIdentities.mockResolvedValueOnce({ userAccountId: otherAccount, companyAccountId: COMPANY_ACCOUNT_ID })
      .mockResolvedValueOnce({ userAccountId: null, companyAccountId: COMPANY_ACCOUNT_ID })
      .mockResolvedValueOnce({ userAccountId: USER_ACCOUNT_ID, companyAccountId: COMPANY_ACCOUNT_ID })
    await service.lockBusinessEventAccountsInTransaction(tx, [
      { context, input: input() }, { context: stockContext, input: stockInput() }, { context, input: input() },
    ])
    expect(mockedLockAccounts).toHaveBeenCalledTimes(1)
    expect(mockedLockAccounts).toHaveBeenCalledWith(tx, [otherAccount, USER_ACCOUNT_ID, COMPANY_ACCOUNT_ID].sort())
    expect(mockedInsertBatch).not.toHaveBeenCalled()
    expect(mockedUpdateAccount).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('posts sales-linked costs to the issuer and company using the configured share', async () => {
    const { service, transaction, prisma } = fixture()
    const tx = transaction as unknown as Prisma.TransactionClient
    const preview = await service.previewBusinessEventInTransaction(tx, context, input())
    expect(preview.entries).toEqual([
      { accountTarget: 'USER', direction: 'DEBIT', amount: '30.00' },
      { accountTarget: 'COMPANY', direction: 'DEBIT', amount: '70.00' },
    ])
    await service.postBusinessEventInTransaction(tx, context, input(), preview)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mockedInsertBatch).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: USER_ID, actorUserId: SOURCE_ID, consumerCode: 'PURCHASE_PAYMENT.PAY', postingTypeCodeSnapshot: 'PURCHASE_PAYMENT' }))
  })

  it('posts stock costs with a zero effective user share and only the company account', async () => {
    configureStockAccounts()
    const rule = postingTypeRecord(requireInitialRule('PURCHASE_PAYMENT'))
    mockedLockType.mockResolvedValue(rule)
    const originalRule = structuredClone(rule)
    const { service, transaction, prisma } = fixture()
    const tx = transaction as unknown as Prisma.TransactionClient
    const preview = await service.previewBusinessEventInTransaction(tx, stockContext, stockInput())
    expect(preview).toMatchObject({ ruleVersionId: RULE_ID, userShareRate: '0.00', companyShareRate: '100.00', entries: [{ accountTarget: 'COMPANY', direction: 'DEBIT', amount: '100.00' }] })
    const posted = await service.postBusinessEventInTransaction(tx, stockContext, stockInput(), preview)
    expect(posted.entries).toHaveLength(1)
    expect(mockedReadIdentities).toHaveBeenCalledWith(tx, { userId: null, requireUserAccount: false, requireCompanyAccount: true })
    expect(mockedLockAccounts).toHaveBeenCalledWith(tx, [COMPANY_ACCOUNT_ID])
    expect(mockedInsertBatch).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: null, userShareRateSnapshot: '0.00', companyShareRateSnapshot: '100.00', ruleVersionId: RULE_ID, consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY' }))
    expect(mockedInsertEntries.mock.calls[0]?.[1]).toEqual([expect.objectContaining({ accountTarget: 'COMPANY', amountStrategy: 'COMPANY_REMAINDER', amount: '100.00' })])
    expect(mockedUpdateAccount).toHaveBeenCalledTimes(1)
    expect(rule).toEqual(originalRule)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each(['PURCHASE_PAYMENT.PAY', 'PURCHASE_PAYMENT.STOCK_PAY'])('rejects standalone %s without starting a transaction', async consumerCode => {
    const { service, prisma } = fixture()
    await expect(service.postBusinessEvent({ ...CONTEXT, sourceCode: 'PURCHASE_PAYMENT', consumerCode }, input())).rejects.toMatchObject({ code: 'FUND_POSTING_TYPE_NOT_ALLOWED' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a missing issuer or an injected stock owner before account resolution', async () => {
    const { service, transaction } = fixture()
    const tx = transaction as unknown as Prisma.TransactionClient
    await expect(service.previewBusinessEventInTransaction(tx, context, stockInput())).rejects.toMatchObject({ code: 'FUND_USER_REQUIRED' })
    await expect(service.previewBusinessEventInTransaction(tx, stockContext, input())).rejects.toMatchObject({ code: 'FUND_VALIDATION_FAILED', field: 'userId' })
    expect(mockedReadIdentities).not.toHaveBeenCalled()
  })

  it.each([
    { sourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PACKAGING_COST.PAY', postingTypeCode: 'PURCHASE_PAYMENT' },
    { sourceCode: 'PACKAGING_COST', consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY', postingTypeCode: 'PURCHASE_PAYMENT' },
    { sourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY', postingTypeCode: 'WOODEN_PACKING_COST' },
  ])('rejects mismatched purchase identity %j', async identity => {
    const { service, transaction } = fixture()
    await expect(service.previewBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, { ...stockContext, ...identity }, { ...stockInput(), postingTypeCode: identity.postingTypeCode })).rejects.toMatchObject({ code: 'FUND_POSTING_TYPE_NOT_ALLOWED' })
    expect(mockedLockSource).not.toHaveBeenCalled()
  })

  it.each(['credit', 'revenue', 'user-only'] as const)('rejects stock rule %s instead of replacing configured legs', async invalid => {
    configureStockAccounts()
    const base = requireInitialRule('PURCHASE_PAYMENT')
    mockedLockType.mockResolvedValue(postingTypeRecord(invalid === 'credit'
      ? { ...base, legs: base.legs.map(leg => ({ ...leg, directionPolicy: 'CREDIT' })) }
      : invalid === 'revenue' ? { ...base, businessCategory: 'REVENUE' }
        : { ...base, legs: [{ position: 1, accountTarget: 'USER', directionPolicy: 'DEBIT', amountStrategy: 'FULL_AMOUNT' }] }))
    const { service, transaction } = fixture()
    await expect(service.previewBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, stockContext, stockInput())).rejects.toMatchObject({ code: 'FUND_POSTING_RULE_UNAVAILABLE' })
    expect(mockedInsertBatch).not.toHaveBeenCalled()
  })

  it('requires a company account and rejects stale stock preview without writes', async () => {
    configureStockAccounts()
    mockedReadIdentities.mockResolvedValueOnce({ userAccountId: null, companyAccountId: null })
    const { service, transaction } = fixture()
    const tx = transaction as unknown as Prisma.TransactionClient
    await expect(service.previewBusinessEventInTransaction(tx, stockContext, stockInput())).rejects.toMatchObject({ code: 'FUND_COMPANY_ACCOUNT_UNAVAILABLE' })
    await expect(service.postBusinessEventInTransaction(tx, stockContext, stockInput(), { ruleVersionId: RULE_ID, userShareRate: '30.00' })).rejects.toMatchObject({ code: 'FUND_CONCURRENT_STATE_CHANGED' })
    expect(mockedInsertBatch).not.toHaveBeenCalled()
  })

  it('replays the same stock payment without re-resolving accounts or writing', async () => {
    configureStockAccounts()
    const normalized = normalizePostBusinessEventRequest({ ...CONTEXT, sourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY' }, stockInput())
    mockedReadReplay.mockResolvedValue({ ...replayRecord(normalized.requestFingerprintHash, 'PURCHASE_PAYMENT'), businessCategory: 'COST', userShareRateSnapshot: '0.00', companyShareRateSnapshot: '100.00' })
    const { service, transaction } = fixture()
    const result = await service.postBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, stockContext, stockInput(), { ruleVersionId: RULE_ID, userShareRate: '0.00' })
    expect(result.idempotentReplay).toBe(true)
    expect(mockedReadIdentities).not.toHaveBeenCalled()
    expect(mockedInsertBatch).not.toHaveBeenCalled()
  })
})
