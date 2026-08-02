import {
  validateIssuedRuleConfigCompatibility,
} from './numbering-config-compatibility'
import {
  type NumberingRuleConfig,
  NumberingRuleConfigError,
  type NumberingRuleSegment,
} from './rule-types'

function createBaseConfig(): NumberingRuleConfig {
  return {
    resetPolicy: 'NEVER',
    segments: [
      { type: 'FIXED', value: 'SO' },
      { type: 'DATE', format: 'YYYYMMDD' },
      { type: 'SEPARATOR', value: '-' },
      {
        type: 'SEQUENCE',
        width: 4,
        startValue: '1',
        step: '2',
      },
      {
        type: 'RANDOM',
        letterLength: 2,
        digitLength: 2,
        mode: 'SHUFFLED',
      },
    ],
  }
}

function replaceSegment(
  index: number,
  replacement: NumberingRuleSegment,
): NumberingRuleConfig {
  const config = createBaseConfig()
  return {
    ...config,
    segments: config.segments.map((segment, currentIndex) =>
      currentIndex === index ? replacement : segment),
  }
}

function captureCompatibilityError(
  previous: unknown,
  next: unknown,
): NumberingRuleConfigError {
  let thrown: unknown

  try {
    validateIssuedRuleConfigCompatibility(previous, next)
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(NumberingRuleConfigError)
  return thrown as NumberingRuleConfigError
}

function expectIssue(
  previous: unknown,
  next: unknown,
  path: string,
): void {
  expect(captureCompatibilityError(previous, next).issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ path })]),
  )
}

describe('issued numbering rule config compatibility', () => {
  it('allows an unchanged config and sequence width expansion', () => {
    const unchanged = createBaseConfig()
    const expanded = replaceSegment(3, {
      type: 'SEQUENCE',
      width: 8,
      startValue: '1',
      step: '2',
    })

    expect(validateIssuedRuleConfigCompatibility(
      createBaseConfig(),
      unchanged,
    )).toEqual(unchanged)
    expect(validateIssuedRuleConfigCompatibility(
      createBaseConfig(),
      expanded,
    )).toEqual(expanded)
  })

  it('rejects sequence width shrink with an exact issue path', () => {
    expectIssue(
      createBaseConfig(),
      replaceSegment(3, {
        type: 'SEQUENCE',
        width: 3,
        startValue: '1',
        step: '2',
      }),
      'segments[3].width',
    )
  })

  it('rejects reset policy, segment count and segment order changes', () => {
    const changedReset = {
      ...createBaseConfig(),
      resetPolicy: 'DAILY',
    }
    const addedSegment = {
      ...createBaseConfig(),
      segments: [
        ...createBaseConfig().segments,
        { type: 'SEPARATOR', value: '_' },
      ],
    }
    const reorderedBase = createBaseConfig()
    const reordered = {
      ...reorderedBase,
      segments: [
        reorderedBase.segments[1],
        reorderedBase.segments[0],
        ...reorderedBase.segments.slice(2),
      ],
    }

    expectIssue(createBaseConfig(), changedReset, 'resetPolicy')
    expectIssue(createBaseConfig(), addedSegment, 'segments')
    expectIssue(createBaseConfig(), reordered, 'segments[0].type')
  })

  it('rejects every frozen type-specific field with its exact path', () => {
    const cases: ReadonlyArray<{
      readonly path: string
      readonly next: NumberingRuleConfig
    }> = [
      {
        path: 'segments[0].value',
        next: replaceSegment(0, { type: 'FIXED', value: 'PO' }),
      },
      {
        path: 'segments[1].format',
        next: replaceSegment(1, { type: 'DATE', format: 'YYYYMM' }),
      },
      {
        path: 'segments[2].value',
        next: replaceSegment(2, { type: 'SEPARATOR', value: '/' }),
      },
      {
        path: 'segments[3].startValue',
        next: replaceSegment(3, {
          type: 'SEQUENCE',
          width: 4,
          startValue: '3',
          step: '2',
        }),
      },
      {
        path: 'segments[3].step',
        next: replaceSegment(3, {
          type: 'SEQUENCE',
          width: 4,
          startValue: '1',
          step: '3',
        }),
      },
      {
        path: 'segments[4].letterLength',
        next: replaceSegment(4, {
          type: 'RANDOM',
          letterLength: 3,
          digitLength: 2,
          mode: 'SHUFFLED',
        }),
      },
      {
        path: 'segments[4].digitLength',
        next: replaceSegment(4, {
          type: 'RANDOM',
          letterLength: 2,
          digitLength: 3,
          mode: 'SHUFFLED',
        }),
      },
      {
        path: 'segments[4].mode',
        next: replaceSegment(4, {
          type: 'RANDOM',
          letterLength: 2,
          digitLength: 2,
          mode: 'LETTERS_THEN_DIGITS',
        }),
      },
    ]

    for (const testCase of cases) {
      expectIssue(createBaseConfig(), testCase.next, testCase.path)
    }
  })

  it('validates both inputs first and fails closed on unknown fields', () => {
    const invalidPrevious = {
      ...createBaseConfig(),
      internalSecret: 'PREVIOUS_SECRET_VALUE',
    }
    const invalidNext = {
      ...createBaseConfig(),
      segments: createBaseConfig().segments.map((segment, index) =>
        index === 0
          ? { ...segment, leakedValue: 'NEXT_SECRET_VALUE' }
          : segment),
    }

    const previousError = captureCompatibilityError(
      invalidPrevious,
      createBaseConfig(),
    )
    const nextError = captureCompatibilityError(createBaseConfig(), invalidNext)

    expect(previousError.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'internalSecret' }),
    ]))
    expect(nextError.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'segments[0].leakedValue' }),
    ]))
    expect(JSON.stringify(previousError)).not.toContain('PREVIOUS_SECRET_VALUE')
    expect(JSON.stringify(nextError)).not.toContain('NEXT_SECRET_VALUE')
  })

  it('does not mutate either input object', () => {
    const previous = createBaseConfig()
    const next = replaceSegment(3, {
      type: 'SEQUENCE',
      width: 8,
      startValue: '1',
      step: '2',
    })
    const previousBefore = JSON.stringify(previous)
    const nextBefore = JSON.stringify(next)

    validateIssuedRuleConfigCompatibility(previous, next)

    expect(JSON.stringify(previous)).toBe(previousBefore)
    expect(JSON.stringify(next)).toBe(nextBefore)
  })
})
