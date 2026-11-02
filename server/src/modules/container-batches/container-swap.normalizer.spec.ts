import { randomUUID } from 'node:crypto'

import {
  deriveSwapUuid,
  mergeSwapText,
  normalizeContainerSwapRequest,
  normalizeSwapCod,
} from './container-swap.normalizer'

describe('container swap normalizer', () => {
  it('merges distinct non-empty text values in line order and copies single values', () => {
    expect(mergeSwapText([' 张三 ', '李四', '张三', null, ''], 128, '、')).toBe('张三、李四')
    expect(mergeSwapText([null, '', undefined], 128, '、')).toBeNull()
    expect(mergeSwapText(['A'], 128, '、')).toBe('A')
  })

  it('rejects merged text and single values over the field limit', () => {
    expect(() => mergeSwapText(['x'.repeat(129)], 128, '、')).toThrow(expect.objectContaining({ code: 'CONTAINER_SWAP_RECIPIENT_INVALID' }))
    expect(() => mergeSwapText(['x'.repeat(100), 'y'.repeat(100)], 128, '、')).toThrow(expect.objectContaining({ code: 'CONTAINER_SWAP_RECIPIENT_INVALID' }))
  })

  it('normalizes nullable COD and rejects negative or over-precise amounts', () => {
    expect(normalizeSwapCod(null)).toBeNull()
    expect(normalizeSwapCod('1')).toBe('1.00')
    for (const value of ['-1', '1.001', 'abc']) {
      expect(() => normalizeSwapCod(value)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    }
  })

  it('normalizes a full request and rejects duplicate line ids across sides', () => {
    const leftShipmentId = randomUUID()
    const rightShipmentId = randomUUID()
    const leftLineId = randomUUID()
    const rightLineId = randomUUID()
    const result = normalizeContainerSwapRequest({
      leftShipmentId,
      rightShipmentId,
      leftLines: [{ loadingItemId: leftLineId, expectedVersion: 1, codAmountTwd: '100' }],
      rightLines: [{ loadingItemId: rightLineId, expectedVersion: 2, codAmountTwd: null }],
      note: ' 客户要求 ',
    })
    expect(result).toMatchObject({
      leftShipmentId,
      rightShipmentId,
      leftLines: [{ loadingItemId: leftLineId, expectedVersion: 1, codAmountTwd: '100.00' }],
      rightLines: [{ loadingItemId: rightLineId, expectedVersion: 2, codAmountTwd: null }],
      note: '客户要求',
    })
    expect(() => normalizeContainerSwapRequest({
      leftShipmentId,
      rightShipmentId,
      leftLines: [{ loadingItemId: leftLineId, expectedVersion: 1 }],
      rightLines: [{ loadingItemId: leftLineId, expectedVersion: 1 }],
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })

  it('derives stable v4 UUID request keys from the swap key', () => {
    const swapKey = randomUUID()
    const first = deriveSwapUuid(swapKey, 'ownership:left')
    expect(first).toBe(deriveSwapUuid(swapKey, 'ownership:left'))
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    expect(deriveSwapUuid(swapKey, 'ownership:right')).not.toBe(first)
  })
})
