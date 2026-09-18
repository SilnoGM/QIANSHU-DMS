import { Prisma } from '../../../generated/prisma/client'
import {
  insertFundReversalBatch,
  lockFundOriginalBatchForReversal,
  readFundOriginalEntriesForReversal,
  readFundReversalTargetIdentity,
} from './fund-reversal.persistence'
import { FundPostingError } from './fund-posting.errors'

const ORIGINAL_BATCH_ID = '11111111-1111-4111-a111-111111111111'
const REVERSAL_BATCH_ID = '22222222-2222-4222-a222-222222222222'
const SOURCE_ID = '33333333-3333-4333-a333-333333333333'
const TYPE_ID = '44444444-4444-4444-a444-444444444444'
const RULE_ID = '55555555-5555-4555-a555-555555555555'
const USER_ID = '66666666-6666-4666-a666-666666666666'
const USER_ACCOUNT_ID = '77777777-7777-4777-a777-777777777777'
const COMPANY_ACCOUNT_ID = '88888888-8888-4888-a888-888888888888'
const ACTOR_ID = '99999999-9999-4999-a999-999999999999'
const AS_OF = new Date('2026-08-18T10:00:00.000Z')

function fixture() {
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
  return {
    client: { $queryRaw: queryRaw } as unknown as Parameters<
      typeof readFundReversalTargetIdentity
    >[0],
    queryRaw,
  }
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

describe('fund reversal persistence', () => {
  it('reads the controlled stock purchase company-only 0/100 snapshot for reversal', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([{
      id: ORIGINAL_BATCH_ID, kind: 'BUSINESS', postingTypeId: TYPE_ID,
      postingTypeCode: 'PURCHASE_PAYMENT', businessCategory: 'COST', businessSourceId: SOURCE_ID,
      businessSourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY', ruleVersionId: RULE_ID,
      userId: null, businessAmount: new Prisma.Decimal('100'),
      userShareRateSnapshot: new Prisma.Decimal('0'), companyShareRateSnapshot: new Prisma.Decimal('100'), adjustmentMode: null,
    }])
    await expect(lockFundOriginalBatchForReversal(transaction.client, ORIGINAL_BATCH_ID)).resolves.toMatchObject({
      userId: null, userShareRateSnapshot: '0.00', companyShareRateSnapshot: '100.00', businessAmount: '100.00',
    })
    expect(sqlText(transaction)).toContain('"consumer_code" AS "consumerCode"')
  })

  it.each([
    { businessSourceCode: 'OTHER' }, { postingTypeCode: 'OTHER' }, { consumerCode: 'PURCHASE_PAYMENT.PAY' },
    { businessCategory: 'REVENUE' }, { kind: 'MANUAL_ADJUSTMENT' },
    { userShareRateSnapshot: new Prisma.Decimal('30'), companyShareRateSnapshot: new Prisma.Decimal('70') },
  ])('does not broaden company-only reversal snapshots beyond controlled stock purchase: %s', async overrides => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([{
      id: ORIGINAL_BATCH_ID, kind: 'BUSINESS', postingTypeId: TYPE_ID,
      postingTypeCode: 'PURCHASE_PAYMENT', businessCategory: 'COST', businessSourceId: SOURCE_ID,
      businessSourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY', ruleVersionId: RULE_ID,
      userId: null, businessAmount: new Prisma.Decimal('100'),
      userShareRateSnapshot: new Prisma.Decimal('0'), companyShareRateSnapshot: new Prisma.Decimal('100'), adjustmentMode: null,
      ...overrides,
    }])
    await expectInternal(lockFundOriginalBatchForReversal(transaction.client, ORIGINAL_BATCH_ID))
  })

  it('reads the immutable source identity without taking the target lock', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([{
      id: ORIGINAL_BATCH_ID,
      businessSourceCode: 'ORDER_SYSTEM',
    }])

    await expect(readFundReversalTargetIdentity(
      transaction.client,
      ORIGINAL_BATCH_ID,
    )).resolves.toEqual({
      id: ORIGINAL_BATCH_ID,
      businessSourceCode: 'ORDER_SYSTEM',
    })
    expect(sqlText(transaction)).not.toContain('FOR UPDATE')
  })

  it('locks only the original batch row and maps its immutable snapshots', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([{
      id: ORIGINAL_BATCH_ID,
      kind: 'BUSINESS',
      postingTypeId: TYPE_ID,
      postingTypeCode: 'ORDER_SETTLEMENT',
      businessCategory: 'REVENUE',
      businessSourceId: SOURCE_ID,
      businessSourceCode: 'ORDER_SYSTEM',
      ruleVersionId: RULE_ID,
      userId: USER_ID,
      businessAmount: new Prisma.Decimal('-100'),
      userShareRateSnapshot: new Prisma.Decimal('30'),
      companyShareRateSnapshot: new Prisma.Decimal('70'),
      adjustmentMode: null,
    }])

    await expect(lockFundOriginalBatchForReversal(
      transaction.client,
      ORIGINAL_BATCH_ID,
    )).resolves.toEqual({
      id: ORIGINAL_BATCH_ID,
      kind: 'BUSINESS',
      postingTypeId: TYPE_ID,
      postingTypeCode: 'ORDER_SETTLEMENT',
      businessCategory: 'REVENUE',
      businessSourceId: SOURCE_ID,
      businessSourceCode: 'ORDER_SYSTEM',
      ruleVersionId: RULE_ID,
      userId: USER_ID,
      businessAmount: '-100.00',
      userShareRateSnapshot: '30.00',
      companyShareRateSnapshot: '70.00',
      adjustmentMode: null,
    })
    expect(sqlText(transaction)).toContain('FOR UPDATE OF batch')
    expect(sqlText(transaction)).not.toContain('fund_ledger_entries')
  })

  it('reads original entries and aggregates committed reversal facts after locking', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([
      {
        originalLineNo: 1,
        accountId: USER_ACCOUNT_ID,
        accountTarget: 'USER',
        direction: 'DEBIT',
        amountStrategy: 'USER_SHARE',
        amount: new Prisma.Decimal('30'),
        reversedAmount: new Prisma.Decimal('12'),
        cumulativeReversedBusinessAmount: new Prisma.Decimal('40'),
        cumulativeReversedEntryAmount: new Prisma.Decimal('40'),
      },
      {
        originalLineNo: 2,
        accountId: COMPANY_ACCOUNT_ID,
        accountTarget: 'COMPANY',
        direction: 'DEBIT',
        amountStrategy: 'COMPANY_REMAINDER',
        amount: new Prisma.Decimal('70'),
        reversedAmount: new Prisma.Decimal('28'),
        cumulativeReversedBusinessAmount: new Prisma.Decimal('40'),
        cumulativeReversedEntryAmount: new Prisma.Decimal('40'),
      },
    ])

    await expect(readFundOriginalEntriesForReversal(
      transaction.client,
      ORIGINAL_BATCH_ID,
    )).resolves.toEqual({
      entries: [
        {
          originalLineNo: 1,
          accountId: USER_ACCOUNT_ID,
          accountTarget: 'USER',
          direction: 'DEBIT',
          amountStrategy: 'USER_SHARE',
          amount: '30.00',
          reversedAmount: '12.00',
        },
        {
          originalLineNo: 2,
          accountId: COMPANY_ACCOUNT_ID,
          accountTarget: 'COMPANY',
          direction: 'DEBIT',
          amountStrategy: 'COMPANY_REMAINDER',
          amount: '70.00',
          reversedAmount: '28.00',
        },
      ],
      cumulativeReversedBusinessAmount: '40.00',
      cumulativeReversedEntryAmount: '40.00',
    })
    expect(sqlText(transaction)).toContain('reversal_of_batch_id')
    expect(sqlText(transaction)).toContain('SUM')
    expect(sqlText(transaction)).not.toContain('FOR UPDATE')
  })

  it('inserts REVERSAL by copying original snapshots with INSERT SELECT', async () => {
    const transaction = fixture()
    transaction.queryRaw.mockResolvedValue([{ id: REVERSAL_BATCH_ID }])

    await expect(insertFundReversalBatch(transaction.client, {
      id: REVERSAL_BATCH_ID,
      batchNo: 'FUND_2222222222224222A222222222222222',
      originalBatchId: ORIGINAL_BATCH_ID,
      businessAmount: '40.00',
      consumerCode: 'ADMIN_REVERSAL',
      idempotencyKeyHash: Buffer.alloc(32, 0x11),
      requestFingerprintHash: Buffer.alloc(32, 0x22),
      reason: '冲销错误亏损',
      actorUserId: ACTOR_ID,
      requestId: 'request-1',
      correlationId: 'correlation-1',
      postedAt: AS_OF,
    })).resolves.toBeUndefined()

    const sql = sqlText(transaction)
    expect(sql).toContain('INSERT INTO "fund_posting_batches"')
    expect(sql).toContain("'REVERSAL'::\"fund_posting_batch_kind\"")
    expect(sql).toContain('FROM "fund_posting_batches" AS original')
    expect(sql).not.toContain('UPDATE "fund_posting_batches"')
  })

  it('fails closed for malformed rows and hash lengths', async () => {
    const invalidIdentity = fixture()
    invalidIdentity.queryRaw.mockResolvedValue([{
      id: 'not-a-uuid',
      businessSourceCode: 'ORDER_SYSTEM',
    }])
    await expectInternal(readFundReversalTargetIdentity(
      invalidIdentity.client,
      ORIGINAL_BATCH_ID,
    ))

    const invalidInsert = fixture()
    await expectInternal(insertFundReversalBatch(invalidInsert.client, {
      id: REVERSAL_BATCH_ID,
      batchNo: 'FUND_2222222222224222A222222222222222',
      originalBatchId: ORIGINAL_BATCH_ID,
      businessAmount: '10.00',
      consumerCode: 'ADMIN_REVERSAL',
      idempotencyKeyHash: Buffer.alloc(31),
      requestFingerprintHash: Buffer.alloc(32),
      reason: '冲账',
      actorUserId: ACTOR_ID,
      requestId: 'request-1',
      correlationId: null,
      postedAt: AS_OF,
    }))
    expect(invalidInsert.queryRaw).not.toHaveBeenCalled()
  })
})
