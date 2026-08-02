import {
  calculateRandomCapacity,
  calculateRuleCapacity,
  calculateSequenceCapacity,
  calculateSequenceState,
  formatSequenceValue,
} from './capacity'
import type {
  NumberingRandomSegment,
  NumberingRuleConfig,
  NumberingSequenceSegment,
} from './rule-engine'

function sequence(
  width: number,
  startValue: string,
  step: string,
): NumberingSequenceSegment {
  return { type: 'SEQUENCE', width, startValue, step }
}

function random(
  letterLength: number,
  digitLength: number,
  mode: NumberingRandomSegment['mode'],
): NumberingRandomSegment {
  return { type: 'RANDOM', letterLength, digitLength, mode }
}

describe('numbering capacity', () => {
  it('uses the exact sequence formula and formats values with left zeroes', () => {
    const segment = sequence(6, '1', '2')

    expect(calculateSequenceCapacity(segment)).toBe(500_000n)
    expect(calculateSequenceState(segment, '0')).toEqual({
      capacity: 500_000n,
      usedCount: 0n,
      remainingCount: 500_000n,
      nextSequenceValue: 1n,
      exhausted: false,
    })
    expect(calculateSequenceState(segment, '1').nextSequenceValue).toBe(3n)
    expect(formatSequenceValue(segment, 1n)).toBe('000001')
    expect(formatSequenceValue(segment, 3n)).toBe('000003')
  })

  it('returns the last value once, then reports exhaustion without wrapping', () => {
    const segment = sequence(6, '1', '2')
    const capacity = calculateSequenceCapacity(segment)
    const last = calculateSequenceState(segment, capacity - 1n)
    const exhausted = calculateSequenceState(segment, capacity)

    expect(last.nextSequenceValue).toBe(999_999n)
    expect(formatSequenceValue(segment, last.nextSequenceValue!))
      .toBe('999999')
    expect(last.remainingCount).toBe(1n)
    expect(exhausted.nextSequenceValue).toBeNull()
    expect(exhausted.remainingCount).toBe(0n)
    expect(exhausted.exhausted).toBe(true)
    expect(() => formatSequenceValue(segment, 1_000_001n)).toThrow()
  })

  it('keeps 18-digit sequence arithmetic beyond Number.MAX_SAFE_INTEGER exact', () => {
    const segment = sequence(18, '0', '1')
    const capacity = calculateSequenceCapacity(segment)
    const last = calculateSequenceState(segment, capacity - 1n)

    expect(capacity).toBe(1_000_000_000_000_000_000n)
    expect(capacity > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(typeof capacity).toBe('bigint')
    expect(last.nextSequenceValue).toBe(999_999_999_999_999_999n)
    expect(formatSequenceValue(segment, last.nextSequenceValue!))
      .toBe('999999999999999999')
  })

  it('calculates both random modes with exact bigint formulas', () => {
    expect(calculateRandomCapacity(random(2, 2, 'LETTERS_THEN_DIGITS')))
      .toBe(67_600n)
    expect(calculateRandomCapacity(random(2, 2, 'SHUFFLED')))
      .toBe(405_600n)
  })

  it('rejects an unknown random mode at the exported capacity boundary', () => {
    const invalid = {
      type: 'RANDOM',
      letterLength: 2,
      digitLength: 2,
      mode: 'UNKNOWN',
    } as unknown as NumberingRandomSegment

    expect(() => calculateRandomCapacity(invalid)).toThrow(RangeError)
  })

  it('calculates the maximum valid random capacity without floating point loss', () => {
    // 在 L + D = 32 的合法空间内独立枚举后，SHUFFLED 最大项位于 L=23、D=9。
    const capacity = calculateRandomCapacity(random(23, 9, 'SHUFFLED'))

    expect(capacity.toString()).toBe(
      '9824292608176747495395639382139260108800000000000',
    )
    expect(capacity > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('uses sequence capacity for a mixed sequence and random rule', () => {
    const config: NumberingRuleConfig = {
      resetPolicy: 'NEVER',
      segments: [
        { type: 'FIXED', value: 'SO' },
        sequence(4, '10', '10'),
        random(8, 8, 'SHUFFLED'),
      ],
    }

    expect(calculateRuleCapacity(config)).toBe(999n)
  })

  it('uses random capacity for a pure-random rule', () => {
    const config: NumberingRuleConfig = {
      resetPolicy: 'NEVER',
      segments: [random(1, 2, 'LETTERS_THEN_DIGITS')],
    }

    expect(calculateRuleCapacity(config)).toBe(2_600n)
  })
})
