import {
  INITIAL_FUND_POSTING_RULES,
  calculateFundPostingPlan,
  validateFundPostingRule,
} from './fund-rule-engine'

function requireInitialRule(postingTypeCode: string) {
  const rule = INITIAL_FUND_POSTING_RULES.find(
    (candidate) => candidate.postingTypeCode === postingTypeCode,
  )

  if (!rule) throw new Error(`Missing test rule: ${postingTypeCode}`)
  return rule
}

describe('fund posting rule engine', () => {
  it('ships exactly nine valid initial posting rules', () => {
    expect(INITIAL_FUND_POSTING_RULES).toHaveLength(9)
    for (const rule of INITIAL_FUND_POSTING_RULES) {
      expect(validateFundPostingRule(rule)).toBe(rule)
    }
  })

  it.each([
    ['100', 'CREDIT'],
    ['-100', 'DEBIT'],
  ] as const)(
    'splits signed order settlement %s into %s entries',
    (amount, direction) => {
      expect(calculateFundPostingPlan({
        rule: requireInitialRule('ORDER_SETTLEMENT'),
        amount,
        userShareRate: '30',
      })).toEqual({
        businessAmount: `${amount}.0000`,
        userShareRate: '30.0000',
        companyShareRate: '70.0000',
        entries: [
          {
            accountTarget: 'USER',
            direction,
            amountStrategy: 'USER_SHARE',
            amount: '30.0000',
          },
          {
            accountTarget: 'COMPANY',
            direction,
            amountStrategy: 'COMPANY_REMAINDER',
            amount: '70.0000',
          },
        ],
      })
    },
  )

  it('rejects a zero order settlement', () => {
    expect(() => calculateFundPostingPlan({
      rule: requireInitialRule('ORDER_SETTLEMENT'),
      amount: '0',
      userShareRate: '30',
    })).toThrow('业务金额必须为非零值')
  })

  it.each([
    ['USER_WITHDRAWAL', [['USER', '100.0000']]],
    [
      'PURCHASE_PAYMENT',
      [['USER', '30.0000'], ['COMPANY', '70.0000']],
    ],
    ['RENT_UTILITIES', [['COMPANY', '100.0000']]],
    [
      'BUSINESS_ACCOUNT_FEE',
      [['USER', '30.0000'], ['COMPANY', '70.0000']],
    ],
    [
      'ADVERTISING_FEE',
      [['USER', '30.0000'], ['COMPANY', '70.0000']],
    ],
    [
      'NETWORK_IP_VPN_FEE',
      [['USER', '30.0000'], ['COMPANY', '70.0000']],
    ],
    [
      'INVOICE_FEE',
      [['USER', '30.0000'], ['COMPANY', '70.0000']],
    ],
  ] as const)(
    'calculates the fixed debit rule %s',
    (postingTypeCode, expectedEntries) => {
      const result = calculateFundPostingPlan({
        rule: requireInitialRule(postingTypeCode),
        amount: '100',
        ...(postingTypeCode === 'RENT_UTILITIES'
          ? {}
          : { userShareRate: '30' }),
      })

      expect(result.entries.map((entry) => [
        entry.accountTarget,
        entry.amount,
      ])).toEqual(expectedEntries)
      expect(result.entries.every((entry) => entry.direction === 'DEBIT'))
        .toBe(true)
    },
  )

  it('rejects zero and negative amounts for positive-only rules', () => {
    const withdrawal = requireInitialRule('USER_WITHDRAWAL')

    for (const amount of ['0', '-1']) {
      expect(() => calculateFundPostingPlan({
        rule: withdrawal,
        amount,
        userShareRate: '30',
      })).toThrow('业务金额必须大于零')
    }
  })

  it.each([
    ['USER_ONLY', '100', [['USER', 'CREDIT', '100.0000']]],
    ['USER_ONLY', '-100', [['USER', 'DEBIT', '100.0000']]],
    [
      'USER_AND_COMPANY_BY_SHARE',
      '100',
      [
        ['USER', 'CREDIT', '30.0000'],
        ['COMPANY', 'CREDIT', '70.0000'],
      ],
    ],
    [
      'USER_AND_COMPANY_BY_SHARE',
      '-100',
      [
        ['USER', 'DEBIT', '30.0000'],
        ['COMPANY', 'DEBIT', '70.0000'],
      ],
    ],
  ] as const)(
    'calculates admin adjustment mode %s with amount %s',
    (adjustmentMode, amount, expectedEntries) => {
      const result = calculateFundPostingPlan({
        rule: requireInitialRule('ADMIN_MANUAL_ADJUSTMENT'),
        amount,
        userShareRate: '30',
        adjustmentMode,
      })

      expect(result.entries.map((entry) => [
        entry.accountTarget,
        entry.direction,
        entry.amount,
      ])).toEqual(expectedEntries)
    },
  )

  it('omits zero-value legs for zero and one-hundred-percent shares', () => {
    const rule = requireInitialRule('ORDER_SETTLEMENT')

    expect(calculateFundPostingPlan({
      rule,
      amount: '100',
      userShareRate: '0',
    }).entries).toEqual([
      expect.objectContaining({ accountTarget: 'COMPANY', amount: '100.0000' }),
    ])
    expect(calculateFundPostingPlan({
      rule,
      amount: '100',
      userShareRate: '100',
    }).entries).toEqual([
      expect.objectContaining({ accountTarget: 'USER', amount: '100.0000' }),
    ])
  })

  it.each([
    {
      name: 'duplicate account target',
      change: {
        legs: [
          {
            position: 1,
            accountTarget: 'USER',
            directionPolicy: 'DEBIT',
            amountStrategy: 'FULL_AMOUNT',
          },
          {
            position: 2,
            accountTarget: 'USER',
            directionPolicy: 'DEBIT',
            amountStrategy: 'FULL_AMOUNT',
          },
        ],
      },
    },
    {
      name: 'non-conserving split',
      change: {
        legs: [
          {
            position: 1,
            accountTarget: 'USER',
            directionPolicy: 'DEBIT',
            amountStrategy: 'USER_SHARE',
          },
        ],
      },
    },
    {
      name: 'missing requiresUser flag',
      change: { requiresUser: false },
    },
    {
      name: 'fixed direction on a signed rule',
      change: {
        legs: [
          {
            position: 1,
            accountTarget: 'USER',
            directionPolicy: 'DEBIT',
            amountStrategy: 'USER_SHARE',
          },
          {
            position: 2,
            accountTarget: 'COMPANY',
            directionPolicy: 'DEBIT',
            amountStrategy: 'COMPANY_REMAINDER',
          },
        ],
      },
    },
  ])('rejects invalid rule configuration: $name', ({ change }) => {
    const base = requireInitialRule('ORDER_SETTLEMENT')
    expect(() => validateFundPostingRule({ ...base, ...change }))
      .toThrow('资金动账规则无效')
  })

  it('requires USER_ONLY adjustment to target only the selected user', () => {
    const base = requireInitialRule('ADMIN_MANUAL_ADJUSTMENT')
    expect(() => validateFundPostingRule({
      ...base,
      legs: [
        {
          ...base.legs[0],
          accountTarget: 'COMPANY',
        },
        base.legs[1],
        base.legs[2],
      ],
    })).toThrow('资金动账规则无效')
  })
})
