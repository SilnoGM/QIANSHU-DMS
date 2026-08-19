import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import {
  FundTransactionQueryService,
  normalizeFundTransactionListQuery,
} from './fund-transaction-query.service'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from './fund-posting.errors'

describe('normalizeFundTransactionListQuery', () => {
  it('normalizes the complete filter set and preserves stable sort input', () => {
    expect(normalizeFundTransactionListQuery({
      page: 2,
      pageSize: 50,
      accountId: '10000000-0000-4000-8000-000000000001',
      userId: '10000000-0000-4000-8000-000000000002',
      postingTypeId: '10000000-0000-4000-8000-000000000003',
      businessCategory: 'COST',
      businessSourceId: '10000000-0000-4000-8000-000000000004',
      direction: 'DEBIT',
      businessNo: '  PO-0001  ',
      occurredFrom: '2026-08-01T00:00:00.000Z',
      occurredTo: '2026-08-31T23:59:59.999Z',
      reversalStatus: 'PARTIAL',
      sortBy: 'businessOccurredAt',
      sortOrder: 'asc',
    })).toEqual({
      page: 2,
      pageSize: 50,
      skip: 50,
      accountId: '10000000-0000-4000-8000-000000000001',
      userId: '10000000-0000-4000-8000-000000000002',
      postingTypeId: '10000000-0000-4000-8000-000000000003',
      businessCategory: 'COST',
      businessSourceId: '10000000-0000-4000-8000-000000000004',
      direction: 'DEBIT',
      businessNo: 'PO-0001',
      occurredFrom: new Date('2026-08-01T00:00:00.000Z'),
      occurredTo: new Date('2026-08-31T23:59:59.999Z'),
      reversalStatus: 'PARTIAL',
      sortBy: 'businessOccurredAt',
      sortOrder: 'asc',
    })
  })

  it('rejects an inverted time range with a stable validation field', () => {
    let thrown: unknown
    try {
      normalizeFundTransactionListQuery({
        occurredFrom: '2026-09-01T00:00:00.000Z',
        occurredTo: '2026-08-01T00:00:00.000Z',
      })
    }
    catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(FundPostingError)
    expect((thrown as FundPostingError).code).toBe(
      FUND_POSTING_ERROR_CODES.VALIDATION_FAILED,
    )
    expect((thrown as FundPostingError).field).toBe('businessOccurredAt')
  })
})

describe('FundTransactionQueryService', () => {
  it('returns one immutable ledger row with decimal and bigint strings', async () => {
    const queryRaw: jest.MockedFunction<
      (query: { sql?: string }) => Promise<unknown>
    > = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 1n }])
      .mockResolvedValueOnce([{
        entryId: '10000000-0000-4000-8000-000000000011',
        batchId: '10000000-0000-4000-8000-000000000012',
        batchNo: 'FUND_1',
        batchKind: 'BUSINESS',
        accountId: '10000000-0000-4000-8000-000000000013',
        ownerType: 'USER',
        userId: '10000000-0000-4000-8000-000000000014',
        username: 'alice',
        displayName: 'Alice',
        userStatus: 'ACTIVE',
        accountTarget: 'USER',
        postingTypeId: '10000000-0000-4000-8000-000000000015',
        postingTypeCode: 'ORDER_SETTLEMENT',
        postingTypeName: '订单结算',
        businessCategory: 'REVENUE',
        businessSourceId: '10000000-0000-4000-8000-000000000016',
        businessSourceCode: 'ORDER_SYSTEM',
        businessSourceName: '订单系统',
        direction: 'CREDIT',
        amountStrategy: 'USER_SHARE',
        amount: new Prisma.Decimal('30'),
        balanceBefore: new Prisma.Decimal('-5'),
        balanceAfter: new Prisma.Decimal('25'),
        accountSequence: 7n,
        businessAmount: new Prisma.Decimal('100'),
        userShareRateSnapshot: new Prisma.Decimal('30'),
        companyShareRateSnapshot: new Prisma.Decimal('70'),
        businessId: 'order-1',
        businessNo: '0000011',
        summary: '订单结算',
        businessOccurredAt: new Date('2026-08-18T00:00:00.000Z'),
        adjustmentMode: null,
        reversalOfBatchId: null,
        reversalStatus: 'NONE',
        postedAt: new Date('2026-08-18T01:00:00.000Z'),
      }])
    const transaction = { $queryRaw: queryRaw }
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) => (
        callback(transaction)
      )),
    }
    const service = new FundTransactionQueryService(
      prisma as unknown as PrismaService,
    )

    await expect(service.listTransactions({})).resolves.toEqual({
      items: [expect.objectContaining({
        amount: '30.00',
        balanceBefore: '-5.00',
        balanceAfter: '25.00',
        accountSequence: '7',
        businessAmount: '100.00',
        reversalStatus: 'NONE',
      })],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    const listSql = queryRaw.mock.calls[2]?.[0]
    expect(listSql.sql).toContain('entry."posted_at" DESC')
    expect(listSql.sql).toContain('entry."id" DESC')
  })

  it('returns historical batch snapshots with a derived partial reversal chain', async () => {
    const findUnique: jest.MockedFunction<
      (input: unknown) => Promise<unknown>
    > = jest.fn()
      .mockResolvedValueOnce({
        id: '10000000-0000-4000-8000-000000000021',
        batchNo: 'FUND_ORIGINAL',
        kind: 'BUSINESS',
        postingTypeId: '10000000-0000-4000-8000-000000000022',
        postingTypeCodeSnapshot: 'ORDER_SETTLEMENT',
        postingTypeNameSnapshot: '订单结算',
        businessCategorySnapshot: 'REVENUE',
        businessSourceId: '10000000-0000-4000-8000-000000000023',
        businessSourceCodeSnapshot: 'ORDER_SYSTEM',
        businessSourceNameSnapshot: '订单系统',
        ruleVersionId: '10000000-0000-4000-8000-000000000024',
        ruleRevisionSnapshot: 1,
        user: {
          id: '10000000-0000-4000-8000-000000000025',
          username: 'alice',
          displayName: 'Alice',
          status: 'ACTIVE',
        },
        businessAmount: new Prisma.Decimal('100'),
        userShareRateSnapshot: new Prisma.Decimal('30'),
        companyShareRateSnapshot: new Prisma.Decimal('70'),
        businessId: 'order-1',
        businessNo: '0000011',
        summary: '订单结算',
        metadata: { orderNo: '0000011' },
        businessOccurredAt: new Date('2026-08-18T00:00:00.000Z'),
        adjustmentMode: null,
        reversalOfBatchId: null,
        reversalReason: null,
        actorUserId: null,
        requestId: 'request-1',
        correlationId: null,
        postedAt: new Date('2026-08-18T01:00:00.000Z'),
        entries: [{
          id: '10000000-0000-4000-8000-000000000026',
          lineNo: 1,
          account: {
            id: '10000000-0000-4000-8000-000000000027',
            ownerType: 'USER',
            user: {
              id: '10000000-0000-4000-8000-000000000025',
              username: 'alice',
              displayName: 'Alice',
              status: 'ACTIVE',
            },
          },
          accountTarget: 'USER',
          direction: 'CREDIT',
          amountStrategy: 'USER_SHARE',
          amount: new Prisma.Decimal('30'),
          balanceBefore: new Prisma.Decimal('-5'),
          balanceAfter: new Prisma.Decimal('25'),
          accountSequence: 7n,
          postedAt: new Date('2026-08-18T01:00:00.000Z'),
        }],
      })
      .mockResolvedValueOnce({
        id: '10000000-0000-4000-8000-000000000021',
        batchNo: 'FUND_ORIGINAL',
        businessAmount: new Prisma.Decimal('100'),
        reversalBatches: [{
          id: '10000000-0000-4000-8000-000000000031',
          batchNo: 'FUND_REVERSAL',
          businessAmount: new Prisma.Decimal('-20'),
          reversalReason: '部分冲账',
          actorUserId: '10000000-0000-4000-8000-000000000032',
          postedAt: new Date('2026-08-18T02:00:00.000Z'),
        }],
      })
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      fundPostingBatch: { findUnique },
    }
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) => (
          callback(transaction)
        ),
      ),
    }
    const service = new FundTransactionQueryService(
      prisma as unknown as PrismaService,
    )

    await expect(service.getBatchDetail(
      '10000000-0000-4000-8000-000000000021',
    )).resolves.toMatchObject({
      postingTypeCode: 'ORDER_SETTLEMENT',
      businessSourceCode: 'ORDER_SYSTEM',
      businessAmount: '100.00',
      metadata: { orderNo: '0000011' },
      entries: [{
        amount: '30.00',
        balanceBefore: '-5.00',
        balanceAfter: '25.00',
        accountSequence: '7',
      }],
      reversalChain: {
        status: 'PARTIAL',
        originalAmount: '100.00',
        reversedAmount: '20.00',
        remainingAmount: '80.00',
        reversals: [{ amount: '20.00', reason: '部分冲账' }],
      },
    })
  })
})
