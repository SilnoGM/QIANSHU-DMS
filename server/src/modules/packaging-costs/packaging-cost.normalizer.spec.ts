import { normalizePackagingCostCreate, packagingCostIdempotencyKey } from './packaging-cost.normalizer'

const input = {
  shipmentId: '00000000-0000-4000-8000-000000000001', packagingType: 'WOODEN_BOX', packagingVendor: 'OTHER', amount: '120.50',
  packagingImageMediaAssetId: '00000000-0000-4000-8000-000000000002', quotationImageMediaAssetId: '00000000-0000-4000-8000-000000000003',
}

describe('packaging cost submission normalization', () => {
  it('normalizes CNY without floats and permits OTHER without a vendor name', () => {
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
