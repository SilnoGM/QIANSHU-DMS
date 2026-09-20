import { randomUUID } from 'node:crypto'
import { plainToInstance } from 'class-transformer'
import { OperationsOceanContainerChangeDto } from './operations-ocean-change.dto'
import { normalizeOceanChange, normalizeOceanUndoChange } from './operations-ocean-change.normalizer'

const base = () => ({ requestKey: randomUUID(), expectedVersion: 1, notificationConfirmed: true })
describe('ocean line change normalization', () => {
  it('normalizes recipient changes and retains meaningful multiline remarks', () => {
    expect(normalizeOceanChange({ ...base(), kind: 'RECIPIENT', recipientName: ' 客户 ', recipientPhone: '', recipientAddress: ' 地址 ', remark: '提前联系\n自备叉车' }).changes)
      .toEqual({ recipientName: '客户', recipientPhone: null, recipientAddress: '地址', remark: '提前联系\n自备叉车' })
  })
  it('preserves null and zero, normalizes COD to two decimals without floating point loss', () => {
    for (const [input, expected] of [[null, null], ['0', '0.00'], ['12345678901234567890.1', '12345678901234567890.10']] as const) {
      expect(normalizeOceanChange({ ...base(), kind: 'COD', codAmountTwd: input }).changes).toEqual({ codAmountTwd: expected })
    }
  })
  it('handles transformed DTO optional properties while rejecting explicit cross-kind nulls', () => {
    expect(normalizeOceanChange(plainToInstance(OperationsOceanContainerChangeDto, { ...base(), kind: 'COD', codAmountTwd: '1' })).changes).toEqual({ codAmountTwd: '1.00' })
    expect(() => normalizeOceanChange(plainToInstance(OperationsOceanContainerChangeDto, { ...base(), kind: 'COD', codAmountTwd: '1', recipientName: null }))).toThrow()
  })
  it.each([-1, '-1', '1.001', '', 'NaN', '1e2', undefined])('rejects invalid COD %s', value => {
    expect(() => normalizeOceanChange({ ...base(), kind: 'COD', codAmountTwd: value })).toThrow()
  })
  it('requires explicit confirmation and rejects hidden cross-kind fields', () => {
    for (const notificationConfirmed of [undefined, false, 'true', 1]) expect(() => normalizeOceanChange({ ...base(), notificationConfirmed, kind: 'COD', codAmountTwd: '2' })).toThrow()
    expect(() => normalizeOceanChange({ ...base(), kind: 'COD', codAmountTwd: '2', recipientName: 'Injected' })).toThrow()
    expect(() => normalizeOceanChange({ ...base(), kind: 'RECIPIENT', codAmountTwd: '2' })).toThrow()
    expect(() => normalizeOceanChange({ ...base(), kind: 'COD', expectedVersion: 0, codAmountTwd: '2' })).toThrow()
  })
  it('accepts only request key and expected current version for undo', () => {
    const input = { requestKey: randomUUID(), expectedVersion: 2 }
    expect(normalizeOceanUndoChange(input)).toEqual(input)
    expect(() => normalizeOceanUndoChange({ ...input, expectedVersion: 0 })).toThrow()
    expect(() => normalizeOceanUndoChange({ ...input, recipientName: 'injected' })).toThrow()
  })
})
