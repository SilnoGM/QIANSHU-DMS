import {
  getNumberingPeriodKey,
  getShanghaiDateParts,
  renderNumberingDate,
} from './period'

describe('numbering period and date', () => {
  it('uses the supplied database instant and crosses Shanghai midnight', () => {
    const beforeMidnight = new Date('2026-07-28T15:59:59.999Z')
    const midnight = new Date('2026-07-28T16:00:00.000Z')

    expect(getShanghaiDateParts(beforeMidnight)).toEqual({
      year: '2026',
      month: '07',
      day: '28',
    })
    expect(getShanghaiDateParts(midnight)).toEqual({
      year: '2026',
      month: '07',
      day: '29',
    })
    expect(getNumberingPeriodKey('DAILY', beforeMidnight)).toBe('20260728')
    expect(getNumberingPeriodKey('DAILY', midnight)).toBe('20260729')
  })

  it('crosses Shanghai month-end using the same supplied instant', () => {
    expect(getNumberingPeriodKey(
      'MONTHLY',
      new Date('2026-08-31T15:59:59.999Z'),
    )).toBe('202608')
    expect(getNumberingPeriodKey(
      'MONTHLY',
      new Date('2026-08-31T16:00:00.000Z'),
    )).toBe('202609')
  })

  it('crosses Shanghai year-end using the same supplied instant', () => {
    expect(getNumberingPeriodKey(
      'YEARLY',
      new Date('2026-12-31T15:59:59.999Z'),
    )).toBe('2026')
    expect(getNumberingPeriodKey(
      'YEARLY',
      new Date('2026-12-31T16:00:00.000Z'),
    )).toBe('2027')
    expect(getNumberingPeriodKey(
      'NEVER',
      new Date('2026-12-31T16:00:00.000Z'),
    )).toBe('ALL')
  })

  it.each([
    ['YYYY', '2026'],
    ['YY', '26'],
    ['MM', '07'],
    ['DD', '29'],
    ['YYYYMM', '202607'],
    ['YYYYMMDD', '20260729'],
    ['YYMMDD', '260729'],
  ] as const)('renders %s in Asia/Shanghai as %s', (format, expected) => {
    expect(renderNumberingDate(
      format,
      new Date('2026-07-28T16:00:00.000Z'),
    )).toBe(expected)
  })

  it('rejects an invalid database instant instead of reading another clock', () => {
    expect(() => getShanghaiDateParts(new Date('invalid'))).toThrow()
  })
})
