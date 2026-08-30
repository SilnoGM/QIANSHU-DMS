import { normalizePurchaseOrderCreateCommand } from './purchase-order-command.normalizer'
import {
  calculatePurchaseOrderCreateFingerprint,
  hashPurchaseOrderIdempotencyKey,
  PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION,
  PURCHASE_ORDER_NUMBERING_CONSUMER_CODE,
  PURCHASE_ORDER_NUMBERING_RULE_CODE,
} from './purchase-order-create-fingerprint'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TODAY = '2026-08-27'

function payload(overrides: Record<string, unknown> = {}) {
  return normalizePurchaseOrderCreateCommand({
    purchaseType: 'STOCK',
    supplierValue: 'SUPPLIER_A',
    orderDate: TODAY,
    shippingMarkText: null,
    lines: [{
      lineType: 'CUSTOM',
      name: 'Custom item',
      description: null,
      referencePurchaseUnitPriceAmount: '10',
      actualPurchaseUnitPriceAmount: '10',
      quantity: 2,
    }],
    purchaseTotalAmount: '20',
    depositDueAmount: '5',
    balanceDueAmount: '15',
    remark: null,
    ...overrides,
  }, TODAY)
}

describe('purchase order create fingerprint', () => {
  it('uses the approved numbering scope and one stable SHA-256 v1 contract', () => {
    expect(PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION)
      .toBe('purchase-order.create.v1')
    expect(PURCHASE_ORDER_NUMBERING_RULE_CODE).toBe('PURCHASE_ORDER')
    expect(PURCHASE_ORDER_NUMBERING_CONSUMER_CODE).toBe('PURCHASE_ORDER.CREATE')
    expect(calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload()))
      .toMatch(/^[0-9a-f]{64}$/u)
    expect(calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload()))
      .toBe(calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload({
        purchaseTotalAmount: '20.00',
      })))
  })

  it('changes for actor, purchase type/source, supplier, shipping mark, or content', () => {
    const baseline = calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload())
    const variants = [
      calculatePurchaseOrderCreateFingerprint(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        payload(),
      ),
      calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload({ supplierValue: 'SUPPLIER_B' })),
      calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload({ shippingMarkText: 'MARK' })),
      calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload({ remark: 'x' })),
      calculatePurchaseOrderCreateFingerprint(ACTOR_ID, normalizePurchaseOrderCreateCommand({
        purchaseType: 'SALES_LINKED',
        salesOrderId: '11111111-1111-4111-8111-111111111111',
        supplierValue: 'SUPPLIER_A',
        orderDate: TODAY,
        lines: [{
          lineType: 'CUSTOM',
          sourceSalesOrderLineId: '22222222-2222-4222-8222-222222222222',
          name: '采购侧临时产品',
          description: '采购侧临时说明',
          referencePurchaseUnitPriceAmount: '10',
          actualPurchaseUnitPriceAmount: '10',
          quantity: 2,
        }],
        purchaseTotalAmount: '20',
        depositDueAmount: '5',
        balanceDueAmount: '15',
        remark: null,
      }, TODAY)),
    ]
    expect(new Set([baseline, ...variants]).size).toBe(variants.length + 1)
  })

  it('hashes idempotency keys before persistence', () => {
    const key = '123e4567-e89b-42d3-a456-426614174000'
    const hash = hashPurchaseOrderIdempotencyKey(key)
    expect(hash).toBeInstanceOf(Buffer)
    expect(hash).toHaveLength(32)
    expect(hash.toString('utf8')).not.toContain(key)
  })
})
