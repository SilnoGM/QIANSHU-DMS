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
    categoryName: ' 分类 ',
    productHeadName: ' 产品头 ',
    status: 'INACTIVE',
    supplierValue: 'SUPPLIER_A',
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
  it('uses the frozen product.create.v3 canonical field sequence', () => {
    expect(PRODUCT_CREATE_FINGERPRINT_VERSION).toBe('product.create.v3')
    expect(calculateProductCreateFingerprint(ACTOR_ID, payload()))
      .toBe('a27f0f92ba7b8cb25c6bbb31221a1598aa893fe8f4f2f95c6e5d04448a3540e0')
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
      calculateProductCreateFingerprint(ACTOR_ID, payload({ categoryName: '其他分类' })),
      calculateProductCreateFingerprint(ACTOR_ID, payload({ productHeadName: '其他产品头' })),
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
