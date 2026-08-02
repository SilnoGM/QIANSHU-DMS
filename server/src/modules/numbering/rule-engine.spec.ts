import {
  NumberingRuleConfigError,
  validateNumberingRuleConfig,
} from './rule-engine'

function expectInvalidConfig(
  input: unknown,
  expectedPath?: string,
): void {
  let thrown: unknown

  try {
    validateNumberingRuleConfig(input)
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(NumberingRuleConfigError)

  if (expectedPath !== undefined) {
    expect((thrown as NumberingRuleConfigError).issues)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: expectedPath }),
      ]))
  }
}

describe('numbering rule engine validation', () => {
  it('rejects a non-object config, invalid reset policy and non-array segments', () => {
    expectInvalidConfig(null, '')
    expectInvalidConfig(
      { resetPolicy: 'WEEKLY', segments: [] },
      'resetPolicy',
    )
    expectInvalidConfig(
      { resetPolicy: 'NEVER', segments: {} },
      'segments',
    )
  })

  it('accepts the five exact discriminated segment shapes in order', () => {
    const input = {
      resetPolicy: 'NEVER',
      segments: [
        { type: 'FIXED', value: 'SO' },
        { type: 'DATE', format: 'YYYYMMDD' },
        { type: 'SEPARATOR', value: '-' },
        {
          type: 'SEQUENCE',
          width: 6,
          startValue: '1',
          step: '2',
        },
        {
          type: 'RANDOM',
          letterLength: 2,
          digitLength: 2,
          mode: 'LETTERS_THEN_DIGITS',
        },
      ],
    }

    expect(validateNumberingRuleConfig(input)).toEqual(input)
  })

  it('rejects an empty template, more than 32 segments and no capacity segment', () => {
    expectInvalidConfig(
      { resetPolicy: 'NEVER', segments: [] },
      'segments',
    )
    expectInvalidConfig(
      {
        resetPolicy: 'NEVER',
        segments: Array.from(
          { length: 33 },
          () => ({ type: 'FIXED', value: 'A' }),
        ),
      },
      'segments',
    )
    expectInvalidConfig(
      {
        resetPolicy: 'NEVER',
        segments: [{ type: 'FIXED', value: 'SO' }],
      },
      'segments',
    )
  })

  it('rejects more than one sequence or random segment', () => {
    const sequence = {
      type: 'SEQUENCE',
      width: 2,
      startValue: '0',
      step: '1',
    }
    const random = {
      type: 'RANDOM',
      letterLength: 1,
      digitLength: 1,
      mode: 'SHUFFLED',
    }

    expectInvalidConfig(
      { resetPolicy: 'NEVER', segments: [sequence, sequence] },
      'segments',
    )
    expectInvalidConfig(
      { resetPolicy: 'NEVER', segments: [random, random] },
      'segments',
    )
  })

  it.each([
    [{ type: 'FIXED' }, 'segments[0].value'],
    [
      { type: 'FIXED', value: 'SO', format: 'YYYY' },
      'segments[0].format',
    ],
    [{ type: 'DATE', format: 'WEEK' }, 'segments[0].format'],
    [{ type: 'SEPARATOR', value: ':' }, 'segments[0].value'],
    [
      {
        type: 'SEQUENCE',
        width: 4,
        startValue: '1',
        step: '1',
        mode: 'SHUFFLED',
      },
      'segments[0].mode',
    ],
    [
      { type: 'RANDOM', letterLength: 2, digitLength: 2 },
      'segments[0].mode',
    ],
    [
      {
        type: 'RANDOM',
        letterLength: 2,
        digitLength: 2,
        mode: 'RANDOM',
      },
      'segments[0].mode',
    ],
    [{ type: 'UNKNOWN', value: 'X' }, 'segments[0].type'],
    [null, 'segments[0]'],
  ])('rejects an invalid or cross-type segment shape: %j', (segment, path) => {
    expectInvalidConfig(
      { resetPolicy: 'NEVER', segments: [segment] },
      path,
    )
  })

  it.each([
    { type: 'FIXED', value: 'SO' },
    { type: 'DATE', format: 'YYYY' },
    { type: 'SEPARATOR', value: '-' },
    { type: 'SEQUENCE', width: 2, startValue: '0', step: '1' },
    {
      type: 'RANDOM',
      letterLength: 1,
      digitLength: 1,
      mode: 'SHUFFLED',
    },
  ])('rejects unknown fields on segment %j', (segment) => {
    expectInvalidConfig(
      {
        resetPolicy: 'NEVER',
        segments: [{ ...segment, unexpected: true }],
      },
      'segments[0].unexpected',
    )
  })

  it.each([
    ['', 'segments[0].value'],
    ['so', 'segments[0].value'],
    ['SO-', 'segments[0].value'],
    ['A'.repeat(65), 'segments[0].value'],
  ])('rejects invalid FIXED value %j', (value, path) => {
    expectInvalidConfig(
      {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value },
          {
            type: 'SEQUENCE',
            width: 1,
            startValue: '0',
            step: '1',
          },
        ],
      },
      path,
    )
  })

  it.each(['YYYY', 'YY', 'MM', 'DD', 'YYYYMM', 'YYYYMMDD', 'YYMMDD'])(
    'accepts the DATE whitelist value %s for NEVER rules',
    (format) => {
      expect(() => validateNumberingRuleConfig({
        resetPolicy: 'NEVER',
        segments: [
          { type: 'DATE', format },
          {
            type: 'SEQUENCE',
            width: 1,
            startValue: '0',
            step: '1',
          },
        ],
      })).not.toThrow()
    },
  )

  it('accepts exactly 64 output characters and rejects 65', () => {
    expect(() => validateNumberingRuleConfig({
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
    })).not.toThrow()

    expectInvalidConfig(
      {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: 'A'.repeat(63) },
          {
            type: 'SEQUENCE',
            width: 2,
            startValue: '0',
            step: '1',
          },
        ],
      },
      'segments',
    )
  })

  it.each([
    [0, '0', '1'],
    [19, '0', '1'],
    [1.5, '0', '1'],
    [2, '-1', '1'],
    [2, '00', '1'],
    [2, '100', '1'],
    [2, '0', '0'],
    [2, '0', '100'],
  ])(
    'rejects sequence width=%s start=%s step=%s outside the exact range',
    (width, startValue, step) => {
      expectInvalidConfig(
        {
          resetPolicy: 'NEVER',
          segments: [{
            type: 'SEQUENCE',
            width,
            startValue,
            step,
          }],
        },
        'segments[0]',
      )
    },
  )

  it.each([
    [-1, 1],
    [33, 0],
    [0, 0],
    [32, 1],
    [1.5, 1],
  ])(
    'rejects random letterLength=%s digitLength=%s outside the exact range',
    (letterLength, digitLength) => {
      expectInvalidConfig(
        {
          resetPolicy: 'NEVER',
          segments: [{
            type: 'RANDOM',
            letterLength,
            digitLength,
            mode: 'SHUFFLED',
          }],
        },
        'segments[0]',
      )
    },
  )

  it.each([
    [
      'YEARLY',
      [{ type: 'DATE', format: 'MM' }],
    ],
    [
      'MONTHLY',
      [{ type: 'DATE', format: 'YYYY' }],
    ],
    [
      'DAILY',
      [{ type: 'DATE', format: 'YYYYMM' }],
    ],
    [
      'YEARLY',
      [
        { type: 'DATE', format: 'YY' },
        { type: 'DATE', format: 'YYYY' },
      ],
    ],
    [
      'DAILY',
      [
        { type: 'DATE', format: 'YYMMDD' },
        { type: 'DATE', format: 'YYYYMMDD' },
      ],
    ],
  ])(
    'rejects reset/date grain mismatch for %s',
    (resetPolicy, dateSegments) => {
      expectInvalidConfig(
        {
          resetPolicy,
          segments: [
            ...dateSegments,
            {
              type: 'SEQUENCE',
              width: 2,
              startValue: '0',
              step: '1',
            },
          ],
        },
        'segments',
      )
    },
  )

  it.each([
    ['YEARLY', [{ type: 'DATE', format: 'YYYY' }]],
    [
      'MONTHLY',
      [
        { type: 'DATE', format: 'YYYY' },
        { type: 'DATE', format: 'MM' },
      ],
    ],
    ['DAILY', [{ type: 'DATE', format: 'YYYYMMDD' }]],
  ])('accepts the required four-digit date grain for %s', (
    resetPolicy,
    dateSegments,
  ) => {
    expect(() => validateNumberingRuleConfig({
      resetPolicy,
      segments: [
        ...dateSegments,
        {
          type: 'SEQUENCE',
          width: 2,
          startValue: '0',
          step: '1',
        },
      ],
    })).not.toThrow()
  })

  it.each([
    ['NEVER', [{ type: 'DATE', format: 'YYYY' }]],
    ['YEARLY', [{ type: 'DATE', format: 'YYYYMM' }]],
    ['MONTHLY', [{ type: 'DATE', format: 'YYYYMMDD' }]],
  ])(
    'rejects pure-random DATE grain that varies inside %s',
    (resetPolicy, dateSegments) => {
      expectInvalidConfig(
        {
          resetPolicy,
          segments: [
            ...dateSegments,
            {
              type: 'RANDOM',
              letterLength: 2,
              digitLength: 2,
              mode: 'SHUFFLED',
            },
          ],
        },
        'segments',
      )
    },
  )

  it.each([
    ['NEVER', []],
    ['YEARLY', [{ type: 'DATE', format: 'YYYY' }]],
    ['MONTHLY', [{ type: 'DATE', format: 'YYYYMM' }]],
    [
      'MONTHLY',
      [
        { type: 'DATE', format: 'YYYY' },
        { type: 'DATE', format: 'MM' },
      ],
    ],
    ['DAILY', [{ type: 'DATE', format: 'YYYYMMDD' }]],
    [
      'DAILY',
      [
        { type: 'DATE', format: 'YYYY' },
        { type: 'DATE', format: 'MM' },
        { type: 'DATE', format: 'DD' },
      ],
    ],
  ])(
    'accepts pure-random DATE grain exactly matching %s',
    (resetPolicy, dateSegments) => {
      expect(() => validateNumberingRuleConfig({
        resetPolicy,
        segments: [
          ...dateSegments,
          {
            type: 'RANDOM',
            letterLength: 2,
            digitLength: 2,
            mode: 'SHUFFLED',
          },
        ],
      })).not.toThrow()
    },
  )

  it('rejects config-level fields outside the pure input contract', () => {
    expectInvalidConfig(
      {
        resetPolicy: 'NEVER',
        timezone: 'Asia/Shanghai',
        segments: [{
          type: 'SEQUENCE',
          width: 2,
          startValue: '0',
          step: '1',
        }],
      },
      'timezone',
    )
  })
})
