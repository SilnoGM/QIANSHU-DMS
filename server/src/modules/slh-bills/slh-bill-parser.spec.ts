import { containerImportZip } from '../../../test/fixtures/container-import.fixture'
import { createSlhBillFixture } from '../../../test/fixtures/slh-bill-xlsx.fixture'
import { parseSlhBillWorkbook, SlhBillWorkbookParseError } from './slh-bill-parser'

describe('slh bill workbook parser', () => {
  it('reads the header row below the bank account block and maps every column', async () => {
    const result = await parseSlhBillWorkbook(createSlhBillFixture())
    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toMatchObject({
      lineNumber: 1, sourceSheetName: '待签收返款账单', sourceRowNumber: 14,
      loadingDate: '2025-12-11', containerBatchName: '1211-01柜',
      warehouseReceiptReference: 'WG-0078-0072', shippingMarkText: 'J-121125',
      goodsName: '农用四轮微耕机', packageCount: 1, packageUnit: 'CTN',
      weightUnit: 'KGS', recipientInfoRaw: '测试收货人一', remark: '补 卸货费2000NT',
      errors: [],
    })
    expect(result.periodStart).toBe('2025-12-11')
    expect(result.periodEnd).toBe('2026-01-16')
    expect(result.containerBatchNames).toEqual(['0102-01柜', '0116柜', '1211-01柜'])
  })

  it('recomputes volume, freight and payable without reporting differences', async () => {
    const result = await parseSlhBillWorkbook(createSlhBillFixture())
    // 三条数据行分别覆盖：无单价行、按重量计价行、按材积计价行。
    expect(result.lines.map(line => [line.volumeCai, line.pricingBasis, line.freightAmountCny, line.payableAmountCny])).toEqual([
      [null, null, '0', '0'],
      ['117.55', 'WEIGHT', '4425', '4555'],
      ['39.00', 'VOLUME', '1170', '1270'],
    ])
    expect(result.differences).toEqual([])
  })

  it('sums the lines and agrees with the bill subtotal', async () => {
    const result = await parseSlhBillWorkbook(createSlhBillFixture())
    expect(result.totals).toMatchObject({
      freightTotalAmountCny: '5595.00',
      codHandlingTotalAmountCny: '30.00',
      surchargeTotalAmountCny: '200.00',
      payableTotalAmountCny: '5825.00',
      codTotalAmountTwd: '129000.00',
      ntdSurchargeTotalAmountTwd: '8000.00',
      // 「合计应付台币NTD」按不折算口径：代收货款减 NTD 杂费合计。
      reportedNetAmountTwd: '121000.00',
    })
    expect(result.reported).toMatchObject({ subtotalPayableAmountCny: '5825.00', payableAmountCny: '-5825.00' })
  })

  it('splits remark fees into charge rows per currency', async () => {
    const result = await parseSlhBillWorkbook(createSlhBillFixture())
    expect(result.lines[1].charges.map(charge => [charge.chargeType, charge.currencyCode, charge.amount])).toEqual([
      ['HEAVY_CARGO', 'CNY', '100.00'],
      ['REMOTE_AREA', 'TWD', '6000.00'],
    ])
    expect(result.lines[0].charges.map(charge => [charge.chargeType, charge.currencyCode, charge.amount])).toEqual([
      ['UNLOADING', 'TWD', '2000.00'],
    ])
    expect(result.lines[0].notes).toEqual(['补'])
  })

  it('extracts the embedded rate from the net amount formula', async () => {
    const result = await parseSlhBillWorkbook(createSlhBillFixture())
    expect(result.reported.netAmountFormula).toBe('=(V17-W17)/4.8')
    expect(result.reported.embeddedForeignUnitsPerCny).toBe('4.800000000000')
    expect(result.warnings).toEqual([])
  })

  it('fall backs to the system rate path when the formula has no divisor', async () => {
    const result = await parseSlhBillWorkbook(createSlhBillFixture({ netFormula: '=V17-W17', netValue: '121000' }))
    expect(result.reported.embeddedForeignUnitsPerCny).toBeNull()
    expect(result.reported.netAmountTwd).toBe('121000.00')
    // 不带除数时该单元格本应等于不折算口径，因此不产生差异；但需要提示补汇率。
    expect(result.differences).toEqual([])
    expect(result.warnings).toEqual(['账单公式未自带汇率，入库时需读取系统当前汇率或手工填写'])
  })

  it('reports a line whose freight disagrees with the recomputation', async () => {
    const rows = [
      { B: '46024', C: '0102-01柜', D: '千树贸易', E: 'WG-0102-0092', F: 'L-010229', G: '农用履带旋耕机', H: '1', I: 'CTN', J: '885', K: 'KGS', L: '215', M: '137', N: '113', O: '117.545380703489', P: '5', Q: '5', R: '9999', S: '30', T: '100', U: '10129', V: '129000', W: '6000', X: '重货费100 偏遠費6000NT', Y: '测试收货人二' },
    ]
    const result = await parseSlhBillWorkbook(createSlhBillFixture({
      rows, subtotal: { payable: '10129', cod: '129000', ntd: '6000' }, netValue: '25625',
    }))
    expect(result.differences).toContain('第 1 行：运费复算 4425.00 与账单 9999 不一致')
    expect(result.differences).toContain('第 1 行：合计应付复算 4555.00 与账单 10129 不一致')
  })

  it('flags a dimension carrying more decimals than the record precision', async () => {
    const rows = [
      { B: '46024', C: '0102-01柜', D: '千树贸易', E: 'WG-0102-0092', F: 'L-010229', G: '农用履带旋耕机', H: '1', I: 'CTN', J: '885', K: 'KGS', L: '215.125', M: '137', N: '113', O: '117.55', P: '5', Q: '5', R: '4425', S: '30', T: '100', U: '4555', V: '129000', W: '6000', X: '重货费100 偏遠費6000NT', Y: '测试收货人二' },
    ]
    const result = await parseSlhBillWorkbook(createSlhBillFixture({
      rows, subtotal: { payable: '4555', cod: '129000', ntd: '6000' }, netValue: '25625',
    }))
    expect(result.warnings.some(warning => warning.includes('长在来源里保留 3 位小数'))).toBe(true)
  })

  it('rejects a workbook without the bill header', async () => {
    const other = containerImportZip({
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>其他文件</t></is></c></row></sheetData></worksheet>',
    })
    await expect(parseSlhBillWorkbook(other)).rejects.toBeInstanceOf(SlhBillWorkbookParseError)
  })
})
