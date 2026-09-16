import type { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import {
  AuditService,
  type RecordAuditEventInput,
} from '../../audit/audit.service'
import { normalizeFundReversalRequest } from './fund-input.normalizer'
import {
  insertFundLedgerEntries,
  lockFundAccountsForPosting,
  readFundPostingTransactionTimestamp,
  readIdempotentFundPosting,
  updateFundAccountForPosting,
} from './fund-posting.persistence'
import { FundPostingApplicationService } from './fund-posting.service'
import { FundPostingError } from './fund-posting.errors'
import {
  insertFundReversalBatch,
  lockFundOriginalBatchForReversal,
  readFundOriginalEntriesForReversal,
  readFundReversalTargetIdentity,
} from './fund-reversal.persistence'

jest.mock('./fund-posting.persistence')
jest.mock('./fund-reversal.persistence')

const ORIGINAL_BATCH_ID = '11111111-1111-4111-a111-111111111111'
const SOURCE_ID = '22222222-2222-4222-a222-222222222222'
const TYPE_ID = '33333333-3333-4333-a333-333333333333'
const RULE_ID = '44444444-4444-4444-a444-444444444444'
const USER_ID = '55555555-5555-4555-a555-555555555555'
const USER_ACCOUNT_ID = '66666666-6666-4666-a666-666666666666'
const COMPANY_ACCOUNT_ID = '77777777-7777-4777-a777-777777777777'
const ACTOR_ID = '88888888-8888-4888-a888-888888888888'
const AS_OF = new Date('2026-08-18T10:00:00.000Z')
const CONTEXT = {
  actorUserId: ACTOR_ID,
  requestId: 'request-1',
  correlationId: 'correlation-1',
}

const mockedTimestamp = jest.mocked(readFundPostingTransactionTimestamp)
const mockedReplay = jest.mocked(readIdempotentFundPosting)
const mockedLockAccounts = jest.mocked(lockFundAccountsForPosting)
const mockedUpdateAccount = jest.mocked(updateFundAccountForPosting)
const mockedInsertEntries = jest.mocked(insertFundLedgerEntries)
const mockedReadIdentity = jest.mocked(readFundReversalTargetIdentity)
const mockedLockOriginal = jest.mocked(lockFundOriginalBatchForReversal)
const mockedReadEntries = jest.mocked(readFundOriginalEntriesForReversal)
const mockedInsertReversal = jest.mocked(insertFundReversalBatch)

function userAccount(balance = '10.00') {
  return {
    id: USER_ACCOUNT_ID,
    ownerType: 'USER' as const,
    userId: USER_ID,
    balance,
    userShareRate: '30.00',
    nextSequence: 7n,
    version: 2,
  }
}

function companyAccount(balance = '100.00') {
  return {
    id: COMPANY_ACCOUNT_ID,
    ownerType: 'COMPANY' as const,
    userId: null,
    balance,
    userShareRate: null,
    nextSequence: 11n,
    version: 4,
  }
}

function originalBatch(options?: {
  readonly kind?: 'BUSINESS' | 'MANUAL_ADJUSTMENT' | 'REVERSAL'
  readonly businessAmount?: string
  readonly category?: 'REVENUE' | 'COST' | 'NEUTRAL' | 'ADJUSTMENT'
  readonly postingTypeCode?: string
  readonly adjustmentMode?: 'USER_ONLY' | 'USER_AND_COMPANY_BY_SHARE' | null
}) {
  return {
    id: ORIGINAL_BATCH_ID,
    kind: options?.kind ?? 'BUSINESS',
    postingTypeId: TYPE_ID,
    postingTypeCode: options?.postingTypeCode ?? 'ORDER_SETTLEMENT',
    businessCategory: options?.category ?? 'REVENUE',
    businessSourceId: SOURCE_ID,
    businessSourceCode: 'ORDER_SYSTEM',
    ruleVersionId: RULE_ID,
    userId: USER_ID,
    businessAmount: options?.businessAmount ?? '100.00',
    userShareRateSnapshot: '30.00',
    companyShareRateSnapshot: '70.00',
    adjustmentMode: options?.adjustmentMode ?? null,
  }
}

function splitEntries(
  direction: 'CREDIT' | 'DEBIT',
  reversed: readonly [string, string] = ['0.00', '0.00'],
) {
  return {
    entries: [
      {
        originalLineNo: 1,
        accountId: USER_ACCOUNT_ID,
        accountTarget: 'USER' as const,
        direction,
        amountStrategy: 'USER_SHARE' as const,
        amount: '30.00',
        reversedAmount: reversed[0],
      },
      {
        originalLineNo: 2,
        accountId: COMPANY_ACCOUNT_ID,
        accountTarget: 'COMPANY' as const,
        direction,
        amountStrategy: 'COMPANY_REMAINDER' as const,
        amount: '70.00',
        reversedAmount: reversed[1],
      },
    ],
    cumulativeReversedBusinessAmount: '0.00',
    cumulativeReversedEntryAmount: '0.00',
  }
}

function fullUserEntry(
  direction: 'CREDIT' | 'DEBIT',
  reversedAmount = '0.00',
) {
  return {
    entries: [{
      originalLineNo: 1,
      accountId: USER_ACCOUNT_ID,
      accountTarget: 'USER' as const,
      direction,
      amountStrategy: 'FULL_AMOUNT' as const,
      amount: '100.00',
      reversedAmount,
    }],
    cumulativeReversedBusinessAmount: reversedAmount,
    cumulativeReversedEntryAmount: reversedAmount,
  }
}

function input(amount = '40') {
  return {
    originalBatchId: ORIGINAL_BATCH_ID,
    amount,
    reason: '冲销错误金额',
    idempotencyKey: 'reversal:original-1:part-1',
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

function configureSuccessfulReversal(options?: {
  readonly batch?: ReturnType<typeof originalBatch>
  readonly entries?: ReturnType<typeof splitEntries> | ReturnType<typeof fullUserEntry>
  readonly accounts?: readonly [
    ReturnType<typeof companyAccount>,
    ReturnType<typeof userAccount>,
  ] | readonly [ReturnType<typeof userAccount>]
}): void {
  const batch = options?.batch ?? originalBatch()
  mockedTimestamp.mockResolvedValue(AS_OF)
  mockedReadIdentity.mockResolvedValue({
    id: ORIGINAL_BATCH_ID,
    businessSourceCode: batch.businessSourceCode,
  })
  mockedReplay.mockResolvedValue(null)
  mockedLockOriginal.mockResolvedValue(batch)
  mockedReadEntries.mockResolvedValue(options?.entries ?? splitEntries('CREDIT'))
  mockedLockAccounts.mockResolvedValue(
    options?.accounts ?? [companyAccount(), userAccount()],
  )
  mockedInsertReversal.mockResolvedValue(undefined)
  mockedUpdateAccount.mockResolvedValue(true)
  mockedInsertEntries.mockResolvedValue(undefined)
}

function replayRecord(requestFingerprintHash: Buffer) {
  return {
    requestFingerprintHash,
    batchId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    postingTypeCode: 'ORDER_SETTLEMENT',
    businessCategory: 'REVENUE' as const,
    businessAmount: '-40.00',
    userShareRateSnapshot: '30.00',
    companyShareRateSnapshot: '70.00',
    entries: [{
      entryId: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
      accountId: USER_ACCOUNT_ID,
      accountTarget: 'USER' as const,
      direction: 'DEBIT' as const,
      amount: '12.00',
      balanceBefore: '10.00',
      balanceAfter: '-2.00',
      accountSequence: '7',
    }],
    postedAt: AS_OF,
  }
}

async function expectFundReject(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(FundPostingError)
  await expect(promise).rejects.toMatchObject({ code })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('FundPostingApplicationService reversal scenarios', () => {
  it.each([
    ['positive revenue', originalBatch(), splitEntries('CREDIT'), 'DEBIT', 2],
    [
      'negative revenue',
      originalBatch({ businessAmount: '-100.00' }),
      splitEntries('DEBIT'),
      'CREDIT',
      2,
    ],
    [
      'cost',
      originalBatch({
        category: 'COST',
        postingTypeCode: 'PURCHASE_PAYMENT',
      }),
      splitEntries('DEBIT'),
      'CREDIT',
      2,
    ],
    [
      'withdrawal',
      originalBatch({
        category: 'NEUTRAL',
        postingTypeCode: 'USER_WITHDRAWAL',
      }),
      fullUserEntry('DEBIT'),
      'CREDIT',
      1,
    ],
    [
      'USER_ONLY adjustment',
      originalBatch({
        kind: 'MANUAL_ADJUSTMENT',
        category: 'ADJUSTMENT',
        postingTypeCode: 'ADMIN_MANUAL_ADJUSTMENT',
        adjustmentMode: 'USER_ONLY',
      }),
      fullUserEntry('CREDIT'),
      'DEBIT',
      1,
    ],
    [
      'shared negative adjustment',
      originalBatch({
        kind: 'MANUAL_ADJUSTMENT',
        businessAmount: '-100.00',
        category: 'ADJUSTMENT',
        postingTypeCode: 'ADMIN_MANUAL_ADJUSTMENT',
        adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
      }),
      splitEntries('DEBIT'),
      'CREDIT',
      2,
    ],
  ] as const)('reverses %s from immutable snapshots', async (
    _name,
    batch,
    entries,
    expectedDirection,
    expectedEntryCount,
  ) => {
    configureSuccessfulReversal({
      batch,
      entries,
      accounts: expectedEntryCount === 1
        ? [userAccount()]
        : [companyAccount(), userAccount()],
    })
    const { audit, service } = fixture()

    const result = await service.reversePostingBatch(CONTEXT, input())

    expect(result).toMatchObject({
      postingTypeCode: batch.postingTypeCode,
      businessCategory: batch.businessCategory,
      businessAmount: batch.businessAmount.startsWith('-')
        ? '40.00'
        : '-40.00',
      userShareRateSnapshot: '30.00',
      companyShareRateSnapshot: '70.00',
      postedAt: AS_OF.toISOString(),
      idempotentReplay: false,
    })
    expect(result.entries).toHaveLength(expectedEntryCount)
    expect(result.entries.every(entry => (
      entry.direction === expectedDirection
    ))).toBe(true)
    if (_name === 'positive revenue') {
      expect(result.entries.find(entry => entry.accountTarget === 'USER'))
        .toMatchObject({
          balanceBefore: '10.00',
          balanceAfter: '-2.00',
        })
    }
    expect(mockedInsertReversal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        originalBatchId: ORIGINAL_BATCH_ID,
        businessAmount: result.businessAmount,
        consumerCode: 'ADMIN_REVERSAL',
        reason: '冲销错误金额',
        actorUserId: ACTOR_ID,
        postedAt: AS_OF,
      }),
    )
    const auditInput = audit.record.mock.calls[0]?.[1] as
      | RecordAuditEventInput
      | undefined
    expect(auditInput).toMatchObject({
      eventType: 'FUND_POSTING_REVERSED',
      actorType: 'USER',
      actorUserId: ACTOR_ID,
      targetType: 'FundPostingBatch',
      metadata: {
        originalBatchId: ORIGINAL_BATCH_ID,
        reversalAmount: '40.00',
        reversalState: 'PARTIAL',
      },
    })
  })

  it('uses cumulative targets and closes the final reversal exactly', async () => {
    const entries = splitEntries('CREDIT', ['20.00', '46.66'])
    entries.cumulativeReversedBusinessAmount = '66.66'
    entries.cumulativeReversedEntryAmount = '66.66'
    configureSuccessfulReversal({ entries })
    const { audit, service } = fixture()

    const result = await service.reversePostingBatch(CONTEXT, input('33.34'))

    expect(result.entries.map(entry => entry.amount)).toEqual([
      '10.00',
      '23.34',
    ])
    expect(mockedInsertReversal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ businessAmount: '-33.34' }),
    )
    const auditInput = audit.record.mock.calls[0]?.[1] as
      | RecordAuditEventInput
      | undefined
    expect(auditInput?.metadata).toMatchObject({
      reversalAmount: '33.34',
      reversalState: 'FULL',
    })
  })

  it('locks the target before aggregation and locks accounts in UUID order', async () => {
    configureSuccessfulReversal()
    const { service, transaction } = fixture()

    await service.reversePostingBatch(CONTEXT, input())

    expect(mockedLockOriginal).toHaveBeenCalledWith(
      transaction,
      ORIGINAL_BATCH_ID,
    )
    expect(mockedLockOriginal.mock.invocationCallOrder[0]).toBeLessThan(
      mockedReadEntries.mock.invocationCallOrder[0] ?? 0,
    )
    expect(mockedReplay).toHaveBeenCalledTimes(2)
    expect(mockedReplay.mock.invocationCallOrder[1]).toBeLessThan(
      mockedReadEntries.mock.invocationCallOrder[0] ?? 0,
    )
    expect(mockedLockAccounts).toHaveBeenCalledWith(transaction, [
      USER_ACCOUNT_ID,
      COMPANY_ACCOUNT_ID,
    ].sort())
    expect(mockedUpdateAccount.mock.calls.map(call => call[1].accountId))
      .toEqual([USER_ACCOUNT_ID, COMPANY_ACCOUNT_ID].sort())
  })
})

describe('FundPostingApplicationService reversal idempotency and failures', () => {
  it('returns a matching replay without locking or writing', async () => {
    const request = normalizeFundReversalRequest(input())
    configureSuccessfulReversal()
    mockedReplay.mockResolvedValue(replayRecord(request.requestFingerprintHash))
    const { audit, service } = fixture()

    const result = await service.reversePostingBatch(CONTEXT, input())

    expect(result.idempotentReplay).toBe(true)
    expect(mockedLockOriginal).not.toHaveBeenCalled()
    expect(mockedInsertReversal).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rejects the same idempotency key with a different fingerprint', async () => {
    configureSuccessfulReversal()
    mockedReplay.mockResolvedValue(replayRecord(Buffer.alloc(32, 0xff)))
    const { service } = fixture()

    await expectFundReject(
      service.reversePostingBatch(CONTEXT, input()),
      'FUND_IDEMPOTENCY_CONFLICT',
    )
  })

  it('recovers a unique-constraint winner without posting again', async () => {
    const request = normalizeFundReversalRequest(input())
    configureSuccessfulReversal()
    mockedReplay.mockResolvedValue(replayRecord(request.requestFingerprintHash))
    const { prisma, service, transaction } = fixture()
    prisma.$transaction
      .mockRejectedValueOnce({
        code: 'P2002',
        meta: {
          constraint: 'fund_posting_batches_consumer_source_idempotency_key',
        },
      })
      .mockImplementationOnce(callback => callback(transaction))

    const result = await service.reversePostingBatch(CONTEXT, input())

    expect(result.idempotentReplay).toBe(true)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(mockedInsertReversal).not.toHaveBeenCalled()
  })

  it('rejects missing and reversal targets without ledger writes', async () => {
    configureSuccessfulReversal()
    mockedReadIdentity.mockResolvedValue(null)
    const missing = fixture()
    await expectFundReject(
      missing.service.reversePostingBatch(CONTEXT, input()),
      'FUND_POSTING_BATCH_NOT_FOUND',
    )

    jest.clearAllMocks()
    configureSuccessfulReversal({
      batch: originalBatch({ kind: 'REVERSAL' }),
    })
    const reversal = fixture()
    await expectFundReject(
      reversal.service.reversePostingBatch(CONTEXT, input()),
      'FUND_REVERSAL_TARGET_INVALID',
    )
    expect(mockedInsertReversal).not.toHaveBeenCalled()
  })

  it('rejects a zero reversal amount before opening a transaction', async () => {
    const { prisma, service } = fixture()

    await expectFundReject(
      service.reversePostingBatch(CONTEXT, input('0')),
      'FUND_POSTING_AMOUNT_INVALID',
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects excessive and inconsistent historical totals', async () => {
    const excessive = splitEntries('CREDIT', ['18.00', '42.00'])
    excessive.cumulativeReversedBusinessAmount = '60.00'
    excessive.cumulativeReversedEntryAmount = '60.00'
    configureSuccessfulReversal({ entries: excessive })
    const excessiveFixture = fixture()
    await expectFundReject(
      excessiveFixture.service.reversePostingBatch(CONTEXT, input('41')),
      'FUND_REVERSAL_EXCEEDS_REMAINING',
    )

    jest.clearAllMocks()
    const inconsistent = splitEntries('CREDIT', ['12.00', '28.00'])
    inconsistent.cumulativeReversedBusinessAmount = '39.00'
    inconsistent.cumulativeReversedEntryAmount = '40.00'
    configureSuccessfulReversal({ entries: inconsistent })
    const invalidFixture = fixture()
    await expectFundReject(
      invalidFixture.service.reversePostingBatch(CONTEXT, input()),
      'FUND_REVERSAL_SNAPSHOT_INVALID',
    )
    expect(mockedInsertReversal).not.toHaveBeenCalled()
  })

  it('rolls back the write path when account state or Audit fails', async () => {
    configureSuccessfulReversal()
    mockedUpdateAccount.mockResolvedValueOnce(false)
    const accountFailure = fixture()
    await expectFundReject(
      accountFailure.service.reversePostingBatch(CONTEXT, input()),
      'FUND_REVERSAL_STATE_CHANGED',
    )
    expect(mockedInsertEntries).not.toHaveBeenCalled()
    expect(accountFailure.audit.record).not.toHaveBeenCalled()

    jest.clearAllMocks()
    configureSuccessfulReversal()
    const auditFailure = fixture()
    auditFailure.audit.record.mockRejectedValue(new Error('must-not-leak'))
    await expectFundReject(
      auditFailure.service.reversePostingBatch(CONTEXT, input()),
      'FUND_INTERNAL_ERROR',
    )
  })
})


describe('sales receipt full reversal', () => {
  const context = { ...CONTEXT, sourceCode: 'SALES_RECEIPT', consumerCode: 'SALES_RECEIPT.VOID' }
  beforeEach(() => {
    jest.resetAllMocks()
    configureSuccessfulReversal({ batch: { ...originalBatch(), businessSourceCode: 'SALES_RECEIPT' } })
  })

  it('blocks administrator reversal under the original batch lock', async () => {
    const { service } = fixture()
    await expect(service.reversePostingBatch(CONTEXT, input('100'))).rejects.toMatchObject({ code: 'FUND_REVERSAL_REQUIRES_RECEIPT_VOID' })
    expect(mockedLockOriginal).toHaveBeenCalled()
    expect(mockedInsertReversal).not.toHaveBeenCalled()
  })

  it('reverses the original entries in the caller transaction, allowing negative balances', async () => {
    const { service, transaction, prisma } = fixture()
    const result = await service.reverseBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, input('100'))
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountTarget: 'USER', amount: '30.00', balanceAfter: '-20.00' }),
      expect.objectContaining({ accountTarget: 'COMPANY', amount: '70.00', balanceAfter: '30.00' }),
    ]))
    expect(mockedInsertReversal).toHaveBeenCalledWith(transaction, expect.objectContaining({ consumerCode: 'SALES_RECEIPT.VOID', actorUserId: ACTOR_ID }))
  })

  it('rejects a partial reversal request', async () => {
    const { service, transaction } = fixture()
    await expect(service.reverseBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, input('40'))).rejects.toMatchObject({ code: 'FUND_REVERSAL_STATE_CHANGED' })
    expect(mockedInsertReversal).not.toHaveBeenCalled()
  })

  it('rejects any pre-existing partial reversal instead of deducting twice', async () => {
    const prior = splitEntries('CREDIT', ['3.00', '7.00'])
    mockedReadEntries.mockResolvedValue({ ...prior, cumulativeReversedBusinessAmount: '10.00', cumulativeReversedEntryAmount: '10.00' })
    const { service, transaction } = fixture()
    await expect(service.reverseBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, input('100'))).rejects.toMatchObject({ code: 'FUND_REVERSAL_STATE_CHANGED' })
    expect(mockedInsertReversal).not.toHaveBeenCalled()
  })

  it.each(['0.00', '100.00'])('reverses only the actual nonzero entry at %s percent', async (shareRate) => {
    const target = shareRate === '0.00' ? 'COMPANY' as const : 'USER' as const
    mockedLockOriginal.mockResolvedValue({ ...originalBatch(), businessSourceCode: 'SALES_RECEIPT', userShareRateSnapshot: shareRate, companyShareRateSnapshot: shareRate === '0.00' ? '100.00' : '0.00' })
    mockedReadEntries.mockResolvedValue({
      entries: [{ originalLineNo: 1, accountId: target === 'USER' ? USER_ACCOUNT_ID : COMPANY_ACCOUNT_ID, accountTarget: target, direction: 'CREDIT', amountStrategy: target === 'USER' ? 'USER_SHARE' : 'COMPANY_REMAINDER', amount: '100.00', reversedAmount: '0.00' }],
      cumulativeReversedBusinessAmount: '0.00', cumulativeReversedEntryAmount: '0.00',
    })
    const { service, transaction } = fixture()
    const result = await service.reverseBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, input('100'))
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ accountTarget: target, amount: '100.00', direction: 'DEBIT' })
    expect(mockedLockAccounts).toHaveBeenCalledWith(transaction, [target === 'USER' ? USER_ACCOUNT_ID : COMPANY_ACCOUNT_ID])
  })
})


describe('purchase payment controlled full reversal', () => {
  const context = { ...CONTEXT, sourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PURCHASE_PAYMENT.VOID' }
  beforeEach(() => {
    jest.resetAllMocks()
    configureSuccessfulReversal({ batch: { ...originalBatch({ category: 'COST', postingTypeCode: 'PURCHASE_PAYMENT' }), businessSourceCode: 'PURCHASE_PAYMENT' }, entries: splitEntries('DEBIT') })
  })

  it('rejects administrator reversal of a purchase payment', async () => {
    const { service } = fixture()
    await expect(service.reversePostingBatch(CONTEXT, input('100'))).rejects.toMatchObject({ code: 'FUND_REVERSAL_TARGET_INVALID' })
    expect(mockedInsertReversal).not.toHaveBeenCalled()
  })

  it('restores the original issuer and company accounts in the caller transaction', async () => {
    const { service, transaction, prisma } = fixture()
    const result = await service.reverseBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, input('100'))
    expect(result.entries.map(entry => [entry.accountTarget, entry.direction, entry.amount])).toEqual([['USER', 'CREDIT', '30.00'], ['COMPANY', 'CREDIT', '70.00']])
    expect(mockedInsertReversal).toHaveBeenCalledWith(transaction, expect.objectContaining({ consumerCode: 'PURCHASE_PAYMENT.VOID', originalBatchId: ORIGINAL_BATCH_ID }))
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('restores a company-only stock payment without resolving a user account', async () => {
    mockedLockOriginal.mockResolvedValue({ ...originalBatch({ category: 'COST', postingTypeCode: 'PURCHASE_PAYMENT' }), businessSourceCode: 'PURCHASE_PAYMENT', userId: null, userShareRateSnapshot: '0.00', companyShareRateSnapshot: '100.00' })
    mockedReadEntries.mockResolvedValue({ entries: [{ originalLineNo: 1, accountId: COMPANY_ACCOUNT_ID, accountTarget: 'COMPANY', direction: 'DEBIT', amountStrategy: 'COMPANY_REMAINDER', amount: '100.00', reversedAmount: '0.00' }], cumulativeReversedBusinessAmount: '0.00', cumulativeReversedEntryAmount: '0.00' })
    mockedLockAccounts.mockResolvedValue([companyAccount()])
    const { service, transaction } = fixture()
    const result = await service.reverseBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, input('100'))
    expect(result.entries).toEqual([expect.objectContaining({ accountTarget: 'COMPANY', direction: 'CREDIT', amount: '100.00' })])
    expect(mockedLockAccounts).toHaveBeenCalledWith(transaction, [COMPANY_ACCOUNT_ID])
  })

  it('rejects partial purchase reversal and previously reversed payments', async () => {
    const { service, transaction } = fixture()
    const tx = transaction as unknown as Prisma.TransactionClient
    await expect(service.reverseBusinessEventInTransaction(tx, context, input('40'))).rejects.toMatchObject({ code: 'FUND_REVERSAL_STATE_CHANGED' })
    const prior = splitEntries('DEBIT', ['3.00', '7.00'])
    mockedReadEntries.mockResolvedValue({ ...prior, cumulativeReversedBusinessAmount: '10.00', cumulativeReversedEntryAmount: '10.00' })
    await expect(service.reverseBusinessEventInTransaction(tx, context, input('100'))).rejects.toMatchObject({ code: 'FUND_REVERSAL_STATE_CHANGED' })
    expect(mockedInsertReversal).not.toHaveBeenCalled()
  })

  it('rejects a receipt batch on the purchase void port before replay or writes', async () => {
    mockedReadIdentity.mockResolvedValue({ id: ORIGINAL_BATCH_ID, businessSourceCode: 'SALES_RECEIPT' })
    const { service, transaction } = fixture()
    await expect(service.reverseBusinessEventInTransaction(transaction as unknown as Prisma.TransactionClient, context, input('100'))).rejects.toMatchObject({ code: 'FUND_REVERSAL_TARGET_INVALID' })
    expect(mockedReplay).not.toHaveBeenCalled()
    expect(mockedInsertReversal).not.toHaveBeenCalled()
  })
})
