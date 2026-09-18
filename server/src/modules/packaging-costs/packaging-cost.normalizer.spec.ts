import { normalizePackagingCostCreate, normalizePackagingCostAmountUpdate, packagingCostIdempotencyKey } from './packaging-cost.normalizer'

const input = {
  shipmentId: '00000000-0000-4000-8000-000000000001', packagingType: 'WOODEN_BOX', packagingVendor: 'CHENGXIN', amount: '120.50',
  packagingImageMediaAssetId: '00000000-0000-4000-8000-000000000002', quotationImageMediaAssetId: '00000000-0000-4000-8000-000000000003',
}

describe('packaging cost submission normalization', () => {
  it('normalizes CNY without floats and preserves the configured vendor', () => {
    expect(normalizePackagingCostCreate({ ...input, remark: '  加固  ' })).toEqual({ ...input, amount: '120.5000', remark: '加固' })
  })
  it.each(['0', '-1', '0.001', '1e3', 'NaN', '100000000000000000000000000'])('rejects an invalid CNY amount %s', amount => {
    expect(() => normalizePackagingCostCreate({ ...input, amount })).toThrow()
  })
  it.each([
    { ownerUserId: input.shipmentId }, { shipmentNo: 'spoof' }, { otherVendorName: 'x' }, { packagingImageMediaAssetId: undefined },
    { quotationImageMediaAssetId: input.packagingImageMediaAssetId }, { packagingVendor: 'UNKNOWN' }, { remark: '字'.repeat(501) },
  ])('rejects untrusted identity and invalid evidence %j', change => {
    expect(() => normalizePackagingCostCreate({ ...input, ...change })).toThrow()
  })
  it('requires a canonical retry identity', () => {
    expect(packagingCostIdempotencyKey(input.shipmentId)).toBe(input.shipmentId)
    expect(() => packagingCostIdempotencyKey(undefined)).toThrow()
    expect(() => packagingCostIdempotencyKey('different')).toThrow()
  })
})

const qr = { paymentMethod: 'ALIPAY', recipientName: '收款人', qrMediaAssetId: '00000000-0000-4000-8000-000000000004' }
describe('packaging payment recipients', () => {
  it('requires at least one QR recipient for OTHER', () => {
    expect(() => normalizePackagingCostCreate({ ...input, packagingVendor: 'OTHER' })).toThrow()
    expect(normalizePackagingCostCreate({ ...input, packagingVendor: 'OTHER', paymentRecipients: [qr] }).paymentRecipients).toHaveLength(1)
  })
  it('rejects overriding CHENGXIN and bank-transfer packaging recipients', () => {
    expect(() => normalizePackagingCostCreate({ ...input, paymentRecipients: [qr] })).toThrow()
    expect(() => normalizePackagingCostCreate({ ...input, packagingVendor: 'OTHER', paymentRecipients: [{ paymentMethod: 'BANK_TRANSFER', recipientName: '收款人', bankName: '银行', bankAccount: '123' }] })).toThrow()
  })
})


describe('packaging cost amount correction normalization', () => {
  it('normalizes two-place CNY with a required integer version', () => {
    expect(normalizePackagingCostAmountUpdate({ amount: '150.5', expectedVersion: 3 })).toEqual({ amount: '150.5000', expectedVersion: 3 })
  })
  it.each([
    { amount: '0' }, { amount: '-1' }, { amount: '1.234' }, { amount: '1e3' }, { amount: 5 },
    { amount: '9'.repeat(27) }, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: '1' },
    { status: 'PAID' }, { ownerUserId: input.shipmentId },
  ])('rejects invalid amount/version and immutable field updates %j', change => {
    expect(() => normalizePackagingCostAmountUpdate({ amount: '150', expectedVersion: 1, ...change })).toThrow()
  })
})
