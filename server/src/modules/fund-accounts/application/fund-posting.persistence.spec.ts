import { Prisma } from '../../../generated/prisma/client'
import {
  insertFundLedgerEntries,
  insertFundManualAdjustmentBatch,
  insertFundPostingBatch,
  lockFundAccountsForPosting,
  lockFundBusinessSourceForPosting,
  lockFundPostingTypeForPosting,
  readFundAccountIdentitiesForPosting,
  readFundManualAdjustmentIdentities,
  readFundPostingTransactionTimestamp,
  readFundSourceTypeAuthorization,
  readIdempotentFundPosting,
  updateFundAccountForPosting,
} from './fund-posting.persistence'
import { FundPostingError } from './fund-posting.errors'

const SOURCE_ID = '11111111-1111-4111-a111-111111111111'
const TYPE_ID = '22222222-2222-4222-a222-222222222222'
const RULE_ID = '33333333-3333-4333-a333-333333333333'
const USER_ID = '44444444-4444-4444-a444-444444444444'
const COMPANY_ACCOUNT_ID = '55555555-5555-4555-a555-555555555555'
const USER_ACCOUNT_ID = '99999999-9999-4999-a999-999999999999'
const BATCH_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const AS_OF = new Date('2026-08-18T08:00:00.000Z')
const IDEMPOTENCY_HASH = Buffer.alloc(32, 0x11)
const FINGERPRINT_HASH = Buffer.alloc(32, 0x22)

function fixture() {
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
  const createBatch = jest.fn<Promise<unknown>, [unknown]>()
  const createEntries = jest.fn<Promise<unknown>, [unknown]>()
  const client = {
    $queryRaw: queryRaw,
    fundPostingBatch: { create: createBatch },
    fundLedgerEntry: { createMany: createEntries },
  } as unknown as Parameters<typeof readFundPostingTransactionTimestamp>[0]
  return { client, createBatch, createEntries, queryRaw }
}

function sqlText(transaction: ReturnType<typeof fixture>): string {
  const query = transaction.queryRaw.mock.calls[0]?.[0] as {
    strings?: readonly string[]
  }
  return query.strings?.join(' ') ?? ''
}

async function expectInternal(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(FundPostingError)
  await expect(promise).rejects.toMatchObject({
    code: 'FUND_INTERNAL_ERROR',
    message: '资金服务内部错误',
  })
}

describe('fund posting persistence reads', () => {
  it('reads and validates the single transaction timestamp', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([{ asOf: AS_OF }])

    await expect(readFundPostingTransactionTimestamp(
      transaction.client,
    )).resolves.toBe(AS_OF)
    expect(sqlText(transaction)).toContain('transaction_timestamp()')

    const invalid = fixture()
    invalid.queryRaw.mockResolvedValue([{ asOf: 'not-a-date' }])
    await expectInternal(readFundPostingTransactionTimestamp(invalid.client))
  })

  it('resolves a selected user account and optional company without trusting user input', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([
      {
        id: COMPANY_ACCOUNT_ID,
        ownerType: 'COMPANY',
        userId: null,
      },
      {
        id: USER_ACCOUNT_ID,
        ownerType: 'USER',
        userId: USER_ID,
      },
    ])

    await expect(readFundManualAdjustmentIdentities(
      transaction.client,
      { userAccountId: USER_ACCOUNT_ID, requireCompanyAccount: true },
    )).resolves.toEqual({
      userId: USER_ID,
      userAccountId: USER_ACCOUNT_ID,
      companyAccountId: COMPANY_ACCOUNT_ID,
    })
    expect(sqlText(transaction)).toContain('ORDER BY account."id" ASC')

    const companySelected = fixture()
    companySelected.queryRaw.mockResolvedValue([{
      id: USER_ACCOUNT_ID,
      ownerType: 'COMPANY',
      userId: null,
    }])
    await expect(readFundManualAdjustmentIdentities(
      companySelected.client,
      { userAccountId: USER_ACCOUNT_ID, requireCompanyAccount: false },
    )).resolves.toBeNull()
  })

  it('locks source and type configuration while mapping ACTIVE controlled legs', async () => {
    const sourceTransaction = fixture()
    sourceTransaction.queryRaw.mockResolvedValue([{
      id: SOURCE_ID,
      code: 'ORDER_SYSTEM',
      name: '订单系统',
      enabled: true,
    }])
    await expect(lockFundBusinessSourceForPosting(
      sourceTransaction.client,
      'ORDER_SYSTEM',
    )).resolves.toEqual({
      id: SOURCE_ID,
      code: 'ORDER_SYSTEM',
      name: '订单系统',
      enabled: true,
    })
    expect(sqlText(sourceTransaction)).toContain('FOR SHARE OF source')

    const typeTransaction = fixture()
    typeTransaction.queryRaw.mockResolvedValue([
      {
        id: TYPE_ID,
        code: 'ORDER_SETTLEMENT',
        name: '订单结算',
        businessCategory: 'REVENUE',
        requiresUser: true,
        amountSignPolicy: 'NON_ZERO_SIGNED',
        inputMode: 'STANDARD',
        enabled: true,
        currentRuleVersionId: RULE_ID,
        ruleVersionId: RULE_ID,
        ruleRevision: 2,
        ruleStatus: 'ACTIVE',
        legPosition: 1,
        accountTarget: 'USER',
        directionPolicy: 'FOLLOW_AMOUNT_SIGN',
        amountStrategy: 'USER_SHARE',
        adjustmentMode: null,
      },
      {
        id: TYPE_ID,
        code: 'ORDER_SETTLEMENT',
        name: '订单结算',
        businessCategory: 'REVENUE',
        requiresUser: true,
        amountSignPolicy: 'NON_ZERO_SIGNED',
        inputMode: 'STANDARD',
        enabled: true,
        currentRuleVersionId: RULE_ID,
        ruleVersionId: RULE_ID,
        ruleRevision: 2,
        ruleStatus: 'ACTIVE',
        legPosition: 2,
        accountTarget: 'COMPANY',
        directionPolicy: 'FOLLOW_AMOUNT_SIGN',
        amountStrategy: 'COMPANY_REMAINDER',
        adjustmentMode: null,
      },
    ])

    const result = await lockFundPostingTypeForPosting(
      typeTransaction.client,
      'ORDER_SETTLEMENT',
    )

    expect(result).toMatchObject({
      id: TYPE_ID,
      currentRuleVersionId: RULE_ID,
      ruleVersion: {
        id: RULE_ID,
        revision: 2,
        status: 'ACTIVE',
        legs: [
          { position: 1, accountTarget: 'USER' },
          { position: 2, accountTarget: 'COMPANY' },
        ],
      },
    })
    expect(sqlText(typeTransaction)).toContain('FOR SHARE OF posting_type')
  })

  it('checks source authorization and resolves account identities without locking', async () => {
    const authorization = fixture()
    authorization.queryRaw.mockResolvedValue([{ allowed: true }])
    await expect(readFundSourceTypeAuthorization(
      authorization.client,
      SOURCE_ID,
      TYPE_ID,
    )).resolves.toBe(true)
    expect(sqlText(authorization)).toContain('fund_business_source_posting_types')

    const identities = fixture()
    identities.queryRaw.mockResolvedValue([
      { id: USER_ACCOUNT_ID, ownerType: 'USER', userId: USER_ID },
      { id: COMPANY_ACCOUNT_ID, ownerType: 'COMPANY', userId: null },
    ])
    await expect(readFundAccountIdentitiesForPosting(identities.client, {
      userId: USER_ID,
      requireUserAccount: true,
      requireCompanyAccount: true,
    })).resolves.toEqual({
      userAccountId: USER_ACCOUNT_ID,
      companyAccountId: COMPANY_ACCOUNT_ID,
    })
    expect(sqlText(identities)).not.toContain('FOR UPDATE')
  })

  it('preserves a valid unpublished type as rule-unavailable state', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([{
      id: TYPE_ID,
      code: 'NEW_COST',
      name: '新成本',
      businessCategory: 'COST',
      requiresUser: false,
      amountSignPolicy: 'POSITIVE_ONLY',
      inputMode: 'STANDARD',
      enabled: false,
      currentRuleVersionId: null,
      ruleVersionId: null,
      ruleRevision: null,
      ruleStatus: null,
      legPosition: null,
      accountTarget: null,
      directionPolicy: null,
      amountStrategy: null,
      adjustmentMode: null,
    }])

    await expect(lockFundPostingTypeForPosting(
      transaction.client,
      'NEW_COST',
    )).resolves.toMatchObject({
      id: TYPE_ID,
      currentRuleVersionId: null,
      ruleVersion: null,
    })
  })

  it('locks accounts by ID order and converts decimals to fixed strings', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([
      {
        id: COMPANY_ACCOUNT_ID,
        ownerType: 'COMPANY',
        userId: null,
        balance: new Prisma.Decimal('100'),
        userShareRate: null,
        nextSequence: 11n,
        version: 4,
      },
      {
        id: USER_ACCOUNT_ID,
        ownerType: 'USER',
        userId: USER_ID,
        balance: new Prisma.Decimal('-20.25'),
        userShareRate: new Prisma.Decimal('30'),
        nextSequence: 7n,
        version: 2,
      },
    ])

    const result = await lockFundAccountsForPosting(transaction.client, [
      COMPANY_ACCOUNT_ID,
      USER_ACCOUNT_ID,
    ])

    expect(result).toEqual([
      expect.objectContaining({
        id: COMPANY_ACCOUNT_ID,
        balance: '100.00',
        userShareRate: null,
      }),
      expect.objectContaining({
        id: USER_ACCOUNT_ID,
        balance: '-20.25',
        userShareRate: '30.00',
      }),
    ])
    expect(sqlText(transaction)).toContain('ORDER BY account."id"')
    expect(sqlText(transaction)).toContain('FOR UPDATE OF account')
  })

  it('maps a complete immutable replay without exposing either stored hash', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([
      {
        batchId: BATCH_ID,
        postingTypeCode: 'ORDER_SETTLEMENT',
        businessCategory: 'REVENUE',
        businessAmount: new Prisma.Decimal('100'),
        userShareRateSnapshot: new Prisma.Decimal('30'),
        companyShareRateSnapshot: new Prisma.Decimal('70'),
        postedAt: AS_OF,
        requestFingerprintHash: Uint8Array.from(FINGERPRINT_HASH),
        lineNo: 1,
        entryId: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
        accountId: USER_ACCOUNT_ID,
        accountTarget: 'USER',
        direction: 'CREDIT',
        entryAmount: new Prisma.Decimal('30'),
        balanceBefore: new Prisma.Decimal('10'),
        balanceAfter: new Prisma.Decimal('40'),
        accountSequence: 7n,
      },
      {
        batchId: BATCH_ID,
        postingTypeCode: 'ORDER_SETTLEMENT',
        businessCategory: 'REVENUE',
        businessAmount: new Prisma.Decimal('100'),
        userShareRateSnapshot: new Prisma.Decimal('30'),
        companyShareRateSnapshot: new Prisma.Decimal('70'),
        postedAt: AS_OF,
        requestFingerprintHash: Uint8Array.from(FINGERPRINT_HASH),
        lineNo: 2,
        entryId: 'cccccccc-cccc-4ccc-accc-cccccccccccc',
        accountId: COMPANY_ACCOUNT_ID,
        accountTarget: 'COMPANY',
        direction: 'CREDIT',
        entryAmount: new Prisma.Decimal('70'),
        balanceBefore: new Prisma.Decimal('100'),
        balanceAfter: new Prisma.Decimal('170'),
        accountSequence: 11n,
      },
    ])

    const result = await readIdempotentFundPosting(transaction.client, {
      consumerCode: 'ORDER',
      sourceCode: 'ORDER_SYSTEM',
      idempotencyKeyHash: IDEMPOTENCY_HASH,
    })

    expect(result).toMatchObject({
      requestFingerprintHash: FINGERPRINT_HASH,
      batchId: BATCH_ID,
      businessAmount: '100.00',
      entries: [
        { amount: '30.00', accountSequence: '7' },
        { amount: '70.00', accountSequence: '11' },
      ],
    })
    expect(result).not.toHaveProperty('idempotencyKeyHash')
    expect(sqlText(transaction)).not.toContain('idempotency_key_hash" AS')
  })
})

describe('fund posting persistence writes', () => {
  it('inserts a BUSINESS batch with only hashes and immutable snapshots', async () => {
    const transaction = fixture()
    transaction.createBatch.mockResolvedValue({ id: BATCH_ID })

    await insertFundPostingBatch(transaction.client, {
      id: BATCH_ID,
      batchNo: 'FUND_AAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAA',
      numberingIssuanceId: '77777777-7777-4777-a777-777777777777',
      kind: 'BUSINESS',
      postingTypeId: TYPE_ID,
      postingTypeCodeSnapshot: 'ORDER_SETTLEMENT',
      postingTypeNameSnapshot: '订单结算',
      businessCategorySnapshot: 'REVENUE',
      businessSourceId: SOURCE_ID,
      businessSourceCodeSnapshot: 'ORDER_SYSTEM',
      businessSourceNameSnapshot: '订单系统',
      ruleVersionId: RULE_ID,
      ruleRevisionSnapshot: 1,
      userId: USER_ID,
      businessAmount: '-100.00',
      userShareRateSnapshot: '30.00',
      companyShareRateSnapshot: '70.00',
      businessId: 'settlement-1',
      businessNo: '0000011',
      summary: '订单亏损结算',
      metadata: { orderChannel: 'WEB' },
      businessOccurredAt: AS_OF,
      consumerCode: 'ORDER',
      idempotencyKeyHash: IDEMPOTENCY_HASH,
      requestFingerprintHash: FINGERPRINT_HASH,
      requestId: 'request-1',
      correlationId: 'correlation-1',
      postedAt: AS_OF,
    })

    const createInput = transaction.createBatch.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
      select: { id: boolean }
    }
    expect(createInput.select).toEqual({ id: true })
    expect(createInput.data).toMatchObject({
      id: BATCH_ID,
      numberingIssuanceId: '77777777-7777-4777-a777-777777777777',
      kind: 'BUSINESS',
      businessAmount: new Prisma.Decimal('-100.00'),
      idempotencyKeyHash: Uint8Array.from(IDEMPOTENCY_HASH),
      requestFingerprintHash: Uint8Array.from(FINGERPRINT_HASH),
      adjustmentMode: null,
      reversalOfBatchId: null,
      actorUserId: null,
    })
    expect(JSON.stringify(createInput)).not.toContain(
      'order-settlement:settlement-1',
    )
  })

  it('inserts a MANUAL_ADJUSTMENT batch with fixed actor and mode facts', async () => {
    const transaction = fixture()
    transaction.createBatch.mockResolvedValue({ id: BATCH_ID })

    await insertFundManualAdjustmentBatch(transaction.client, {
      id: BATCH_ID,
      batchNo: 'FUND_AAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAA',
      numberingIssuanceId: '77777777-7777-4777-a777-777777777777',
      kind: 'MANUAL_ADJUSTMENT',
      postingTypeId: TYPE_ID,
      postingTypeCodeSnapshot: 'ADMIN_MANUAL_ADJUSTMENT',
      postingTypeNameSnapshot: '管理员手动调账',
      businessCategorySnapshot: 'ADJUSTMENT',
      businessSourceId: SOURCE_ID,
      businessSourceCodeSnapshot: 'ADMIN_CONSOLE',
      businessSourceNameSnapshot: '管理员工作台',
      ruleVersionId: RULE_ID,
      ruleRevisionSnapshot: 1,
      userId: USER_ID,
      businessAmount: '-100.00',
      userShareRateSnapshot: '30.00',
      companyShareRateSnapshot: '70.00',
      businessId: BATCH_ID,
      summary: '修正录入金额',
      metadata: { ticketNo: 'FIN-1' },
      businessOccurredAt: AS_OF,
      consumerCode: 'ADMIN_MANUAL_ADJUSTMENT',
      idempotencyKeyHash: IDEMPOTENCY_HASH,
      requestFingerprintHash: FINGERPRINT_HASH,
      adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
      actorUserId: USER_ID,
      requestId: 'request-1',
      correlationId: null,
      postedAt: AS_OF,
    })

    const createInput = transaction.createBatch.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(createInput.data).toMatchObject({
      numberingIssuanceId: '77777777-7777-4777-a777-777777777777',
      kind: 'MANUAL_ADJUSTMENT',
      businessCategorySnapshot: 'ADJUSTMENT',
      businessNo: null,
      adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
      actorUserId: USER_ID,
      idempotencyKeyHash: Uint8Array.from(IDEMPOTENCY_HASH),
    })
  })

  it('updates a locked account with optimistic guards and inserts supplied entries', async () => {
    const updateTransaction = fixture()
    updateTransaction.queryRaw.mockResolvedValue([{ id: USER_ACCOUNT_ID }])
    await expect(updateFundAccountForPosting(updateTransaction.client, {
      accountId: USER_ACCOUNT_ID,
      expectedVersion: 2,
      expectedNextSequence: 7n,
      balanceAfter: '-20.00',
      nextSequence: 8n,
      asOf: AS_OF,
    })).resolves.toBe(true)
    expect(sqlText(updateTransaction)).toContain('AND "version" =')
    expect(sqlText(updateTransaction)).toContain('AND "next_sequence" =')

    const entryTransaction = fixture()
    entryTransaction.createEntries.mockResolvedValue({ count: 1 })
    await insertFundLedgerEntries(entryTransaction.client, [{
      id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
      batchId: BATCH_ID,
      lineNo: 1,
      accountId: USER_ACCOUNT_ID,
      direction: 'DEBIT',
      accountTarget: 'USER',
      amountStrategy: 'USER_SHARE',
      amount: '30.00',
      balanceBefore: '10.00',
      balanceAfter: '-20.00',
      accountSequence: 7n,
      postedAt: AS_OF,
    }])
    expect(entryTransaction.createEntries).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        amount: new Prisma.Decimal('30.00'),
        balanceBefore: new Prisma.Decimal('10.00'),
        balanceAfter: new Prisma.Decimal('-20.00'),
      })],
    })
  })
})
