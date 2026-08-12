import {
  normalizeProductCreateCommand,
} from './product-command.normalizer'
import {
  calculateProductCreateFingerprint,
  PRODUCT_CREATE_FINGERPRINT_VERSION,
} from './product-create-fingerprint'

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'

function payload(overrides: Record<string, unknown> = {}) {
  return normalizeProductCreateCommand({
    name: ' Cafe\u0301 ',
    status: 'DRAFT',
    supplierValue: null,
    twdSalePrice: { amount: '1.0', currency: 'TWD' },
    myrSalePrice: { amount: null, currency: 'MYR' },
    purchaseCost: { amount: '20.50', currency: 'CNY' },
    attributes: [
      { title: ' Color ', value: ' Re\u0301d ' },
      { title: 'Color', value: 'Blue' },
    ],
    ...overrides,
  })
}

describe('calculateProductCreateFingerprint', () => {
  it('uses the frozen product.create.v1 canonical field sequence', () => {
    expect(PRODUCT_CREATE_FINGERPRINT_VERSION).toBe('product.create.v1')
    expect(calculateProductCreateFingerprint(ACTOR_ID, payload()))
      .toBe('f1a460b23261ef36591879c1a78f0eaa57018d0595b208e96640b1df04b47112')
  })

  it('treats equivalent decimal scale and NFC text as the same payload', () => {
    const canonical = calculateProductCreateFingerprint(ACTOR_ID, payload())
    const equivalent = calculateProductCreateFingerprint(ACTOR_ID, payload({
      name: 'Café',
      twdSalePrice: { amount: '1.0000', currency: 'TWD' },
      attributes: [
        { title: 'Color', value: 'Réd' },
        { title: 'Color', value: 'Blue' },
      ],
    }))

    expect(equivalent).toBe(canonical)
  })

  it('changes for actor, null/value, attribute order, or payload changes', () => {
    const baseline = calculateProductCreateFingerprint(ACTOR_ID, payload())
    const variants = [
      calculateProductCreateFingerprint(
        '22222222-2222-4222-8222-222222222222',
        payload(),
      ),
      calculateProductCreateFingerprint(ACTOR_ID, payload({
        myrSalePrice: { amount: '0', currency: 'MYR' },
      })),
      calculateProductCreateFingerprint(ACTOR_ID, payload({
        attributes: [
          { title: 'Color', value: 'Blue' },
          { title: 'Color', value: 'Réd' },
        ],
      })),
      calculateProductCreateFingerprint(ACTOR_ID, payload({ name: 'Other' })),
    ]

    expect(new Set([baseline, ...variants]).size).toBe(variants.length + 1)
  })

  it.each([
    '11111111-1111-1111-8111-111111111111',
    '11111111-1111-4111-7111-111111111111',
    '11111111-1111-4111-8111-11111111111A',
  ])('rejects a non-canonical actor without hashing input: %s', (actorId) => {
    expect(() => calculateProductCreateFingerprint(actorId, payload()))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})
