import { renderNumberingCandidate } from './renderer'
import { getNumberingPeriodKey } from './period'
import {
  type NumberingRuleConfig,
  NumberingRuleConfigError,
} from './rule-types'

const DATABASE_TIME = new Date('2026-07-28T16:00:00.000Z')

describe('numbering renderer runtime guard', () => {
  it('renders fixed, separator, date and sequence in the declared order', () => {
    const config: NumberingRuleConfig = {
      resetPolicy: 'DAILY',
      segments: [
        { type: 'FIXED', value: 'PO' },
        { type: 'SEPARATOR', value: '/' },
        { type: 'DATE', format: 'YYYYMMDD' },
        { type: 'SEPARATOR', value: '-' },
        {
          type: 'SEQUENCE',
          width: 4,
          startValue: '7',
          step: '3',
        },
      ],
    }

    expect(renderNumberingCandidate(config, DATABASE_TIME, 10n, undefined))
      .toBe('PO/20260729-0010')
  })

  it.each([
    ['YYYY', '2026'],
    ['YY', '26'],
    ['MM', '07'],
    ['DD', '29'],
    ['YYYYMM', '202607'],
    ['YYYYMMDD', '20260729'],
    ['YYMMDD', '260729'],
  ] as const)('renders DATE format %s inside an ordered candidate', (
    format,
    expected,
  ) => {
    const config: NumberingRuleConfig = {
      resetPolicy: 'NEVER',
      segments: [
        { type: 'DATE', format },
        { type: 'SEPARATOR', value: '-' },
        {
          type: 'SEQUENCE',
          width: 1,
          startValue: '0',
          step: '1',
        },
      ],
    }

    expect(renderNumberingCandidate(config, DATABASE_TIME, 0n, undefined))
      .toBe(`${expected}-0`)
  })

  it('renders sequence start, step and final value without wrapping', () => {
    const config: NumberingRuleConfig = {
      resetPolicy: 'NEVER',
      segments: [{
        type: 'SEQUENCE',
        width: 3,
        startValue: '5',
        step: '7',
      }],
    }

    expect(renderNumberingCandidate(config, DATABASE_TIME, 5n, undefined))
      .toBe('005')
    expect(renderNumberingCandidate(config, DATABASE_TIME, 12n, undefined))
      .toBe('012')
    expect(renderNumberingCandidate(config, DATABASE_TIME, 999n, undefined))
      .toBe('999')
    expect(() => renderNumberingCandidate(
      config,
      DATABASE_TIME,
      1_006n,
      undefined,
    )).toThrow(RangeError)
  })

  it.each([
    [new Date('2026-07-28T15:59:59.999Z'), '20260728'],
    [new Date('2026-07-28T16:00:00.000Z'), '20260729'],
  ])('uses one database instant for period and DATE rendering', (
    databaseTime,
    expectedDate,
  ) => {
    const config: NumberingRuleConfig = {
      resetPolicy: 'DAILY',
      segments: [
        { type: 'DATE', format: 'YYYYMMDD' },
        {
          type: 'SEQUENCE',
          width: 1,
          startValue: '0',
          step: '1',
        },
      ],
    }

    expect(getNumberingPeriodKey('DAILY', databaseTime)).toBe(expectedDate)
    expect(renderNumberingCandidate(config, databaseTime, 0n, undefined))
      .toBe(`${expectedDate}0`)
  })

  it('never reads Date.now when an explicit database instant is supplied', () => {
    const now = jest.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not be read')
    })
    const config: NumberingRuleConfig = {
      resetPolicy: 'YEARLY',
      segments: [
        { type: 'DATE', format: 'YYYY' },
        {
          type: 'SEQUENCE',
          width: 1,
          startValue: '0',
          step: '1',
        },
      ],
    }

    try {
      expect(getNumberingPeriodKey('YEARLY', DATABASE_TIME)).toBe('2026')
      expect(renderNumberingCandidate(config, DATABASE_TIME, 0n, undefined))
        .toBe('20260')
    } finally {
      now.mockRestore()
    }
  })

  it('accepts exactly 64 output characters and the full frozen alphabet', () => {
    const maxLengthConfig: NumberingRuleConfig = {
      resetPolicy: 'NEVER',
      segments: [
        { type: 'FIXED', value: 'A'.repeat(63) },
        {
          type: 'SEQUENCE',
          width: 1,
          startValue: '0',
          step: '1',
        },
      ],
    }
    const alphabetConfig: NumberingRuleConfig = {
      resetPolicy: 'NEVER',
      segments: [
        { type: 'FIXED', value: 'AZ09' },
        { type: 'SEPARATOR', value: '_' },
        { type: 'SEPARATOR', value: '.' },
        { type: 'SEPARATOR', value: '/' },
        { type: 'SEPARATOR', value: '-' },
        {
          type: 'SEQUENCE',
          width: 1,
          startValue: '0',
          step: '1',
        },
      ],
    }

    expect(renderNumberingCandidate(
      maxLengthConfig,
      DATABASE_TIME,
      0n,
      undefined,
    )).toHaveLength(64)
    expect(renderNumberingCandidate(
      alphabetConfig,
      DATABASE_TIME,
      0n,
      undefined,
    )).toBe('AZ09_./-0')
  })

  it.each([
    {
      resetPolicy: 'NEVER',
      segments: [],
    },
    {
      resetPolicy: 'NEVER',
      segments: [
        { type: 'FIXED', value: 'A'.repeat(64) },
        { type: 'SEQUENCE', width: 1, startValue: '0', step: '1' },
      ],
    },
    {
      resetPolicy: 'DAILY',
      segments: [
        { type: 'SEQUENCE', width: 1, startValue: '0', step: '1' },
      ],
    },
    {
      resetPolicy: 'NEVER',
      segments: [
        { type: 'SEQUENCE', width: 19, startValue: '0', step: '1' },
      ],
    },
  ])('maps a damaged persisted config to NumberingRuleConfigError', (
    damagedConfig,
  ) => {
    expect(() => renderNumberingCandidate(
      damagedConfig as NumberingRuleConfig,
      DATABASE_TIME,
      0n,
      undefined,
    )).toThrow(NumberingRuleConfigError)
  })

  it.each([':', '@'])(
    'rejects a damaged snapshot containing %s outside the frozen alphabet',
    (invalidCharacter) => {
      // 模拟绕过正常配置校验的损坏持久化快照，验证渲染边界仍会 fail closed。
      const damagedConfig = {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: invalidCharacter },
          {
            type: 'SEQUENCE',
            width: 1,
            startValue: '0',
            step: '1',
          },
        ],
      } as NumberingRuleConfig

      expect(() => renderNumberingCandidate(
        damagedConfig,
        DATABASE_TIME,
        0n,
        undefined,
      )).toThrow(NumberingRuleConfigError)
    },
  )
})
