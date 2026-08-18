import { normalizeFundMetadata } from './fund-metadata'
import { FundPostingError } from './fund-posting.errors'

function expectMetadataInvalid(value: unknown): void {
  expect(() => normalizeFundMetadata(value)).toThrow(
    expect.objectContaining<Partial<FundPostingError>>({
      code: 'FUND_METADATA_INVALID',
    }),
  )
}

describe('fund metadata boundary', () => {
  it('copies, code-point sorts and deeply freezes scalar metadata', () => {
    const input = Object.create(null) as Record<string, unknown>
    input.z = '最后'
    input.a = null
    input.enabled = true
    input.count = -0

    const result = normalizeFundMetadata(input)
    expect(result).toEqual({ a: null, count: 0, enabled: true, z: '最后' })
    expect(Object.keys(result)).toEqual(['a', 'count', 'enabled', 'z'])
    expect(Object.isFrozen(result)).toBe(true)
    input.z = '已篡改'
    expect(result.z).toBe('最后')
  })

  it('does not invoke accessors while rejecting them', () => {
    let getterCalls = 0
    const input = {}
    Object.defineProperty(input, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'must-not-be-read'
      },
    })

    expectMetadataInvalid(input)
    expect(getterCalls).toBe(0)
  })

  it.each([
    [['array']],
    [{ nested: { value: 1 } }],
    [{ value: Number.NaN }],
    [{ value: Number.POSITIVE_INFINITY }],
    [Object.fromEntries([['__proto__', null]])],
    [{ constructor: 'unsafe' }],
    [{ prototype: 'unsafe' }],
    [{ 'bad key': 'unsafe' }],
    [{ value: 'x'.repeat(513) }],
    [Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`k${index}`, index]))],
  ])('rejects unsupported metadata shape %#', (value) => {
    expectMetadataInvalid(value)
  })

  it('rejects symbol keys and serialized payloads above 8192 UTF-8 bytes', () => {
    expectMetadataInvalid({ [Symbol('secret')]: 'value' })
    expectMetadataInvalid(Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`k${index}`, '😀'.repeat(512)]),
    ))
  })
})
