import { parseSlhRemarks, sumSlhCharges } from './slh-bill-charge-parser'

// 用例备注全部取自两份真实对账单，并与该行的附加费列、NTD 杂费列核对过。
describe('slh bill charge parser', () => {
  it('splits a RMB heavy cargo fee from an NTD remote area fee', () => {
    const { charges, notes } = parseSlhRemarks('重货费100 偏遠費2500NT')
    expect(charges).toEqual([
      { chargeType: 'HEAVY_CARGO', currencyCode: 'CNY', amount: '100.00', sourceRemarkText: '重货费100' },
      { chargeType: 'REMOTE_AREA', currencyCode: 'TWD', amount: '2500.00', sourceRemarkText: '偏遠費2500NT' },
    ])
    expect(notes).toEqual([])
  })

  it('splits three NTD fees in one remark', () => {
    const { charges } = parseSlhRemarks('重货费100偏遠費4000NT 驗機費500NT 寄仓费686NT')
    expect(charges.map(charge => [charge.chargeType, charge.currencyCode, charge.amount])).toEqual([
      ['HEAVY_CARGO', 'CNY', '100.00'],
      ['REMOTE_AREA', 'TWD', '4000.00'],
      ['INSPECTION', 'TWD', '500.00'],
      ['STORAGE', 'TWD', '686.00'],
    ])
    expect(sumSlhCharges(charges, 'TWD')).toBe('5186.00')
    expect(sumSlhCharges(charges, 'CNY')).toBe('100.00')
  })

  it('recognises the 台币 suffix as TWD', () => {
    const { charges } = parseSlhRemarks('重货费100超尺費1500NT 堆高機2625台币')
    expect(charges.map(charge => [charge.chargeType, charge.currencyCode, charge.amount])).toEqual([
      ['HEAVY_CARGO', 'CNY', '100.00'],
      ['OVERSIZE', 'TWD', '1500.00'],
      ['FORKLIFT', 'TWD', '2625.00'],
    ])
    expect(sumSlhCharges(charges, 'TWD')).toBe('4125.00')
  })

  it('keeps the supplement marker out of the notes', () => {
    const { charges, notes } = parseSlhRemarks('补 卸货费2000NT')
    expect(charges).toEqual([{ chargeType: 'UNLOADING', currencyCode: 'TWD', amount: '2000.00', sourceRemarkText: '补 卸货费2000NT' }])
    // 「补」是性质标记，原文已在费用行里保留，不再单独报成说明片段。
    expect(notes).toEqual([])
  })

  it('handles traditional and simplified spellings of the same fee', () => {
    expect(parseSlhRemarks('补 派送費1425NT').charges[0]).toMatchObject({ chargeType: 'DELIVERY', currencyCode: 'TWD', amount: '1425.00' })
    expect(parseSlhRemarks('补 派送费500NT').charges[0]).toMatchObject({ chargeType: 'DELIVERY', amount: '500.00' })
    expect(parseSlhRemarks('重货费100 轉派費1100NT').charges[1]).toMatchObject({ chargeType: 'TRANSFER_DELIVERY', amount: '1100.00' })
    expect(parseSlhRemarks('重货费100 二派费：1700NT').charges[1]).toMatchObject({ chargeType: 'REDELIVERY', amount: '1700.00' })
  })

  it('handles a single NTD fee without any RMB surcharge', () => {
    const { charges } = parseSlhRemarks('寄仓费546NT')
    expect(charges).toEqual([{ chargeType: 'STORAGE', currencyCode: 'TWD', amount: '546.00', sourceRemarkText: '寄仓费546NT' }])
  })

  it('keeps amount-free text as a note instead of a zero-amount fee', () => {
    const { charges, notes } = parseSlhRemarks('寄倉費200NT\n优待免收低消')
    expect(charges).toHaveLength(1)
    expect(charges[0]).toMatchObject({ chargeType: 'STORAGE', amount: '200.00' })
    expect(notes).toEqual(['优待免收低消'])
  })

  it('keeps a fee without its own amount as a note', () => {
    const { charges, notes } = parseSlhRemarks('最低消费')
    expect(charges).toEqual([])
    expect(notes).toEqual(['最低消费'])
  })

  it('records an unrecognised fee as other with its original text', () => {
    const { charges } = parseSlhRemarks('码头操作费800NT')
    expect(charges).toEqual([{ chargeType: 'OTHER', currencyCode: 'TWD', amount: '800.00', sourceRemarkText: '码头操作费800NT' }])
  })

  it('returns nothing for an empty remark', () => {
    expect(parseSlhRemarks(null)).toEqual({ charges: [], notes: [] })
    expect(parseSlhRemarks('   ')).toEqual({ charges: [], notes: [] })
  })
})
