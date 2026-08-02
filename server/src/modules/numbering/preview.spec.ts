import type { NumberingRandomSource } from './random-source'
import { previewNumberingRule } from './rule-engine'

class ZeroRandomSource implements NumberingRandomSource {
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) {
      throw new Error('maxExclusive must be positive')
    }

    return 0
  }
}

const DATABASE_TIME = new Date('2026-07-28T16:00:00.000Z')

describe('numbering pure preview', () => {
  it('renders sequence samples and decimal-string statistics without mutation', () => {
    const config = {
      resetPolicy: 'DAILY',
      segments: [
        { type: 'FIXED', value: 'SO' },
        { type: 'DATE', format: 'YYYYMMDD' },
        { type: 'SEPARATOR', value: '-' },
        {
          type: 'SEQUENCE',
          width: 3,
          startValue: '1',
          step: '1',
        },
      ],
    } as const
    const before = JSON.stringify(config)

    const result = previewNumberingRule({
      config,
      databaseTime: DATABASE_TIME,
      usedCount: '0',
    })

    expect(JSON.stringify(config)).toBe(before)
    expect(result).toEqual({
      timezone: 'Asia/Shanghai',
      periodKey: '20260729',
      maxOutputLength: 14,
      capacity: '999',
      usedCount: '0',
      remainingCount: '999',
      nextSequenceValue: '1',
      nextNumberPreview: 'SO20260729-001',
      nextNumberDeterministic: true,
      periodStatus: 'AVAILABLE',
      samples: [
        'SO20260729-001',
        'SO20260729-002',
        'SO20260729-003',
        'SO20260729-004',
        'SO20260729-005',
      ],
    })
  })

  it('returns null next values and no samples after sequence exhaustion', () => {
    const result = previewNumberingRule({
      config: {
        resetPolicy: 'NEVER',
        segments: [{
          type: 'SEQUENCE',
          width: 1,
          startValue: '9',
          step: '1',
        }],
      },
      databaseTime: DATABASE_TIME,
      usedCount: '1',
    })

    expect(result).toEqual(expect.objectContaining({
      capacity: '1',
      remainingCount: '0',
      nextSequenceValue: null,
      nextNumberPreview: null,
      nextNumberDeterministic: true,
      periodStatus: 'EXHAUSTED',
      samples: [],
    }))
  })

  it('keeps pure-random next values null while still showing format samples', () => {
    const result = previewNumberingRule({
      config: {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: 'R' },
          {
            type: 'RANDOM',
            letterLength: 1,
            digitLength: 1,
            mode: 'LETTERS_THEN_DIGITS',
          },
        ],
      },
      databaseTime: DATABASE_TIME,
      usedCount: '0',
      randomSource: new ZeroRandomSource(),
    })

    expect(result).toEqual(expect.objectContaining({
      capacity: '260',
      nextSequenceValue: null,
      nextNumberPreview: null,
      nextNumberDeterministic: false,
      samples: ['RA0', 'RA0', 'RA0', 'RA0', 'RA0'],
    }))
  })

  it('uses the next sequence in mixed non-reserving random samples', () => {
    const result = previewNumberingRule({
      config: {
        resetPolicy: 'NEVER',
        segments: [
          {
            type: 'SEQUENCE',
            width: 2,
            startValue: '1',
            step: '2',
          },
          {
            type: 'RANDOM',
            letterLength: 1,
            digitLength: 0,
            mode: 'LETTERS_THEN_DIGITS',
          },
        ],
      },
      databaseTime: DATABASE_TIME,
      usedCount: '1',
      randomSource: new ZeroRandomSource(),
    })

    expect(result).toEqual(expect.objectContaining({
      nextSequenceValue: '3',
      nextNumberPreview: '03A',
      nextNumberDeterministic: false,
      samples: ['03A', '05A', '07A', '09A', '11A'],
    }))
  })

  it('returns at most the available capacity instead of fabricating five samples', () => {
    const result = previewNumberingRule({
      config: {
        resetPolicy: 'NEVER',
        segments: [{
          type: 'SEQUENCE',
          width: 1,
          startValue: '8',
          step: '1',
        }],
      },
      databaseTime: DATABASE_TIME,
      usedCount: '0',
    })

    expect(result.samples).toEqual(['8', '9'])
  })

  it('keeps large capacity and sequence values as decimal strings', () => {
    const result = previewNumberingRule({
      config: {
        resetPolicy: 'NEVER',
        segments: [{
          type: 'SEQUENCE',
          width: 18,
          startValue: '0',
          step: '1',
        }],
      },
      databaseTime: DATABASE_TIME,
      usedCount: '9007199254740992',
    })

    expect(result.capacity).toBe('1000000000000000000')
    expect(result.usedCount).toBe('9007199254740992')
    expect(result.nextSequenceValue).toBe('9007199254740992')
    expect(result.samples[0]).toBe('009007199254740992')
  })
})
