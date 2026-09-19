import { randomUUID } from 'node:crypto'
import type { ContainerBatch } from '../../generated/prisma/client'
import type { ParsedContainerRow } from './import-parser'
import { importRowIdentity, normalizeContainerImport, validateParsedRows } from './container-import.normalizer'

const row = { rowKey: '1:5', sourceSheetName: '装柜', sourceRowNumber: 5, containerBatchName: '0917柜', warehouseReceiptReference: 'REFERENCE', oceanShippingMarkText: 'L-01', goodsName: '履带', packageCount: 10, packageUnit: 'CTN', grossWeightKg: '180', lengthCm: '128', widthCm: '19', heightCm: '15', reportedVolumeCai: '12.88', recipientName: null, recipientPhone: null, recipientAddress: null, codAmountTwd: null, remark: null, errors: [], warnings: [], sourceData: { cells: {} } } as ParsedContainerRow
const batch = { createdAt: new Date('2026-09-19'), loadingDate: new Date('2026-09-17'), sequenceInDay: 1 } as ContainerBatch
const body = () => ({ expectedVersion: 1, sourceFileId: randomUUID(), sourceHash: 'a'.repeat(64), allowUnmatched: false, rows: [{ rowKey: '1:5', shipmentId: randomUUID() }] })
describe('container import normalization', () => {
  it('allows an explicit null selection but rejects missing IDs, duplicate rows and forged fields', () => {
    const input = body()
    expect(normalizeContainerImport({ ...input, rows: [{ rowKey: '1:5', shipmentId: null }] }).rows).toEqual([{ rowKey: '1:5', shipmentId: null }])
    for (const invalid of [{ ...input, rows: [input.rows[0], input.rows[0]] }, { ...input, rows: [{ rowKey: '1:5' }] }, { ...input, rows: [{ ...input.rows[0], goodsName: 'forged' }] }, { ...input, allowUnmatched: undefined }]) expect(() => normalizeContainerImport(invalid)).toThrow()
  })
  it('builds deterministic identities independent of payload order or retry key', () => {
    const first = importRowIdentity('hash', row)
    expect(first).toBe(importRowIdentity('hash', { ...row, rowKey: 'changed' }))
    expect(first).not.toBe(importRowIdentity('hash', { ...row, sourceRowNumber: 6 }))
    expect(first).not.toBe(importRowIdentity('other', row))
  })
  it('computes full row volume, flags container conflicts and duplicate ocean marks', () => {
    expect(validateParsedRows([row], batch)[0]).toMatchObject({ errors: [], volumeCai: '12.88272063', chargeableVolumeCai: 13 })
    expect(validateParsedRows([{ ...row, containerBatchName: '0918柜' }], batch)[0].errors).toHaveLength(1)
    expect(validateParsedRows([row, { ...row, rowKey: '1:6', sourceRowNumber: 6 }], batch).every(value => value.errors.length === 1)).toBe(true)
  })
  it('reports decimal overflow and invalid parsed fields as row errors, without dropping source values', () => {
    const invalid = { ...row, lengthCm: '100000000000000', widthCm: '100000000000000', heightCm: '100000000000000' }
    expect(validateParsedRows([invalid], batch)[0]).toMatchObject({ lengthCm: invalid.lengthCm, volumeCai: null })
    expect(validateParsedRows([invalid], batch)[0].errors.length).toBeGreaterThan(0)
  })
})
