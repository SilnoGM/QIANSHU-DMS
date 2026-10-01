import { SLH_VOLUME_DIVISOR, SLH_VOLUME_SCALE } from '../slh-bills/slh-bill-calculation'
import {
  calculateOceanBill, calculateOceanCharge, calculateOceanLine,
  calculateOceanVolume, normalizeOceanDecimal, OceanCalculationError, resolveOceanCod,
  VOLUME_CAI_DIVISOR, VOLUME_CAI_SCALE,
} from './ocean-freight-calculation'

const cargo = { grossWeightKg: '180', chargeableVolumeCai: 13 }
const fixed = (amount: string, currencyCode: 'CNY' | 'TWD' = 'TWD', chargeNature: 'NORMAL' | 'SUPPLEMENT' | 'DEDUCTION' = 'NORMAL') =>
  calculateOceanCharge({ pricingBasis: 'FIXED', amount, currencyCode, chargeNature }, cargo)

describe('海运计算的精确值与缺值边界', () => {
  it('装柜明细与账单表共用同一材积分母和记录精度', () => {
    expect(VOLUME_CAI_DIVISOR).toBe(SLH_VOLUME_DIVISOR)
    expect(VOLUME_CAI_SCALE).toBe(SLH_VOLUME_SCALE)
  })

  it('单件材积先乘件数，记录值保留两位小数并给出与来源的差异', () => {
    expect(calculateOceanVolume({ lengthCm: '128', widthCm: '19', heightCm: '15', packageCount: 10, reportedVolumeCai: '12.88' }))
      .toEqual({ volumeCai: '12.88', chargeableVolumeCai: 13, volumeDifferenceCai: '0.00' })
    expect(calculateOceanVolume({ lengthCm: '128', widthCm: '19', heightCm: '15', packageCount: 10, reportedVolumeCai: '12.90' }).volumeDifferenceCai)
      .toBe('-0.02')
  })

  it('向上取整不受两位小数记录舍入和浮点精度影响', () => {
    expect(calculateOceanVolume({ lengthCm: '28316.01', widthCm: '0.01', heightCm: '0.01', packageCount: 10000, reportedVolumeCai: null }).chargeableVolumeCai).toBe(2)
    expect(calculateOceanVolume({ lengthCm: '28316000.01', widthCm: '0.01', heightCm: '0.01', packageCount: 10000, reportedVolumeCai: null }))
      .toEqual({ volumeCai: '1000.00', chargeableVolumeCai: 1001, volumeDifferenceCai: null })
    const input = { lengthCm: '0.01', widthCm: '0.01', heightCm: '0.01', packageCount: 1, reportedVolumeCai: null }
    // 库表要求材积为正；真实体积虽大于零，两位小数记录量化为零时必须提前明确拒绝。
    expect(() => calculateOceanVolume(input)).toThrow(OceanCalculationError)
    try { calculateOceanVolume(input) } catch (error) {
      expect(error).toMatchObject({ code: 'OCEAN_CALCULATION_INVALID' })
      expect((error as OceanCalculationError).getStatus()).toBe(422)
    }
  })

  it('未知尺寸返回null，零尺寸和超量程不能冒充有效材积', () => {
    expect(calculateOceanVolume({ lengthCm: null, widthCm: '1', heightCm: '1', packageCount: 1, reportedVolumeCai: null }).volumeCai).toBeNull()
    for (const lengthCm of ['0', '-1', '1.001', '1.0001', '1000000000000000', '1e3']) {
      expect(() => calculateOceanVolume({ lengthCm, widthCm: '1', heightCm: '1', packageCount: 1, reportedVolumeCai: null })).toThrow()
    }
    expect(() => calculateOceanVolume({ lengthCm: '999999999999999', widthCm: '999999999999999', heightCm: '999999999999999', packageCount: 1, reportedVolumeCai: null })).toThrow()
  })

  it('重量采用整行毛重，材积采用整数材数，不依据单价或货类猜测', () => {
    expect(calculateOceanCharge({ pricingBasis: 'WEIGHT', currencyCode: 'CNY', chargeNature: 'NORMAL', unitPriceAmount: '0.000028' }, cargo).amount).toBe('0.01')
    expect(calculateOceanCharge({ pricingBasis: 'VOLUME', currencyCode: 'CNY', chargeNature: 'NORMAL', unitPriceAmount: '20' }, cargo).amount).toBe('260.00')
    expect(() => calculateOceanCharge({ pricingBasis: 'WEIGHT', currencyCode: 'CNY', chargeNature: 'NORMAL', unitPriceAmount: '20' }, { ...cargo, grossWeightKg: null })).toThrow()
    expect(() => calculateOceanCharge({ pricingBasis: undefined as never, currencyCode: 'CNY', chargeNature: 'NORMAL', unitPriceAmount: '20' }, cargo)).toThrow()
  })

  it('减免方向仅由性质决定，保留来源金额和差异', () => {
    expect(fixed('500', 'TWD', 'DEDUCTION').effectiveAmount).toBe('-500.00')
    expect(() => fixed('-500', 'TWD', 'DEDUCTION')).toThrow()
    expect(calculateOceanCharge({ pricingBasis: 'FIXED', currencyCode: 'CNY', chargeNature: 'SUPPLEMENT', amount: '10', reportedAmount: '9' }, cargo).amountDifference).toBe('1.00')
    expect(calculateOceanCharge({ pricingBasis: 'FIXED', currencyCode: 'CNY', chargeNature: 'DEDUCTION', amount: '500', reportedAmount: '-500' }, cargo).amountDifference).toBe('0.00')
    expect(() => calculateOceanCharge({ pricingBasis: 'WEIGHT', currencyCode: 'CNY', chargeNature: 'NORMAL', unitPriceAmount: '0.0000001' }, cargo)).toThrow()
    expect(() => calculateOceanCharge({ pricingBasis: 'WEIGHT', currencyCode: 'CNY', chargeNature: 'NORMAL', unitPriceAmount: '999999999999999999999999.999999' }, { grossWeightKg: '999999999999999.999', chargeableVolumeCai: null })).toThrow()
  })

  it('补派送500TWD产生-104.17CNY，负数按HALF_UP舍入', () => {
    expect(calculateOceanLine({ codAmountTwd: '0', charges: [fixed('500')], twdPerCny: '4.8' }).netReturnAmountCny).toBe('-104.17')
    expect(calculateOceanLine({ codAmountTwd: '0', charges: [fixed('0.01')], twdPerCny: '2' }).returnAmountCny).toBe('-0.01')
  })

  it('明确无费用和未知费用区分，币种独立合计', () => {
    expect(calculateOceanLine({ codAmountTwd: null, charges: [], twdPerCny: '4.8' })).toMatchObject({ chargeTotalAmountTwd: '0.00', payableAmountCny: '0.00', returnAmountCny: null })
    expect(calculateOceanLine({ codAmountTwd: '100', charges: null, twdPerCny: '4.8' })).toMatchObject({ chargeTotalAmountTwd: null, payableAmountCny: null, returnAmountCny: null })
    expect(calculateOceanLine({ codAmountTwd: '480', charges: [fixed('48'), fixed('20', 'CNY')], twdPerCny: '4.8' }).netReturnAmountCny).toBe('70.00')
  })

  it('汇率必须正数且不超过12位；极小汇率溢出拒绝', () => {
    for (const twdPerCny of ['0', '-1', '0.0000000000001']) {
      expect(() => calculateOceanLine({ codAmountTwd: '1', charges: [], twdPerCny })).toThrow()
    }
    expect(() => calculateOceanLine({ codAmountTwd: '9999999999999999999999999999.99', charges: [], twdPerCny: '0.000000000001' })).toThrow()
  })

  it('账单合计逐条舍入，明确保存与整单换算差额', () => {
    const result = calculateOceanBill({ lines: Array.from({ length: 3 }, () => ({ codAmountTwd: '0.01', charges: [] })), twdPerCny: '2' })
    expect(result).toMatchObject({ returnAmountCny: '0.03', roundingDifferenceCny: '0.01' })
    expect(calculateOceanBill({ lines: [], twdPerCny: '4.8' }).netReturnAmountCny).toBeNull()
    expect(calculateOceanBill({ lines: [{ codAmountTwd: null, charges: [] }, { codAmountTwd: '10', charges: [] }], twdPerCny: '4.8' }).codTotalAmountTwd).toBeNull()
  })

  it('账单完整性逐项计算，单条未知费用不隐藏已知代收合计', () => {
    expect(calculateOceanBill({ lines: [{ codAmountTwd: '1', charges: null }, { codAmountTwd: '2', charges: [] }], twdPerCny: '4.8' }))
      .toEqual({ codTotalAmountTwd: '3.00', chargeTotalAmountTwd: null, payableAmountCny: null, returnAmountCny: null, netReturnAmountCny: null, roundingDifferenceCny: null })
  })

  it('金额超过JS安全整数仍精确保留分，减免可产生负应付', () => {
    expect(calculateOceanLine({ codAmountTwd: '9007199254740993.01', charges: [], twdPerCny: '1' }).netReturnAmountCny).toBe('9007199254740993.01')
    expect(calculateOceanLine({ codAmountTwd: '0', charges: [fixed('0.01', 'CNY', 'DEDUCTION')], twdPerCny: '1' }))
      .toMatchObject({ payableAmountCny: '-0.01', returnAmountCny: '0.00', netReturnAmountCny: '0.01' })
  })

  it('每行合法但整单合计溢出时拒绝，不截断或科学计数法回传', () => {
    expect(() => calculateOceanBill({ lines: [
      { codAmountTwd: '9999999999999999999999999999.99', charges: [] },
      { codAmountTwd: '0.01', charges: [] },
    ], twdPerCny: '1' })).toThrow(OceanCalculationError)
    expect(() => calculateOceanLine({ codAmountTwd: '0', charges: [fixed('9999999999999999999999999999.99', 'CNY'), fixed('0.01', 'CNY')], twdPerCny: '1' })).toThrow(OceanCalculationError)
  })

  it('计费依据缺失和金额双真相源均拒绝', () => {
    expect(() => calculateOceanCharge({ pricingBasis: 'VOLUME', currencyCode: 'CNY', chargeNature: 'NORMAL', unitPriceAmount: '1' }, { ...cargo, chargeableVolumeCai: null })).toThrow()
    expect(() => calculateOceanCharge({ pricingBasis: 'WEIGHT', currencyCode: 'CNY', chargeNature: 'NORMAL', amount: '99', unitPriceAmount: '1' }, cargo)).toThrow()
    expect(() => calculateOceanCharge({ pricingBasis: 'FIXED', currencyCode: 'CNY', chargeNature: 'NORMAL', amount: '99', unitPriceAmount: '1' }, cargo)).toThrow()
    expect(() => calculateOceanVolume({ lengthCm: '1', widthCm: '1', heightCm: '1', packageCount: 0, reportedVolumeCai: null })).toThrow()
  })

  it('十进制归一化明确区分null、0和非法类型，返回422领域错误', () => {
    expect(normalizeOceanDecimal(null, 30, 2, 'amount')).toBeNull()
    expect(normalizeOceanDecimal('0', 30, 2, 'amount')).toBe('0.00')
    for (const value of [0, undefined, '', 'NaN', 'Infinity', '1e2', '1,000', '1.001']) {
      try {
        normalizeOceanDecimal(value, 30, 2, 'amount')
        throw new Error('Expected invalid value to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(OceanCalculationError)
        expect((error as OceanCalculationError).getStatus()).toBe(422)
      }
    }
  })

  it('Decimal上下界包含最大合法值，正数计价可合法舍入为零', () => {
    expect(normalizeOceanDecimal('9999999999999999.99999999', 24, 8, 'volumeCai')).toBe('9999999999999999.99999999')
    expect(() => normalizeOceanDecimal('10000000000000000', 24, 8, 'volumeCai')).toThrow()
    expect(normalizeOceanDecimal('9999999999999999999999999999.99', 30, 2, 'amount')).toBe('9999999999999999999999999999.99')
    expect(() => normalizeOceanDecimal('10000000000000000000000000000', 30, 2, 'amount')).toThrow()
    expect(calculateOceanCharge({ pricingBasis: 'WEIGHT', currencyCode: 'CNY', chargeNature: 'NORMAL', unitPriceAmount: '0.000001' }, { grossWeightKg: '0.001', chargeableVolumeCai: null }).amount).toBe('0.00')
    const input = { lengthCm: '2147483647', widthCm: '28316', heightCm: '1', packageCount: 1, reportedVolumeCai: null }
    expect(calculateOceanVolume(input).chargeableVolumeCai).toBe(2147483647)
    expect(() => calculateOceanVolume({ ...input, lengthCm: '2147483647.01' })).toThrow()
  })

  it('补费来源代收必须明确当前、历史或未决；原始值保留', () => {
    expect(resolveOceanCod({ lineType: 'ADJUSTMENT', reportedCodAmountTwd: '100', meaning: 'HISTORICAL_REFERENCE' })).toEqual({ reportedCodAmountTwd: '100.00', codAmountTwd: '0.00' })
    expect(resolveOceanCod({ lineType: 'ADJUSTMENT', reportedCodAmountTwd: '100', meaning: 'UNRESOLVED' }).codAmountTwd).toBeNull()
    expect(resolveOceanCod({ lineType: 'ADJUSTMENT', reportedCodAmountTwd: '100', meaning: 'CURRENT' }).codAmountTwd).toBe('100.00')
    expect(resolveOceanCod({ lineType: 'ADJUSTMENT', reportedCodAmountTwd: null, meaning: 'HISTORICAL_REFERENCE' }).codAmountTwd).toBeNull()
    expect(() => resolveOceanCod({ lineType: 'NORMAL', reportedCodAmountTwd: '100', meaning: 'HISTORICAL_REFERENCE' })).toThrow()
  })
})
