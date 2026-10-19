import { randomUUID } from 'node:crypto'
import { ApiException } from '../../infrastructure/http/api.exception'
import { deriveContainerDate, normalizeContainerCreate, normalizeContainerUpdate, normalizeLoadingItemCreate } from './container-batch.normalizer'

describe('container foundation input', () => {
  it('rejects control characters before writing PostgreSQL text', () => {
    for (const value of ['invalid\u0000text', 'invalid\u0007text']) {
      expect(() => normalizeContainerCreate({ containerBatchName: '0917柜', warehouseValue: 'B5', sourceFileId: randomUUID(), remark: value })).toThrow(ApiException)
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

  it('handles the Shanghai year boundary, leap years and the last sequence without date rollover', () => {
    expect(deriveContainerDate('1231-99柜子', new Date('2026-12-31T15:59:59.999Z'))).toEqual({ loadingDate: new Date('2026-12-31T00:00:00Z'), sequenceInDay: 99 })
    expect(deriveContainerDate('0229柜', new Date('2028-01-01T00:00:00Z')).loadingDate).toEqual(new Date('2028-02-29T00:00:00Z'))
    for (const name of ['0001柜', '0100柜', '0431柜', '0918-100柜']) expect(() => deriveContainerDate(name, new Date('2028-01-01T00:00:00Z'))).toThrow(ApiException)
    expect(() => deriveContainerDate('0229柜', new Date('2100-01-01T00:00:00Z'))).toThrow(ApiException)
    expect(() => deriveContainerDate('0101柜', new Date('invalid'))).toThrow(ApiException)
  })

  it('normalizes source measurements without replacing missing measurements with zero', () => {
    expect(normalizeLoadingItemCreate({ goodsName: '履带', packageCount: 10, grossWeightKg: '180', lengthCm: '128', widthCm: '19.0', heightCm: '15', reportedVolumeCai: '12.88' })).toMatchObject({ grossWeightKg: '180', lengthCm: '128', widthCm: '19', heightCm: '15', reportedVolumeCai: '12.88' })
    expect(normalizeLoadingItemCreate({ goodsName: '履带', packageCount: 1, lengthCm: null, reportedVolumeCai: '0' })).toMatchObject({ grossWeightKg: null, lengthCm: null, widthCm: null, heightCm: null, reportedVolumeCai: '0.00' })
    // 整数厘米后整数位上限为 18 位，超出 (18,0) 量程的值必须被拒绝。
    for (const value of [0, '0', '-1', '1e2', 'NaN', '1000000000000000000', '']) expect(() => normalizeLoadingItemCreate({ goodsName: '履带', packageCount: 1, lengthCm: value })).toThrow()
    for (const field of ['volumeCai', 'chargeableVolumeCai', 'volumeDifferenceCai']) expect(() => normalizeLoadingItemCreate({ goodsName: '履带', packageCount: 1, [field]: '1' })).toThrow(ApiException)
  })

  it('normalizes optional fields and rejects caller-owned calculated and identity fields', () => {
    const sourceFileId = randomUUID()
    expect(normalizeContainerCreate({ containerBatchName: ' 0917柜 ', warehouseValue: 'B5', sourceFileId, remark: '  ' })).toEqual({ containerBatchName: '0917柜', warehouseValue: 'B5', sourceFileId, remark: null })
    for (const extra of [{ containerBatchNo: 'fake' }, { loadingDate: '2026-01-01' }, { version: 1 }]) {
      expect(() => normalizeContainerCreate({ containerBatchName: '0917柜', warehouseValue: 'B5', sourceFileId, ...extra })).toThrow(ApiException)
    }
  })

  it('requires an uploaded source for creation while preserving historical source-free updates', () => {
    const fields = { containerBatchName: '0917柜', warehouseValue: 'B5' }
    for (const sourceFileId of [undefined, null, '']) {
      expect(() => normalizeContainerCreate({ ...fields, sourceFileId })).toThrow(ApiException)
    }
    expect(normalizeContainerUpdate({ ...fields, expectedVersion: 1 })).toMatchObject({ sourceFileId: null, expectedVersion: 1 })
    expect(normalizeContainerUpdate({ ...fields, sourceFileId: null, expectedVersion: 1 })).toMatchObject({ sourceFileId: null })
  })

  it('keeps a grouped mark as one item and does not accept client-calculated volume', () => {
    const shipmentId = randomUUID()
    expect(normalizeLoadingItemCreate({ goodsName: '履带', oceanShippingMarkText: 'L-010831-01~10', packageCount: 10, shipmentId })).toMatchObject({ goodsName: '履带', oceanShippingMarkText: 'L-010831-01~10', packageCount: 10, shipmentId })
    expect(() => normalizeLoadingItemCreate({ goodsName: '履带', packageCount: 0 })).toThrow(ApiException)
    expect(() => normalizeLoadingItemCreate({ goodsName: '履带', packageCount: 1, volumeCai: '10' })).toThrow(ApiException)
  })
})
