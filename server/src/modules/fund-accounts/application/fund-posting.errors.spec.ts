import { FUND_POSTING_ERROR_CODES, FundPostingError } from './fund-posting.errors'

describe('fund posting error contract', () => {
  it('publishes the exact stable error code catalog', () => {
    expect(Object.values(FUND_POSTING_ERROR_CODES)).toEqual([
      'FUND_AMOUNT_INVALID',
      'FUND_SHARE_RATE_INVALID',
      'FUND_POSTING_AMOUNT_INVALID',
      'FUND_POSTING_RULE_INVALID',
      'FUND_ADJUSTMENT_MODE_INVALID',
      'FUND_REVERSAL_TARGET_INVALID',
      'FUND_REVERSAL_SNAPSHOT_INVALID',
      'FUND_REVERSAL_EXCEEDS_REMAINING',
      'FUND_VALIDATION_FAILED',
      'FUND_USER_NOT_FOUND',
      'FUND_ACCOUNT_NOT_FOUND',
      'FUND_ACCOUNT_ALREADY_EXISTS',
      'FUND_ACCOUNT_UNAVAILABLE',
      'FUND_ACCOUNT_STATE_CHANGED',
      'FUND_COMPANY_ACCOUNT_UNAVAILABLE',
      'FUND_BUSINESS_SOURCE_NOT_FOUND',
      'FUND_BUSINESS_SOURCE_DISABLED',
      'FUND_BUSINESS_SOURCE_CODE_ALREADY_EXISTS',
      'FUND_POSTING_TYPE_NOT_FOUND',
      'FUND_POSTING_TYPE_DISABLED',
      'FUND_POSTING_TYPE_CODE_ALREADY_EXISTS',
      'FUND_POSTING_TYPE_NOT_ALLOWED',
      'FUND_POSTING_RULE_UNAVAILABLE',
      'FUND_POSTING_BATCH_NOT_FOUND',
      'FUND_CONFIG_STATE_CHANGED',
      'FUND_USER_REQUIRED',
      'FUND_METADATA_INVALID',
      'FUND_IDEMPOTENCY_CONFLICT',
      'FUND_REVERSAL_STATE_CHANGED',
      'FUND_REVERSAL_REQUIRES_RECEIPT_VOID',
      'FUND_CONCURRENT_STATE_CHANGED',
      'FUND_INTERNAL_ERROR',
    ])
  })

  it('uses fixed safe messages and only marks concurrency as retryable', () => {
    const concurrency = new FundPostingError(
      FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED,
    )
    expect(concurrency.message).toBe('资金状态发生并发变化，请重试')
    expect(concurrency.retryable).toBe(true)

    const internal = new FundPostingError(
      FUND_POSTING_ERROR_CODES.INTERNAL_ERROR,
      'amount',
    )
    expect(internal.message).toBe('资金服务内部错误')
    expect(internal.field).toBe('amount')
    expect(internal.retryable).toBe(false)
    expect(JSON.stringify(internal)).not.toContain('secret')
  })
})
