import {
  claimProductAliases,
  claimProductMatches,
  normalizeClaimProductName,
} from './product-match'

describe('claim product matching', () => {
  it('normalizes width, whitespace and latin case for custom product names', () => {
    expect(normalizeClaimProductName('  Ｃｕｓｔｏｍ   Item  ')).toBe('custom item')
    expect(claimProductAliases(['挖掘機', 'custom item', null, '  '])).toEqual([
      '挖掘機',
      'custom item',
    ])
  })

  it('matches catalog products only by product id', () => {
    const base = {
      sourceLineType: 'CATALOG' as const,
      sourceProductId: 'product-1',
      sourceAliases: [],
      targetLineType: 'CATALOG' as const,
      targetProductId: 'product-1',
      targetProductName: '产品甲',
    }
    expect(claimProductMatches(base)).toBe(true)
    expect(claimProductMatches({ ...base, targetProductId: 'product-2' })).toBe(false)
    expect(claimProductMatches({
      ...base,
      targetLineType: 'CUSTOM',
      targetProductId: null,
      targetProductName: '产品甲',
    })).toBe(false)
  })

  it('matches custom products by normalized aliases and rejects unrelated names', () => {
    const base = {
      sourceLineType: 'CUSTOM' as const,
      sourceProductId: null,
      sourceAliases: claimProductAliases(['挖掘機']),
      targetLineType: 'CUSTOM' as const,
      targetProductId: null,
      targetProductName: ' 挖掘機 ',
    }
    expect(claimProductMatches(base)).toBe(true)
    expect(claimProductMatches({ ...base, targetProductName: '爬梯' })).toBe(false)
    expect(claimProductMatches({
      ...base,
      targetLineType: 'CATALOG',
      targetProductId: 'product-1',
    })).toBe(false)
  })
})
