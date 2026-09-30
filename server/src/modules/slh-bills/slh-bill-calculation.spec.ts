import {
  calculateSlhFreight,
  calculateSlhPayable,
  deriveSlhPricingBasis,
  recordSlhVolume,
  slhAmountsEqual,
  slhVolumeRatio,
  slhVolumesEqual,
  sourceDecimalPlaces,
  sumSlhAmounts,
} from './slh-bill-calculation'

// 用例数值全部取自两份真实对账单，并用账单自身的缓存公式结果核对过。
describe('slh bill calculation', () => {
  describe('volume ratio uses the bill divisor 28316 with package count', () => {
    it('matches a single-package row from the January bill', () => {
      const ratio = slhVolumeRatio({ lengthCm: '215', widthCm: '137', heightCm: '113', packageCount: 1 })!
      // 账单单元格值 117.545380703489
      expect(recordSlhVolume(ratio, 'WEIGHT')).toBe('117.55')
    })

    it('multiplies by package count, matching the ten-package row', () => {
      const ratio = slhVolumeRatio({ lengthCm: '128', widthCm: '19', heightCm: '15', packageCount: 10 })!
      // 账单单元格值 12.8831755897726，仅当除以 28316 并乘箱数才成立
      expect(recordSlhVolume(ratio, 'WEIGHT')).toBe('12.88')
    })

    it('matches a two-package row from the August bill', () => {
      const ratio = slhVolumeRatio({ lengthCm: '48', widthCm: '46', heightCm: '42', packageCount: 2 })!
      expect(recordSlhVolume(ratio, 'WEIGHT')).toBe('6.55')
    })

    it('returns null when any dimension is missing', () => {
      expect(slhVolumeRatio({ lengthCm: '215', widthCm: null, heightCm: '113', packageCount: 1 })).toBeNull()
    })
  })

  describe('pricing basis derives from the unit price threshold', () => {
    it.each([['4.5', 'WEIGHT'], ['4.7', 'WEIGHT'], ['5', 'WEIGHT'], ['10', 'WEIGHT'], ['30', 'VOLUME']] as const)('maps unit price %s to %s', (price, expected) => {
      expect(deriveSlhPricingBasis(price)).toBe(expected)
    })

    it('has no basis when the unit price is absent', () => {
      expect(deriveSlhPricingBasis(null)).toBeNull()
    })
  })

  describe('recorded volume depends on the pricing basis', () => {
    const ratio = slhVolumeRatio({ lengthCm: '190', widthCm: '92', heightCm: '63', packageCount: 1 })!

    it('rounds to two decimals when priced by weight', () => {
      expect(recordSlhVolume(ratio, 'WEIGHT')).toBe('38.89')
    })

    it('rounds up when priced by volume, matching the bill value 39', () => {
      expect(recordSlhVolume(ratio, 'VOLUME')).toBe('39.00')
    })
  })

  describe('freight recomputation', () => {
    it('multiplies unit price by weight when priced by weight', () => {
      expect(calculateSlhFreight({ unitPriceAmount: '5', pricingBasis: 'WEIGHT', grossWeightKg: '885', volumeCai: '117.55' })).toBe('4425.00')
    })

    it('multiplies unit price by the ceiling volume when priced by volume', () => {
      expect(calculateSlhFreight({ unitPriceAmount: '30', pricingBasis: 'VOLUME', grossWeightKg: '213', volumeCai: '39' })).toBe('1170.00')
    })

    it('rounds the product of price and fractional weight to two decimals', () => {
      expect(calculateSlhFreight({ unitPriceAmount: '4.7', pricingBasis: 'WEIGHT', grossWeightKg: '639', volumeCai: '55.3' })).toBe('3003.30')
    })

    it('records zero freight for a row without a unit price instead of failing', () => {
      expect(calculateSlhFreight({ unitPriceAmount: null, pricingBasis: null, grossWeightKg: null, volumeCai: null })).toBe('0.00')
    })
  })

  describe('payable and totals', () => {
    it('adds freight, cod handling and surcharge exactly', () => {
      expect(calculateSlhPayable('4425.00', '30', '100')).toBe('4555.00')
    })

    it('sums the January bill line amounts to its subtotal', () => {
      expect(sumSlhAmounts(['84072.50', '810.00', '2600.00'])).toBe('87482.50')
    })

    it('treats a missing amount as 本行不涉及 and keeps the total exact', () => {
      // 空列表示本行不涉及该项（与装柜明细同一口径），合计里按 0 参与。
      expect(sumSlhAmounts(['84072.50', null, '2600.00'])).toBe('86672.50')
      expect(sumSlhAmounts([null, null])).toBe('0.00')
      expect(calculateSlhPayable('500.00', null, null)).toBe('500.00')
      expect(calculateSlhPayable(null, null, null)).toBe('0.00')
    })
  })

  describe('comparison helpers', () => {
    it('treats trailing zeros as equal', () => {
      expect(slhAmountsEqual('87482.50', '87482.5')).toBe(true)
    })

    it('compares volumes at the recorded precision', () => {
      // 账单原值给到 12 位小数，归一后与本模块记录的 117.55 视为一致。
      expect(slhVolumesEqual('117.55', '117.545380703489')).toBe(true)
      expect(slhVolumesEqual('117.55', '117.54')).toBe(false)
      expect(slhVolumesEqual('38.89', '38.89')).toBe(true)
    })
  })

  describe('source precision guard', () => {
    it('counts decimals in the source cell text', () => {
      expect(sourceDecimalPlaces('150')).toBe(0)
      expect(sourceDecimalPlaces('12.5')).toBe(1)
      expect(sourceDecimalPlaces('12.345')).toBe(3)
      expect(sourceDecimalPlaces(null)).toBe(0)
    })
  })
})
