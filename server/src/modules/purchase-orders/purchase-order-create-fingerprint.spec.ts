import { normalizePurchaseOrderCreateCommand } from './purchase-order-command.normalizer'
import {
  calculatePurchaseOrderCreateFingerprint,
  hashPurchaseOrderIdempotencyKey,
  PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION,
  PURCHASE_ORDER_CENTS_FINGERPRINT_VERSION,
  PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION,
  PURCHASE_ORDER_PART_ISSUED_FINGERPRINT_VERSION,
  PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION,
  PURCHASE_ORDER_NUMBERING_CONSUMER_CODE,
  PURCHASE_ORDER_NUMBERING_RULE_CODE,
} from './purchase-order-create-fingerprint'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TODAY = '2026-08-27'

function payload(overrides: Record<string, unknown> = {}) {
  return normalizePurchaseOrderCreateCommand({
    parts: [{ key: ACTOR_ID, items: [{ lineNumber: 1, quantity: 2 }] }],
    purchaseType: 'STOCK',
    productMode: 'CUSTOM',
    paymentAccounts: [{ paymentMethod: 'BANK_TRANSFER', recipientName: 'Supplier', bankName: 'Bank', bankAccount: '123' }],
    customSupplierName: '供应商 A',
    orderDate: TODAY,
    expectedShippingMarkResolution: 'a'.repeat(64),
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
  it('preserves the exact committed v3 fingerprint bytes', () => {
    // 固定值由改造前 HEAD 的真实 v3 实现计算，守住旧未知结果请求恢复契约。
    expect(calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload(), PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION))
      .toBe('e584c78bf0c13aa892153fbf79f753f299f118ee6cd23915b8feeaa300bce0ff')
  })

  it('preserves the exact committed v4 fingerprint bytes after v5 rollout', () => {
    expect(calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload(), PURCHASE_ORDER_PART_ISSUED_FINGERPRINT_VERSION))
      .toBe('d33df2c1e6619d1c14b1b55b151ad529627dd0e3a6e44041c86a8159cb4ca820')
  })

  it('preserves the exact committed v5 fingerprint bytes after cents normalization', () => {
    expect(calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload(), PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION))
      .toBe('1fcfb48e809791043e7e07ada77eaa2e516498055050650afd4264c9bfd3ecd1')
  })

  it('preserves the exact committed v6 cents fingerprint after recipient rollout', () => {
    // 固定值来自本轮修改前 HEAD 的真实 v6 实现，不能用当前实现重新生成基准。
    expect(calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload(), PURCHASE_ORDER_CENTS_FINGERPRINT_VERSION))
      .toBe('cda4e4aeaf2f17c30a293675ccefb687ef4da42f451f39483030406bc3cf1020')
  })

  it('changes v6 when part identity, order or allocation changes', () => {
    const first = payload({ parts: [{ key: ACTOR_ID, items: [{ lineNumber: 1, quantity: 2 }] }] })
    const split = payload({ parts: [
      { key: ACTOR_ID, items: [{ lineNumber: 1, quantity: 1 }] },
      { key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', items: [{ lineNumber: 1, quantity: 1 }] },
    ] })
    const reversed = { ...split, parts: [...split.parts].reverse() }
    expect(new Set([first, split, reversed].map(value => calculatePurchaseOrderCreateFingerprint(ACTOR_ID, value))).size).toBe(3)
  })
  it('uses the approved numbering scope and one stable SHA-256 v6 contract', () => {
    expect(PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION)
      .toBe('purchase-order.create.v7')
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
      calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload({ customSupplierName: '供应商 B' })),
      calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload({ expectedShippingMarkResolution: 'b'.repeat(64) })),
      calculatePurchaseOrderCreateFingerprint(ACTOR_ID, payload({ remark: 'x' })),
      calculatePurchaseOrderCreateFingerprint(ACTOR_ID, normalizePurchaseOrderCreateCommand({
        parts: [{ key: ACTOR_ID, items: [{ lineNumber: 1, quantity: 2 }] }],
        purchaseType: 'SALES_LINKED',
        productMode: 'CUSTOM',
    paymentAccounts: [{ paymentMethod: 'BANK_TRANSFER', recipientName: 'Supplier', bankName: 'Bank', bankAccount: '123' }],
        salesOrderId: '11111111-1111-4111-8111-111111111111',
        customSupplierName: '供应商 A',
        orderDate: TODAY,
        expectedShippingMarkResolution: 'a'.repeat(64),
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
