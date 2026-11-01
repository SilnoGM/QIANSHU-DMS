import {
  buildSlhSettlementAllocation,
  canonicalAllocationJson,
  readAllocationSnapshot,
  SlhAllocationError,
  type SlhAllocationInput,
} from './slh-reconciliation-allocation.logic'

/**
 * 分摊口径：甲（原销售单）承担二派/转派/寄仓，乙（当前销售单）承担其余费用；
 * 金流费按乙的销售金额计算且独立成账，COD 恒归乙。
 */
describe('slh settlement allocation logic', () => {
  const origin = { id: 'origin', orderNo: 'SO-A', currencyCode: 'TWD', agreedTotalAmount: '1000.00' }
  const current = { id: 'current', orderNo: 'SO-B', currencyCode: 'TWD', agreedTotalAmount: '5000.00' }

  const input = (overrides: Partial<SlhAllocationInput> = {}): SlhAllocationInput => ({
    charges: [
      { id: 'charge-redelivery', chargeType: 'REDELIVERY', currencyCode: 'CNY', amount: '50.00' },
      { id: 'charge-storage', chargeType: 'STORAGE', currencyCode: 'TWD', amount: '100.00' },
      { id: 'charge-other', chargeType: 'OTHER', currencyCode: 'CNY', amount: '30.00' },
      { id: 'charge-port', chargeType: 'PORT_FEE', currencyCode: 'CNY', amount: '20.00' },
    ],
    freightAmountCny: '200.00',
    codHandlingAmountCny: '10.00',
    surchargeAmountCny: '100.00',
    codAmountTwd: '1000.00',
    ntdSurchargeAmountTwd: '100.00',
    payableAmountCny: '310.00',
    originSalesOrder: origin,
    currentSalesOrder: current,
    rate: '5.00',
    paymentFeeRate: '0.007',
    ...overrides,
  })

  it('按费用类型给出默认目标，并把可分摊的金额拆成逐项明细', () => {
    const result = buildSlhSettlementAllocation(input())
    const targets = Object.fromEntries(result.items.map(item => [item.key, item.target]))

    expect(targets).toEqual({
      'CHARGE:charge-redelivery': 'ORIGIN_ORDER',
      'CHARGE:charge-storage': 'ORIGIN_ORDER',
      'CHARGE:charge-other': 'CURRENT_ORDER',
      'CHARGE:charge-port': 'CURRENT_ORDER',
      FREIGHT: 'CURRENT_ORDER',
      COD_HANDLING: 'CURRENT_ORDER',
      COD: 'CURRENT_ORDER',
      PAYMENT_FEE: 'CURRENT_ORDER',
    })
    // 结算尾差（分摊到目标后取整）必须回到当前销售单，父级金额不变。
    expect(result.parent).toEqual({
      codAmountTwd: '1000.00',
      ntdSurchargeAmountTwd: '100.00',
      payableAmountCny: '310.00',
      settlementAmountCny: '-130.00',
      salesAmount: '5000.00',
      paymentFeeAmountCny: '7.00',
    })
    expect(result.parties).toEqual([
      expect.objectContaining({
        target: 'ORIGIN_ORDER', salesOrderId: 'origin', salesOrderNo: 'SO-A',
        settlementAmountCny: '-70.00',
        paymentFeeAmountCny: null,
      }),
      expect.objectContaining({
        target: 'CURRENT_ORDER', salesOrderId: 'current', salesOrderNo: 'SO-B',
        settlementAmountCny: '-60.00',
        paymentFeeAmountCny: '7.00',
        salesAmount: '5000.00',
      }),
    ])
  })

  it('金流费单列，不进入结算金额（避免完成批次时重复入账）', () => {
    const result = buildSlhSettlementAllocation(input({ codAmountTwd: null, payableAmountCny: null, ntdSurchargeAmountTwd: null, charges: [], surchargeAmountCny: null, freightAmountCny: null, codHandlingAmountCny: null }))
    expect(result.parent.settlementAmountCny).toBeNull()
    expect(result.items.map(item => item.sourceType)).toEqual(['PAYMENT_FEE'])
    expect(result.parties).toEqual([
      expect.objectContaining({ target: 'CURRENT_ORDER', settlementAmountCny: '0.00', paymentFeeAmountCny: '7.00' }),
    ])
  })

  it('手动改目标必须提供原因，且 COD 不允许改到甲或公司', () => {
    const overridden = buildSlhSettlementAllocation(input({
      overrides: [{ key: 'FREIGHT', target: 'COMPANY', reason: '客户投诉，公司承担运费' }],
    }))
    expect(overridden.items.find(item => item.key === 'FREIGHT')).toMatchObject({
      target: 'COMPANY', overridden: true, reason: '客户投诉，公司承担运费',
    })
    // 公司目标没有销售订单，尾差仍归当前销售单。
    expect(overridden.parties.map(party => party.target)).toEqual(['ORIGIN_ORDER', 'CURRENT_ORDER', 'COMPANY'])

    const expectCode = (value: SlhAllocationInput, code: string) => {
      try {
        buildSlhSettlementAllocation(value)
      }
      catch (error) {
        expect(error).toBeInstanceOf(SlhAllocationError)
        expect((error as SlhAllocationError).code).toBe(code)
        return
      }
      throw new Error('expected allocation failure')
    }
    expectCode(input({ overrides: [{ key: 'FREIGHT', target: 'COMPANY' }] }), 'SLH_RECON_ALLOCATION_REASON_REQUIRED')
    expectCode(input({ overrides: [{ key: 'COD', target: 'ORIGIN_ORDER', reason: '转嫁给甲' }] }), 'SLH_RECON_ALLOCATION_COD_TARGET_INVALID')
    expectCode(input({ overrides: [{ key: 'UNKNOWN', target: 'COMPANY', reason: '不存在的费用' }] }), 'SLH_RECON_ALLOCATION_OVERRIDE_INVALID')
    expectCode(input({
      overrides: [
        { key: 'FREIGHT', target: 'COMPANY', reason: '重复' },
        { key: 'FREIGHT', target: 'ORIGIN_ORDER', reason: '重复' },
      ],
    }), 'SLH_RECON_ALLOCATION_OVERRIDE_INVALID')
  })

  it('费用明细与账单两个杂费列不一致时阻断，不猜分摊', () => {
    const expectCode = (value: SlhAllocationInput) => {
      try {
        buildSlhSettlementAllocation(value)
      }
      catch (error) {
        expect(error).toBeInstanceOf(SlhAllocationError)
        expect((error as SlhAllocationError).code).toBe('SLH_RECON_ALLOCATION_BREAKDOWN_MISMATCH')
        return
      }
      throw new Error('expected allocation failure')
    }
    expectCode(input({ surchargeAmountCny: '90.00' }))
    expectCode(input({ ntdSurchargeAmountTwd: '0.00' }))
    expectCode(input({ surchargeAmountCny: null }))
    expectCode(input({ charges: [] }))
  })

  it('甲就是当前销售单时，甲的费用并入当前销售单，不重复入账', () => {
    const result = buildSlhSettlementAllocation(input({ originSalesOrder: current }))
    expect(result.parties.map(party => party.target)).toEqual(['CURRENT_ORDER'])
    expect(result.parties[0]?.settlementAmountCny).toBe('-130.00')
    expect(result.items.every(item => item.target === 'CURRENT_ORDER')).toBe(true)
  })

  it('快照比较忽略 JSONB 的键顺序，历史空快照读回 null', () => {
    const left = { b: 1, a: [{ d: 2, c: 3 }] }
    const right = { a: [{ c: 3, d: 2 }], b: 1 }
    expect(canonicalAllocationJson(left)).toBe(canonicalAllocationJson(right))
    expect(readAllocationSnapshot(null)).toBeNull()
    expect(readAllocationSnapshot({ items: [], parties: [] })).toEqual({ items: [], parties: [] })
  })
})
