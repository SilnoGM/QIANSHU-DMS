import { randomUUID } from 'node:crypto'
import { ApiException } from '../../infrastructure/http/api.exception'
import { deriveContainerDate, normalizeContainerCreate, normalizeLoadingItemCreate } from './container-batch.normalizer'

describe('container foundation input', () => {
  it('rejects control characters before writing PostgreSQL text', () => {
    for (const value of ['invalid\u0000text', 'invalid\u0007text']) {
      expect(() => normalizeContainerCreate({ containerBatchName: '0917柜', warehouseValue: 'B5', remark: value })).toThrow(ApiException)
      expect(() => normalizeLoadingItemCreate({ goodsName: value, packageCount: 1 })).toThrow(ApiException)
    }
  })
  it('derives the Shanghai creation year and validates the calendar date', () => {
    expect(deriveContainerDate('0101柜', new Date('2026-12-31T16:00:00Z'))).toEqual({ loadingDate: new Date('2027-01-01T00:00:00Z'), sequenceInDay: 1 })
    expect(deriveContainerDate('0918-02柜', new Date('2026-09-19T00:00:00Z'))).toEqual({ loadingDate: new Date('2026-09-18T00:00:00Z'), sequenceInDay: 2 })
    expect(deriveContainerDate('0918-01柜', new Date('2026-09-19T00:00:00Z')).sequenceInDay).toBe(1)
    for (const name of ['0230柜', '0229柜', '1301柜', '0918-00柜', 'invalid']) {
      expect(() => deriveContainerDate(name, new Date('2026-09-19T00:00:00Z'))).toThrow(ApiException)
    }
  })

  it('normalizes optional fields and rejects caller-owned calculated and identity fields', () => {
    expect(normalizeContainerCreate({ containerBatchName: ' 0917柜 ', warehouseValue: 'B5', remark: '  ' })).toEqual({ containerBatchName: '0917柜', warehouseValue: 'B5', sourceFileId: null, remark: null })
    for (const extra of [{ containerBatchNo: 'fake' }, { loadingDate: '2026-01-01' }, { version: 1 }]) {
      expect(() => normalizeContainerCreate({ containerBatchName: '0917柜', warehouseValue: 'B5', ...extra })).toThrow(ApiException)
    }
  })

  it('keeps a grouped mark as one item and does not accept client-calculated volume', () => {
    const shipmentId = randomUUID()
    expect(normalizeLoadingItemCreate({ goodsName: '履带', oceanShippingMarkText: 'L-010831-01~10', packageCount: 10, shipmentId })).toMatchObject({ goodsName: '履带', oceanShippingMarkText: 'L-010831-01~10', packageCount: 10, shipmentId })
    expect(() => normalizeLoadingItemCreate({ goodsName: '履带', packageCount: 0 })).toThrow(ApiException)
    expect(() => normalizeLoadingItemCreate({ goodsName: '履带', packageCount: 1, volumeCai: '10' })).toThrow(ApiException)
  })
})
