import { resolveFundTransactionSummary } from './fund-summary'

describe('fund transaction summary', () => {
  it('removes the duplicated withdrawal number from legacy summaries', () => {
    expect(resolveFundTransactionSummary({
      postingTypeCode: 'USER_WITHDRAWAL',
      businessNo: 'WD/20261017-0002',
      summary: '用户提款 WD/20261017-0002',
    })).toBe('用户提款')
  })

  it('keeps the new clean withdrawal summary and unrelated summaries unchanged', () => {
    expect(resolveFundTransactionSummary({
      postingTypeCode: 'USER_WITHDRAWAL',
      businessNo: 'WD/20261017-0002',
      summary: '用户提款',
    })).toBe('用户提款')
    expect(resolveFundTransactionSummary({
      postingTypeCode: 'ORDER_SETTLEMENT',
      businessNo: 'SO/20261017-0001',
      summary: '订单结算 SO/20261017-0001',
    })).toBe('订单结算 SO/20261017-0001')
    expect(resolveFundTransactionSummary({
      postingTypeCode: 'USER_WITHDRAWAL',
      businessNo: 'WD/20261017-0002',
      summary: '用户提款',
    })).toBe('用户提款')
  })
})
