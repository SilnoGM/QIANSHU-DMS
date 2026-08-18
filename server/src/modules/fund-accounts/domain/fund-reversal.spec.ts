import {
  type FundOriginalEntryForReversal,
  calculateFundReversal,
  deriveFundReversalState,
} from './fund-reversal'

function splitEntries(
  direction: 'CREDIT' | 'DEBIT',
  reversedAmounts: readonly [string, string] = ['0', '0'],
): FundOriginalEntryForReversal[] {
  return [
    {
      originalLineNo: 1,
      accountTarget: 'USER',
      direction,
      amountStrategy: 'USER_SHARE',
      amount: '30',
      reversedAmount: reversedAmounts[0],
    },
    {
      originalLineNo: 2,
      accountTarget: 'COMPANY',
      direction,
      amountStrategy: 'COMPANY_REMAINDER',
      amount: '70',
      reversedAmount: reversedAmounts[1],
    },
  ]
}

describe('fund cumulative reversal calculation', () => {
  it.each([
    ['100', '0', 'NONE'],
    ['100', '40', 'PARTIAL'],
    ['100', '100', 'FULL'],
    ['-100', '40', 'PARTIAL'],
  ] as const)(
    'derives %s / %s as %s without storing state on the original batch',
    (originalAmount, cumulativeAmount, expected) => {
      expect(deriveFundReversalState(
        originalAmount,
        cumulativeAmount,
      )).toBe(expected)
    },
  )

  it.each([
    ['100', 'CREDIT', '-40.0000', 'DEBIT'],
    ['-100', 'DEBIT', '40.0000', 'CREDIT'],
  ] as const)(
    'reverses the signed business amount %s using opposite entries',
    (originalBusinessAmount, direction, reversalBusinessAmount, reversedDirection) => {
      expect(calculateFundReversal({
        originalBatchKind: 'BUSINESS',
        originalBusinessAmount,
        userShareRateSnapshot: '30',
        entries: splitEntries(direction),
        reversalAmount: '40',
      })).toEqual({
        reversalBusinessAmount,
        cumulativeReversedAmount: '40.0000',
        reversalState: 'PARTIAL',
        entries: [
          {
            originalLineNo: 1,
            accountTarget: 'USER',
            direction: reversedDirection,
            amountStrategy: 'USER_SHARE',
            amount: '12.0000',
          },
          {
            originalLineNo: 2,
            accountTarget: 'COMPANY',
            direction: reversedDirection,
            amountStrategy: 'COMPANY_REMAINDER',
            amount: '28.0000',
          },
        ],
      })
    },
  )

  it('uses cumulative targets across repeated partial reversals', () => {
    const first = calculateFundReversal({
      originalBatchKind: 'BUSINESS',
      originalBusinessAmount: '100',
      userShareRateSnapshot: '30',
      entries: splitEntries('CREDIT'),
      reversalAmount: '33.33',
    })
    expect(first.entries.map((entry) => entry.amount))
      .toEqual(['9.9990', '23.3310'])

    const second = calculateFundReversal({
      originalBatchKind: 'BUSINESS',
      originalBusinessAmount: '100',
      userShareRateSnapshot: '30',
      entries: splitEntries('CREDIT', ['9.9990', '23.3310']),
      reversalAmount: '33.33',
    })
    expect(second.entries.map((entry) => entry.amount))
      .toEqual(['9.9990', '23.3310'])
    expect(second.cumulativeReversedAmount).toBe('66.6600')

    const final = calculateFundReversal({
      originalBatchKind: 'BUSINESS',
      originalBusinessAmount: '100',
      userShareRateSnapshot: '30',
      entries: splitEntries('CREDIT', ['19.9980', '46.6620']),
      reversalAmount: '33.34',
    })
    expect(final.entries.map((entry) => entry.amount))
      .toEqual(['10.0020', '23.3380'])
    expect(final.cumulativeReversedAmount).toBe('100.0000')
    expect(final.reversalState).toBe('FULL')
  })

  it('closes exactly against original entry snapshots on the final reversal', () => {
    const result = calculateFundReversal({
      originalBatchKind: 'MANUAL_ADJUSTMENT',
      originalBusinessAmount: '0.0003',
      userShareRateSnapshot: '33.3333',
      entries: [
        {
          originalLineNo: 1,
          accountTarget: 'USER',
          direction: 'CREDIT',
          amountStrategy: 'USER_SHARE',
          amount: '0.0001',
          reversedAmount: '0',
        },
        {
          originalLineNo: 2,
          accountTarget: 'COMPANY',
          direction: 'CREDIT',
          amountStrategy: 'COMPANY_REMAINDER',
          amount: '0.0002',
          reversedAmount: '0.0001',
        },
      ],
      reversalAmount: '0.0002',
    })

    expect(result.reversalState).toBe('FULL')
    expect(result.entries.map((entry) => entry.amount))
      .toEqual(['0.0001', '0.0001'])
  })

  it('rejects reversal batches, invalid snapshots and excessive amounts', () => {
    expect(() => calculateFundReversal({
      originalBatchKind: 'REVERSAL',
      originalBusinessAmount: '100',
      userShareRateSnapshot: '30',
      entries: splitEntries('CREDIT'),
      reversalAmount: '1',
    })).toThrow('冲账目标无效')

    expect(() => calculateFundReversal({
      originalBatchKind: 'BUSINESS',
      originalBusinessAmount: '100',
      userShareRateSnapshot: '30',
      entries: splitEntries('CREDIT', ['18', '42']),
      reversalAmount: '41',
    })).toThrow('冲账金额超过剩余额度')

    expect(() => calculateFundReversal({
      originalBatchKind: 'BUSINESS',
      originalBusinessAmount: '100',
      userShareRateSnapshot: '30',
      entries: splitEntries('CREDIT', ['31', '0']),
      reversalAmount: '1',
    })).toThrow('冲账快照无效')
  })
})
