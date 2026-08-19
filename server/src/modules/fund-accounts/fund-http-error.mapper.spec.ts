import { ApiException } from '../../infrastructure/http/api.exception'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
} from './application/fund-posting.errors'
import { mapFundHttpError } from './fund-http-error.mapper'

describe('mapFundHttpError', () => {
  it.each([
    [FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND, 404],
    [FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED, 409],
    [FUND_POSTING_ERROR_CODES.POSTING_AMOUNT_INVALID, 422],
  ] as const)('maps %s to HTTP %i', (code, status) => {
    const exception = mapFundHttpError(new FundPostingError(code, 'amount'))

    expect(exception).toBeInstanceOf(ApiException)
    expect(exception.getStatus()).toBe(status)
    expect(exception.code).toBe(code)
    expect(exception.fieldErrors).toEqual({
      amount: [new FundPostingError(code).message],
    })
  })

  it('fails closed for damaged reversal snapshots and unknown errors', () => {
    const damaged = mapFundHttpError(new FundPostingError(
      FUND_POSTING_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID,
    ))
    const unknown = mapFundHttpError(new Error('sensitive-canary'))

    for (const exception of [damaged, unknown]) {
      expect(exception.getStatus()).toBe(500)
      expect(exception.code).toBe(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
      expect(exception.publicMessage).toBe('资金服务内部错误')
      expect(JSON.stringify(exception)).not.toContain('sensitive-canary')
    }
  })

  it('preserves an already-safe API exception', () => {
    const safe = new ApiException(403, 'FORBIDDEN', '没有权限执行此操作')

    expect(mapFundHttpError(safe)).toBe(safe)
  })
})
