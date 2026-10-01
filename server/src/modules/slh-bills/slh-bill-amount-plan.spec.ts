import {
  normalizeSlhBillAmount, planSlhBillAmountBackfill, SLH_BILL_AMOUNT_COLUMNS,
  type SlhBillAmountParsedLine, type SlhBillAmountStoredLine, type SlhBillAmountValues,
} from './slh-bill-amount-plan'

function values(overrides: Partial<SlhBillAmountValues> = {}): SlhBillAmountValues {
  return {
    codAmountTwd: '0.00', codHandlingAmountCny: '0.00', freightAmountCny: '0.00',
    ntdSurchargeAmountTwd: '0.00', payableAmountCny: '0.00', surchargeAmountCny: '0.00',
    ...overrides,
  }
}

function stored(lines: readonly Partial<SlhBillAmountValues>[]): SlhBillAmountStoredLine[] {
  return lines.map((overrides, index) => ({
    id: `line-${index + 1}`, lineNumber: index + 1, sourceRowNumber: index + 12, values: values(overrides),
  }))
}

function parsed(lines: readonly Partial<SlhBillAmountValues>[]): SlhBillAmountParsedLine[] {
  return lines.map((overrides, index) => ({ lineNumber: index + 1, sourceRowNumber: index + 12, values: values(overrides) }))
}

describe('normalizeSlhBillAmount', () => {
  it.each([
    [null, null], ['', null], ['   ', null], ['0', '0.00'], ['0.00', '0.00'],
    ['12.5', '12.50'], ['12.50', '12.50'], ['340', '340.00'],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizeSlhBillAmount(raw)).toEqual({ ok: true, value: expected })
  })

  it.each([['12.345'], ['0.005'], ['abc'], ['-1.00']])('rejects %s instead of rounding it', (raw) => {
    expect(normalizeSlhBillAmount(raw)).toEqual({ ok: false })
  })
})

describe('planSlhBillAmountBackfill', () => {
  it('turns stored 0.00 into null only where the source cell is blank', () => {
    const plan = planSlhBillAmountBackfill({
      parsed: parsed([{ codAmountTwd: null, payableAmountCny: '0.00' }]),
      stored: stored([{ codAmountTwd: '0.00', payableAmountCny: '0.00' }]),
    })
    expect(plan.skip).toBeNull()
    expect(plan.blankToNull).toBe(1)
    // 其余五列两侧都是 0.00：来源写明的零，不能跟着一起改 NULL。
    expect(plan.explicitZeroKept).toBe(SLH_BILL_AMOUNT_COLUMNS.length - 1)
    expect(plan.updates).toEqual([{
      columns: ['codAmountTwd'], lineId: 'line-1', lineNumber: 1,
      previous: values({ codAmountTwd: '0.00' }),
    }])
  })

  it('covers all six columns and counts unchanged values separately', () => {
    const plan = planSlhBillAmountBackfill({
      parsed: parsed([{ codHandlingAmountCny: null, freightAmountCny: '120.00', ntdSurchargeAmountTwd: null, surchargeAmountCny: null }]),
      stored: stored([{ codHandlingAmountCny: '0.00', freightAmountCny: '120.00', ntdSurchargeAmountTwd: '0.00', surchargeAmountCny: '0.00' }]),
    })
    expect([...plan.updates[0].columns].sort()).toEqual(['codHandlingAmountCny', 'ntdSurchargeAmountTwd', 'surchargeAmountCny'].sort())
    expect(plan.blankToNull).toBe(3)
    expect(plan.unchanged).toBe(1)
    expect(plan.explicitZeroKept).toBe(2)
    expect(plan.updates[0].previous.freightAmountCny).toBe('120.00')
  })

  it('keeps rows it cannot change out of the update list', () => {
    const plan = planSlhBillAmountBackfill({ parsed: parsed([{}]), stored: stored([{}]) })
    expect(plan.updates).toEqual([])
    expect(plan.explicitZeroKept).toBe(SLH_BILL_AMOUNT_COLUMNS.length)
  })

  it.each([
    ['LINE_COUNT_MISMATCH', { parsed: parsed([{}, {}]), stored: stored([{}]) }],
    ['LINE_IDENTITY_MISMATCH', {
      parsed: [{ lineNumber: 1, sourceRowNumber: 99, values: values() }],
      stored: stored([{}]),
    }],
    ['VALUE_MISMATCH', { parsed: parsed([{ freightAmountCny: '15.00' }]), stored: stored([{ freightAmountCny: '12.00' }]) }],
    ['VALUE_MISMATCH', { parsed: parsed([{ freightAmountCny: null }]), stored: stored([{ freightAmountCny: '12.00' }]) }],
    ['STORED_NULL_WITH_PARSED_VALUE', { parsed: parsed([{ codAmountTwd: '340.00' }]), stored: stored([{ codAmountTwd: null }]) }],
    ['STORED_VALUE_INVALID', { parsed: parsed([{ codAmountTwd: null }]), stored: stored([{ codAmountTwd: '12.345' }]) }],
    ['PARSED_VALUE_INVALID', { parsed: parsed([{ codAmountTwd: '12.345' }]), stored: stored([{ codAmountTwd: '12.35' }]) }],
  ])('skips the whole bill on %s', (reason, input) => {
    const plan = planSlhBillAmountBackfill(input)
    expect(plan.skip).toBe(reason)
    expect(plan.updates).toEqual([])
    expect(plan.blankToNull).toBe(0)
  })

  it('treats an already backfilled bill as a no-op', () => {
    const plan = planSlhBillAmountBackfill({ parsed: parsed([{ codAmountTwd: null }]), stored: stored([{ codAmountTwd: null }]) })
    expect(plan.skip).toBeNull()
    expect(plan.updates).toEqual([])
    expect(plan.blankToNull).toBe(0)
  })
})
