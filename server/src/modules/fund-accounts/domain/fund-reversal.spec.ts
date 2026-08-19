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
    ['100', 'CREDIT', '-40.00', 'DEBIT'],
    ['-100', 'DEBIT', '40.00', 'CREDIT'],
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
        cumulativeReversedAmount: '40.00',
        reversalState: 'PARTIAL',
        entries: [
          {
            originalLineNo: 1,
            accountTarget: 'USER',
            direction: reversedDirection,
            amountStrategy: 'USER_SHARE',
            amount: '12.00',
          },
          {
            originalLineNo: 2,
            accountTarget: 'COMPANY',
            direction: reversedDirection,
            amountStrategy: 'COMPANY_REMAINDER',
            amount: '28.00',
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
      .toEqual(['10.00', '23.33'])

    const second = calculateFundReversal({
      originalBatchKind: 'BUSINESS',
      originalBusinessAmount: '100',
      userShareRateSnapshot: '30',
      entries: splitEntries('CREDIT', ['10.00', '23.33']),
      reversalAmount: '33.33',
    })
    expect(second.entries.map((entry) => entry.amount))
      .toEqual(['10.00', '23.33'])
    expect(second.cumulativeReversedAmount).toBe('66.66')

    const final = calculateFundReversal({
      originalBatchKind: 'BUSINESS',
      originalBusinessAmount: '100',
      userShareRateSnapshot: '30',
      entries: splitEntries('CREDIT', ['20.00', '46.66']),
      reversalAmount: '33.34',
    })
    expect(final.entries.map((entry) => entry.amount))
      .toEqual(['10.00', '23.34'])
    expect(final.cumulativeReversedAmount).toBe('100.00')
    expect(final.reversalState).toBe('FULL')
  })

  it('closes exactly against original entry snapshots on the final reversal', () => {
    const result = calculateFundReversal({
      originalBatchKind: 'MANUAL_ADJUSTMENT',
      originalBusinessAmount: '0.03',
      userShareRateSnapshot: '33.33',
      entries: [
        {
          originalLineNo: 1,
          accountTarget: 'USER',
          direction: 'CREDIT',
          amountStrategy: 'USER_SHARE',
          amount: '0.01',
          reversedAmount: '0',
        },
        {
          originalLineNo: 2,
          accountTarget: 'COMPANY',
          direction: 'CREDIT',
          amountStrategy: 'COMPANY_REMAINDER',
          amount: '0.02',
          reversedAmount: '0.01',
        },
      ],
      reversalAmount: '0.02',
    })

    expect(result.reversalState).toBe('FULL')
    expect(result.entries.map((entry) => entry.amount))
      .toEqual(['0.01', '0.01'])
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
