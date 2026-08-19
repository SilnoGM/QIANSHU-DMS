import {
  normalizeFundManualAdjustmentRequest,
  normalizeFundPagination,
  normalizeFundReversalRequest,
  normalizeFundShareRateInput,
  normalizeFundSort,
  normalizeFundUuid,
  normalizePostBusinessEventRequest,
} from './fund-input.normalizer'
import { calculateFundBusinessFingerprintHash } from './fund-idempotency'
import { FundPostingError } from './fund-posting.errors'

const USER_ID = '11111111-1111-4111-a111-111111111111'
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'
const BATCH_ID = '33333333-3333-4333-8333-333333333333'

function expectFundError(action: () => unknown, code: string): FundPostingError {
  let thrown: unknown
  try {
    action()
  }
  catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(FundPostingError)
  expect((thrown as FundPostingError).code).toBe(code)
  return thrown as FundPostingError
}

describe('fund posting request normalization', () => {
  it('normalizes the public business contract and drops the raw idempotency key', () => {
    const result = normalizePostBusinessEventRequest(
      {
        consumerCode: 'ORDER.SERVICE',
        sourceCode: 'ORDER_SYSTEM',
        requestId: '  request-1  ',
        correlationId: '  correlation-1  ',
      },
      {
        postingTypeCode: 'ORDER_SETTLEMENT',
        userId: USER_ID,
        amount: '-100.5',
        businessId: '  settlement-1  ',
        businessNo: '  0000011  ',
        summary: '  订单   亏损结算  ',
        metadata: { warehouse: 'SZ', retry: 1, taxable: false },
        businessOccurredAt: '2026-08-18T12:30:00+08:00',
        idempotencyKey: ' order/结算/1 ',
      },
    )

    expect(result.context).toEqual({
      consumerCode: 'ORDER.SERVICE',
      sourceCode: 'ORDER_SYSTEM',
      requestId: 'request-1',
      correlationId: 'correlation-1',
    })
    expect(result.input).toEqual({
      postingTypeCode: 'ORDER_SETTLEMENT',
      userId: USER_ID,
      amount: '-100.50',
      businessId: 'settlement-1',
      businessNo: '0000011',
      summary: '订单 亏损结算',
      metadata: { retry: 1, taxable: false, warehouse: 'SZ' },
      businessOccurredAt: '2026-08-18T04:30:00.000Z',
    })
    expect(result.idempotencyKeyHash).toBeInstanceOf(Buffer)
    expect(result.idempotencyKeyHash).toHaveLength(32)
    expect(result.requestFingerprintHash).toBeInstanceOf(Buffer)
    expect(result.requestFingerprintHash).toHaveLength(32)
    expect(result).not.toHaveProperty('idempotencyKey')
    expect(result.input).not.toHaveProperty('idempotencyKey')
    expect(JSON.stringify(result)).not.toContain('order/结算/1')
  })

  it('hashes exact raw UTF-8 key bytes without trim, case folding, or NFC', () => {
    const base = {
      postingTypeCode: 'ORDER_SETTLEMENT',
      userId: USER_ID,
      amount: '1',
      businessId: 'settlement-1',
      summary: '订单结算',
    }
    const context = {
      consumerCode: 'ORDER',
      sourceCode: 'ORDER_SYSTEM',
      requestId: 'request-1',
    }
    const hash = (idempotencyKey: string) =>
      normalizePostBusinessEventRequest(context, {
        ...base,
        idempotencyKey,
      }).idempotencyKeyHash.toString('hex')

    expect(hash('key')).not.toBe(hash(' key'))
    expect(hash('key')).not.toBe(hash('KEY'))
    expect(hash('é')).not.toBe(hash('e\u0301'))
    expect(hash('😀'.repeat(50))).toHaveLength(64)
    expectFundError(
      () => hash(`${'a'.repeat(200)}b`),
      'FUND_VALIDATION_FAILED',
    )
  })

  it('fingerprints normalized business semantics instead of observability fields', () => {
    const normalize = (
      requestId: string,
      amount: string,
      metadata: Record<string, string | number>,
      summary = '订单结算',
    ) => normalizePostBusinessEventRequest(
      {
        consumerCode: 'ORDER',
        sourceCode: 'ORDER_SYSTEM',
        requestId,
      },
      {
        postingTypeCode: 'ORDER_SETTLEMENT',
        userId: USER_ID,
        amount,
        businessId: 'settlement-1',
        summary,
        metadata,
        idempotencyKey: `key-${requestId}`,
      },
    ).requestFingerprintHash.toString('hex')

    const first = normalize('request-1', '1', { z: 2, a: 'first' })
    expect(normalize('request-2', '1.00', { a: 'first', z: 2 })).toBe(first)
    expect(normalize('request-2', '1.00', { a: 'first', z: 2 }, '其他结算')).not.toBe(first)

    const legacyV1Hash = calculateFundBusinessFingerprintHash({
      amount: '1.0000',
      businessId: 'settlement-1',
      businessNo: null,
      businessOccurredAt: null,
      consumerCode: 'ORDER',
      metadata: { a: 'first', z: 2 },
      postingTypeCode: 'ORDER_SETTLEMENT',
      sourceCode: 'ORDER_SYSTEM',
      summary: '订单结算',
      userId: USER_ID,
    }).toString('hex')
    expect(first).toBe(legacyV1Hash)
  })

  it('rejects request accessors without invoking them', () => {
    let getterCalls = 0
    const input = {
      postingTypeCode: 'ORDER_SETTLEMENT',
      userId: USER_ID,
      amount: '1',
      businessId: 'settlement-1',
      summary: '订单结算',
      idempotencyKey: 'key-1',
    }
    Object.defineProperty(input, 'amount', {
      enumerable: true,
      get() {
        getterCalls += 1
        return '1'
      },
    })

    expectFundError(
      () => normalizePostBusinessEventRequest(
        {
          consumerCode: 'ORDER',
          sourceCode: 'ORDER_SYSTEM',
          requestId: 'request-1',
        },
        input,
      ),
      'FUND_VALIDATION_FAILED',
    )
    expect(getterCalls).toBe(0)
  })

  it.each([
    ['number amount', { amount: 1 }, 'FUND_AMOUNT_INVALID'],
    ['scientific amount', { amount: '1e2' }, 'FUND_AMOUNT_INVALID'],
    ['zero amount', { amount: '0' }, 'FUND_POSTING_AMOUNT_INVALID'],
    ['uppercase UUID', { userId: USER_ID.toUpperCase() }, 'FUND_VALIDATION_FAILED'],
    ['naive timestamp', { businessOccurredAt: '2026-08-18T12:30:00' }, 'FUND_VALIDATION_FAILED'],
    ['source in payload', { sourceCode: 'UNTRUSTED' }, 'FUND_VALIDATION_FAILED'],
  ])('rejects %s before hashing', (_label, override, expectedCode) => {
    expectFundError(
      () => normalizePostBusinessEventRequest(
        {
          consumerCode: 'ORDER',
          sourceCode: 'ORDER_SYSTEM',
          requestId: 'request-1',
        },
        {
          postingTypeCode: 'ORDER_SETTLEMENT',
          userId: USER_ID,
          amount: '1',
          businessId: 'settlement-1',
          summary: '订单结算',
          idempotencyKey: 'key-1',
          ...override,
        },
      ),
      expectedCode,
    )
  })

  it('normalizes manual adjustment and reversal idempotency requests', () => {
    const adjustment = normalizeFundManualAdjustmentRequest({
      userAccountId: ACCOUNT_ID,
      amount: '-50',
      adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
      reason: '  修正   初始化余额  ',
      metadata: { ticket: 'FIN-1' },
      idempotencyKey: 'adjustment-key',
    })
    expect(adjustment.input).toEqual({
      userAccountId: ACCOUNT_ID,
      amount: '-50.00',
      adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
      reason: '修正 初始化余额',
      metadata: { ticket: 'FIN-1' },
    })

    const reversal = normalizeFundReversalRequest({
      originalBatchId: BATCH_ID,
      amount: '12.3',
      reason: '  订单金额录入错误  ',
      idempotencyKey: 'reversal-key',
    })
    expect(reversal.input).toEqual({
      originalBatchId: BATCH_ID,
      amount: '12.30',
      reason: '订单金额录入错误',
    })
    expectFundError(
      () => normalizeFundReversalRequest({
        originalBatchId: BATCH_ID,
        amount: '-1',
        reason: '错误金额',
        idempotencyKey: 'reversal-key',
      }),
      'FUND_POSTING_AMOUNT_INVALID',
    )
    expectFundError(
      () => normalizeFundManualAdjustmentRequest({
        userAccountId: ACCOUNT_ID,
        amount: '0',
        adjustmentMode: 'USER_ONLY',
        reason: '错误金额',
        idempotencyKey: 'adjustment-key',
      }),
      'FUND_POSTING_AMOUNT_INVALID',
    )
  })
})

describe('fund common query normalization', () => {
  it('accepts canonical UUID, safe pagination and caller-owned sorting', () => {
    expect(normalizeFundUuid(USER_ID, 'userId')).toBe(USER_ID)
    expect(normalizeFundShareRateInput('30.5')).toBe('30.50')
    expect(normalizeFundPagination({ page: 2, pageSize: 100 })).toEqual({
      page: 2,
      pageSize: 100,
      skip: 100,
    })
    expect(normalizeFundSort('balance', 'desc', ['balance', 'createdAt'], {
      sortBy: 'createdAt',
      sortOrder: 'asc',
    })).toEqual({ sortBy: 'balance', sortOrder: 'desc' })
  })

  it.each(['-1', '30.001', '100.01', '1e2', 30])(
    'rejects an invalid share rate: %p',
    value => {
      expectFundError(
        () => normalizeFundShareRateInput(value),
        'FUND_SHARE_RATE_INVALID',
      )
    },
  )

  it.each([
    [{ page: 0, pageSize: 20 }, 'page'],
    [{ page: 1, pageSize: 101 }, 'pageSize'],
    [{ page: Number.MAX_SAFE_INTEGER, pageSize: 100 }, 'page'],
  ])('rejects unsafe pagination %j', (input, field) => {
    expect(expectFundError(
      () => normalizeFundPagination(input),
      'FUND_VALIDATION_FAILED',
    ).field).toBe(field)
  })

  it('rejects sort values outside the caller allowlist', () => {
    expectFundError(
      () => normalizeFundSort('unknown', 'asc', ['balance'], {
        sortBy: 'balance',
        sortOrder: 'asc',
      }),
      'FUND_VALIDATION_FAILED',
    )
  })
})
