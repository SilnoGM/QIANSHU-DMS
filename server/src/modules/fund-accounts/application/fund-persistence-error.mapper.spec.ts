import {
  isFundIdempotencyUniqueViolation,
  mapFundPersistenceError,
} from './fund-persistence-error.mapper'
import { FundPostingError } from './fund-posting.errors'

function expectMapped(error: unknown, code: string): FundPostingError {
  const mapped = mapFundPersistenceError(error)
  expect(mapped).toBeInstanceOf(FundPostingError)
  expect(mapped.code).toBe(code)
  return mapped
}

describe('fund persistence error mapping', () => {
  it.each([
    [
      { code: 'P2002', meta: { target: ['userId'] } },
      'FUND_ACCOUNT_ALREADY_EXISTS',
    ],
    [
      { code: '23505', constraint: 'fund_accounts_one_company_key' },
      'FUND_COMPANY_ACCOUNT_UNAVAILABLE',
    ],
    [
      { code: 'P2002', meta: { constraint: { index: 'fund_business_sources_code_key' } } },
      'FUND_BUSINESS_SOURCE_CODE_ALREADY_EXISTS',
    ],
    [
      { code: '23505', constraint: 'fund_posting_types_code_key' },
      'FUND_POSTING_TYPE_CODE_ALREADY_EXISTS',
    ],
    [
      { code: '23514', constraint: 'fund_posting_rule_legs_target_strategy_check' },
      'FUND_POSTING_RULE_INVALID',
    ],
    [
      { code: '23514', constraint: 'fund_accounts_identity_immutable_check' },
      'FUND_ACCOUNT_STATE_CHANGED',
    ],
    [
      { code: 'P2002', meta: { target: ['accountId', 'accountSequence'] } },
      'FUND_CONCURRENT_STATE_CHANGED',
    ],
  ])('maps only structured database facts: %#', (error, code) => {
    expectMapped(error, code)
  })

  it.each(['P2034', '40001', '40P01', '55P03', '57014'])(
    'maps retryable concurrency code %s without database details',
    code => {
      const mapped = expectMapped(
        { code, message: 'must-not-leak database detail' },
        'FUND_CONCURRENT_STATE_CHANGED',
      )
      expect(mapped.message).not.toContain('must-not-leak')
      expect(mapped.retryable).toBe(true)
    },
  )

  it('identifies the scoped idempotency race for later winner replay', () => {
    expect(isFundIdempotencyUniqueViolation({
      code: 'P2002',
      meta: {
        constraint: 'fund_posting_batches_consumer_source_idempotency_key',
      },
    })).toBe(true)
    expect(isFundIdempotencyUniqueViolation({
      code: '23505',
      constraint: {
        fields: ['consumer_code', 'business_source_id', 'idempotency_key_hash'],
      },
    })).toBe(true)
    expect(isFundIdempotencyUniqueViolation({
      code: 'P2002',
      meta: { target: ['businessId'] },
    })).toBe(false)
  })

  it('preserves known errors and fails closed for unstructured or hostile errors', () => {
    const existing = new FundPostingError('FUND_ACCOUNT_NOT_FOUND')
    expect(mapFundPersistenceError(existing)).toBe(existing)

    for (const error of [
      new Error('P2002 fund_accounts_user_id_key must-not-leak'),
      { message: '23505 fund_business_sources_code_key must-not-leak' },
      null,
    ]) {
      const mapped = expectMapped(error, 'FUND_INTERNAL_ERROR')
      expect(mapped.message).toBe('资金服务内部错误')
    }
  })
})
