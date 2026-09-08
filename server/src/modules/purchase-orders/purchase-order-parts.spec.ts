import { normalizePurchaseOrderParts } from './purchase-order-parts'

const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const lines = [{ lineNumber: 1, quantity: 5 }, { lineNumber: 2, quantity: 2 }]
const valid = [
  { key: KEY, items: [{ lineNumber: 1, quantity: 2 }] },
  { key: OTHER_KEY, items: [{ lineNumber: 2, quantity: 2 }, { lineNumber: 1, quantity: 3 }] },
]

describe('purchase order part allocation', () => {
  it('rejects more than 10000 allocation items before database work', () => {
    const manyLines = Array.from({ length: 100 }, (_, index) => ({ lineNumber: index + 1, quantity: 101 }))
    const parts = Array.from({ length: 101 }, (_, index) => ({
      key: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
      items: manyLines.map(line => ({ lineNumber: line.lineNumber, quantity: 1 })),
    }))
    expect(() => normalizePurchaseOrderParts(parts, manyLines)).toThrow()
  })
  it('supports splitting and merging, sorting only item references', () => {
    expect(normalizePurchaseOrderParts(valid, lines)).toEqual([
      valid[0], { ...valid[1], items: [...valid[1].items].reverse() },
    ])
  })

  it.each([
    undefined, [], [{ key: KEY, items: [] }],
    [{ key: KEY, items: [{ lineNumber: 1, quantity: 5 }] }],
    [{ key: KEY, items: [{ lineNumber: 1, quantity: 6 }, { lineNumber: 2, quantity: 2 }] }],
    [{ key: KEY, items: [{ lineNumber: 1, quantity: 2 }, { lineNumber: 1, quantity: 3 }, { lineNumber: 2, quantity: 2 }] }],
    [valid[0], { ...valid[1], key: KEY }],
    [{ ...valid[0], key: 'invalid' }, valid[1]],
    [{ key: KEY, items: [{ lineNumber: 3, quantity: 5 }] }],
    [{ key: KEY, items: [{ lineNumber: 1, quantity: 0 }] }],
    [{ key: KEY, items: [{ lineNumber: 1, quantity: 1.5 }] }],
    [{ key: KEY, items: [{ lineNumber: 1, quantity: -1 }] }],
    [{ key: KEY, items: [{ lineNumber: 1, quantity: 5, unknown: true }, { lineNumber: 2, quantity: 2 }] }],
    Array.from({ length: 1001 }, () => valid[0]),
  ])('rejects invalid or incomplete configuration %#', (parts) => {
    expect(() => normalizePurchaseOrderParts(parts, lines)).toThrow()
  })
})
