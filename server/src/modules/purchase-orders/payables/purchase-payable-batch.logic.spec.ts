import { randomUUID } from 'node:crypto'
import { batchPaymentIdentity, normalizeBatchPayment } from './purchase-payable-batch.logic'

function request() {
  return { supplierValue: 'SUPPLIER', paymentMethod: 'BANK_TRANSFER', recipientAccountId: randomUUID(), recipientProfileVersion: 1,
    items: [1, 2].map(() => ({ payableId: randomUUID(), expectedVersion: 1, voucher: { mediaAssetId: randomUUID() } })) }
}

describe('purchase payable batch normalization', () => {
  it('canonicalizes selection order but fingerprints the complete batch and all versions, recipients and vouchers', () => {
    const input = request(), actor = randomUUID(), key = randomUUID()
    const original = batchPaymentIdentity(actor, key, normalizeBatchPayment(input))
    expect(batchPaymentIdentity(actor, key, normalizeBatchPayment({ ...input, items: [...input.items].reverse() }))).toEqual(original)
    for (const changed of [
      { ...input, items: input.items.slice(0, 1) },
      { ...input, items: [...input.items, { payableId: randomUUID(), expectedVersion: 1, voucher: { mediaAssetId: randomUUID() } }] },
      { ...input, recipientAccountId: randomUUID() }, { ...input, recipientProfileVersion: 2 },
      { ...input, supplierValue: 'OTHER' }, { ...input, paymentMethod: 'ALIPAY' },
      { ...input, items: input.items.map((item, index) => index ? item : { ...item, expectedVersion: 2 }) },
      { ...input, items: input.items.map((item, index) => index ? item : { ...item, voucher: { mediaAssetId: randomUUID() } }) },
    ]) {
      const identity = batchPaymentIdentity(actor, key, normalizeBatchPayment(changed))
      expect(identity.rootKeyHash).toEqual(original.rootKeyHash)
      expect(identity.fingerprint).not.toEqual(original.fingerprint)
    }
  })
  it('rejects incomplete, duplicate and extra input instead of silently accepting an ambiguous batch', () => {
    const input = request()
    for (const invalid of [null, { ...input, items: [] }, { ...input, amount: '0.01' },
      { ...input, recipientProfileVersion: 0 }, { ...input, supplierValue: '' },
      { ...input, items: [input.items[0], input.items[0]] },
      { ...input, items: input.items.map(item => ({ ...item, voucher: input.items[0].voucher })) },
      { ...input, items: [{ ...input.items[0], expectedVersion: 0 }] },
      { ...input, items: [{ ...input.items[0], voucher: { mediaAssetId: randomUUID(), amount: '1' } }] },
    ]) expect(() => normalizeBatchPayment(invalid)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})
