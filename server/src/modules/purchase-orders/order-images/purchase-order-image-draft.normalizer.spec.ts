import { normalizePurchaseOrderImageDraftInput } from './purchase-order-image-draft.normalizer'

describe('normalizePurchaseOrderImageDraftInput', () => {
  it('defaults ordinary generation to resume an existing image', () => {
    expect(normalizePurchaseOrderImageDraftInput({ expectedVersion: 3 })).toEqual({ expectedVersion: 3, regenerate: false })
  })

  it('permits an explicit regeneration', () => {
    expect(normalizePurchaseOrderImageDraftInput({ expectedVersion: 3, regenerate: true })).toEqual({ expectedVersion: 3, regenerate: true })
  })

  it.each([null, [], {}, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }, { expectedVersion: '3' }, { expectedVersion: 3, regenerate: null }, { expectedVersion: 3, regenerate: 'true' }, { expectedVersion: 3, mediaAssetId: 'injected' }])('rejects malformed or trusted server fields: %p', input => {
    expect(() => normalizePurchaseOrderImageDraftInput(input)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})
