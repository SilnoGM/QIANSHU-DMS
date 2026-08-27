import { normalizeSalesOrderCreateCommand } from './sales-order-command.normalizer'
import {
  calculateSalesOrderCreateFingerprint,
  hashSalesOrderIdempotencyKey,
  SALES_ORDER_CREATE_FINGERPRINT_VERSION,
} from './sales-order-create-fingerprint'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TODAY = '2026-08-20'

function payload(overrides: Record<string, unknown> = {}) {
  return normalizeSalesOrderCreateCommand({
    orderDate: TODAY,
    currencyCode: 'MYR',
    customer: {
      name: 'Customer',
      phone: '0123456789',
      countryRegionId: '11111111-1111-4111-8111-111111111111',
      provinceStateId: '22222222-2222-4222-8222-222222222222',
      cityId: '33333333-3333-4333-8333-333333333333',
      addressDetail: 'Street 1',
    },
    lines: [{
      lineType: 'CUSTOM',
      name: 'Custom item',
      description: null,
      actualUnitPriceAmount: '10',
      quantity: 2,
    }],
    agreedTotalAmount: '20',
    depositDueAmount: '5',
    balanceDueAmount: '15',
    issuanceVoucher: {
      mediaAssetId: '55555555-5555-4555-8555-555555555555',
    },
    remark: null,
    ...overrides,
  }, TODAY)
}

describe('sales order create fingerprint', () => {
  it('uses one stable SHA-256 v1 contract', () => {
    expect(SALES_ORDER_CREATE_FINGERPRINT_VERSION)
      .toBe('sales-order.create.v1')
    expect(calculateSalesOrderCreateFingerprint(ACTOR_ID, payload()))
      .toMatch(/^[0-9a-f]{64}$/u)
    expect(calculateSalesOrderCreateFingerprint(ACTOR_ID, payload()))
      .toBe(calculateSalesOrderCreateFingerprint(ACTOR_ID, payload({
        agreedTotalAmount: '20.0000',
      })))
  })

  it('changes for actor, issuance voucher, or business content', () => {
    const baseline = calculateSalesOrderCreateFingerprint(ACTOR_ID, payload())
    const variants = [
      calculateSalesOrderCreateFingerprint(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        payload(),
      ),
      calculateSalesOrderCreateFingerprint(ACTOR_ID, payload({
        customer: {
          name: 'Other',
          phone: '0123456789',
          countryRegionId: '11111111-1111-4111-8111-111111111111',
          provinceStateId: '22222222-2222-4222-8222-222222222222',
          cityId: '33333333-3333-4333-8333-333333333333',
          addressDetail: 'Street 1',
        },
      })),
      calculateSalesOrderCreateFingerprint(ACTOR_ID, payload({ remark: 'x' })),
      calculateSalesOrderCreateFingerprint(ACTOR_ID, payload({
        issuanceVoucher: {
          mediaAssetId: '66666666-6666-4666-8666-666666666666',
        },
      })),
    ]
    expect(new Set([baseline, ...variants]).size).toBe(variants.length + 1)
  })

  it('hashes idempotency keys before persistence', () => {
    const key = '123e4567-e89b-42d3-a456-426614174000'
    const hash = hashSalesOrderIdempotencyKey(key)
    expect(hash).toBeInstanceOf(Buffer)
    expect(hash).toHaveLength(32)
    expect(hash.toString('utf8')).not.toContain(key)
  })
})
