import { resolveSettlementAmounts, compareSettlementAmounts, isSameAmount, isSameSettlement, PAYMENT_FEE_RATE } from './slh-reconciliation-settlement.logic'

/**
 * 结算金额口径的服务端副本：与前端 `settle-modal.logic.ts` 同一公式，
 * 这里锁住「空值按 0 代入、三列全空不计算、两位小数 HALF_UP」与比对语义。
 */
describe('slh reconciliation settlement logic', () => {
  const source = (overrides: Partial<Parameters<typeof resolveSettlementAmounts>[0]> = {}) => ({
    codAmountTwd: '129000.00',
    ntdSurchargeAmountTwd: '6000.00',
    payableAmountCny: '4555.00',
    salesAmount: '500.0000',
    rate: '5.2',
    paymentFeeRate: PAYMENT_FEE_RATE,
    ...overrides,
  })

  it('按汇率重算两个派生金额，销售金额保持订单币种精度', () => {
    const resolved = resolveSettlementAmounts(source())
    expect(resolved.settlementAmountCny).toBe('19098.85')
    expect(resolved.paymentFeeAmountCny).toBe('0.67')
    expect(resolved.salesAmount).toBe('500.0000')
  })

  it('本行不涉及的金额按 0 代入，整行三个金额都不涉及时不计算', () => {
    // （0 − 6000）÷ 5.2 − 4555 = −5708.85；缺杂费时 129000 ÷ 5.2 − 4555 = 20252.69。
    expect(resolveSettlementAmounts(source({ codAmountTwd: null })).settlementAmountCny).toBe('-5708.85')
    expect(resolveSettlementAmounts(source({ ntdSurchargeAmountTwd: null })).settlementAmountCny).toBe('20252.69')
    expect(resolveSettlementAmounts(source({
      codAmountTwd: null, ntdSurchargeAmountTwd: null, payableAmountCny: null,
    })).settlementAmountCny).toBeNull()
  })

  it('汇率不可用或销售额缺失时对应金额留空，不造伪 0', () => {
    const zeroRate = resolveSettlementAmounts(source({ rate: '0' }))
    expect(zeroRate.settlementAmountCny).toBeNull()
    expect(zeroRate.paymentFeeAmountCny).toBeNull()
    expect(resolveSettlementAmounts(source({ salesAmount: null })).paymentFeeAmountCny).toBeNull()
  })

  it('比对按数值语义：格式差异不算不一致，真实差异要按字段报出来', () => {
    const resolved = resolveSettlementAmounts(source())
    const claimed = {
      codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.000', payableAmountCny: '4555.00',
      settlementAmountCny: '19098.8500', salesAmount: '500.0000', paymentFeeAmountCny: '0.67',
    }
    expect(compareSettlementAmounts(resolved, claimed)).toEqual([])

    expect(compareSettlementAmounts(resolved, { ...claimed, settlementAmountCny: '19098.86' })).toEqual(['结算金额'])
    expect(compareSettlementAmounts(resolved, { ...claimed, codAmountTwd: null })).toEqual(['代收货款'])
    expect(compareSettlementAmounts(resolved, { ...claimed, salesAmount: null })).toEqual(['销售金额'])
  })

  it('null 只与 null 相等，数值相等才视为同一结算口径', () => {
    expect(isSameAmount(null, null)).toBe(true)
    expect(isSameAmount('', null)).toBe(true)
    expect(isSameAmount('0', null)).toBe(false)
    expect(isSameAmount('5.20', '5.2')).toBe(true)

    const resolved = resolveSettlementAmounts(source())
    const active = {
      rateSource: 'SYSTEM', foreignUnitsPerCny: '5.200000000000', paymentFeeRate: '0.007000000000',
      codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      settlementAmountCny: '19098.85', salesAmount: '500.0000', paymentFeeAmountCny: '0.67',
    }
    expect(isSameSettlement(active, 'SYSTEM', '5.2', resolved)).toBe(true)
    expect(isSameSettlement(active, 'EMBEDDED', '5.2', resolved)).toBe(false)
    expect(isSameSettlement({ ...active, settlementAmountCny: '19098.86' }, 'SYSTEM', '5.2', resolved)).toBe(false)
    expect(isSameSettlement({ ...active, paymentFeeRate: '0.008000000000' }, 'SYSTEM', '5.2', resolved)).toBe(false)
  })
})
