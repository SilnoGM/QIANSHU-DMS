import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CryptoNumberingRandomSource,
  renderRandomSegment,
  type NumberingRandomSource,
} from './random-source'
import type { NumberingRandomSegment } from './rule-types'

class ScriptedRandomSource implements NumberingRandomSource {
  private cursor = 0

  constructor(private readonly values: readonly number[]) {}

  nextInt(maxExclusive: number): number {
    const value = this.values[this.cursor]
    this.cursor += 1

    if (value === undefined || value >= maxExclusive) {
      throw new Error('deterministic test source exhausted or out of range')
    }

    return value
  }
}

function randomSegment(
  letterLength: number,
  digitLength: number,
  mode: NumberingRandomSegment['mode'],
): NumberingRandomSegment {
  return { type: 'RANDOM', letterLength, digitLength, mode }
}

describe('numbering random source and renderer', () => {
  it('renders exact uppercase letters followed by exact digits', () => {
    expect(renderRandomSegment(
      randomSegment(3, 2, 'LETTERS_THEN_DIGITS'),
      new ScriptedRandomSource([0, 1, 25, 9, 0]),
    )).toBe('ABZ90')
    expect(renderRandomSegment(
      randomSegment(3, 0, 'LETTERS_THEN_DIGITS'),
      new ScriptedRandomSource([25, 0, 12]),
    )).toBe('ZAM')
    expect(renderRandomSegment(
      randomSegment(0, 3, 'LETTERS_THEN_DIGITS'),
      new ScriptedRandomSource([9, 0, 5]),
    )).toBe('905')
  })

  it('shuffles positions without changing exact letter and digit counts', () => {
    const output = renderRandomSegment(
      randomSegment(2, 2, 'SHUFFLED'),
      // 先生成 AZ18，再执行 replacement indexes 0、1、0。
      new ScriptedRandomSource([0, 25, 1, 8, 0, 1, 0]),
    )

    expect(output).toBe('18ZA')
    expect(output.match(/[A-Z]/gu)).toHaveLength(2)
    expect(output.match(/[0-9]/gu)).toHaveLength(2)
  })

  it('rejects an invalid segment or out-of-range injected source', () => {
    const invalidMode = {
      ...randomSegment(1, 1, 'SHUFFLED'),
      mode: 'UNKNOWN',
    } as unknown as NumberingRandomSegment

    expect(() => renderRandomSegment(
      invalidMode,
      new ScriptedRandomSource([0, 0]),
    )).toThrow(RangeError)
    expect(() => renderRandomSegment(
      randomSegment(1, 0, 'LETTERS_THEN_DIGITS'),
      { nextInt: () => 26 },
    )).toThrow(RangeError)
  })

  it('uses the production crypto adapter within the requested bound', () => {
    const source = new CryptoNumberingRandomSource()

    for (let index = 0; index < 128; index += 1) {
      const value = source.nextInt(26)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(26)
    }

    for (const maxExclusive of [0, -1, 1.5, Number.NaN]) {
      expect(() => source.nextInt(maxExclusive)).toThrow(RangeError)
    }
  })

  it('statically excludes the unsafe pseudo-random API from source and tests', () => {
    const forbiddenToken = ['Math', 'random'].join('.')
    const files = [
      'random-source.ts',
      'random-source.spec.ts',
      'random-retry.ts',
      'random-retry.spec.ts',
      'preview.ts',
      'preview.spec.ts',
      'renderer.ts',
    ]

    for (const file of files) {
      expect(readFileSync(join(__dirname, file), 'utf8'))
        .not.toContain(forbiddenToken)
    }

    const productionSource = readFileSync(
      join(__dirname, 'random-source.ts'),
      'utf8',
    )
    expect(productionSource).toContain("from 'node:crypto'")
    expect(productionSource).toContain('randomInt(maxExclusive)')
  })
})
