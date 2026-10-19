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
    // 复算与账单一致时不应有任何差异或告警。
    expect(result.findings).toEqual([])
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
    // 「补」作为性质标记保留在费用行的原文里，不再单独成为说明片段。
    expect(result.lines[0].charges[0].sourceRemarkText).toBe('补 卸货费2000NT')
  })

  it('extracts the embedded rate from the net amount formula', async () => {
    const result = await parseSlhBillWorkbook(createSlhBillFixture())
    expect(result.reported.netAmountFormula).toBe('=(V17-W17)/4.8')
    expect(result.reported.embeddedForeignUnitsPerCny).toBe('4.8000')
    expect(result.findings).toEqual([])
  })

  it('fall backs to the system rate path when the formula has no divisor', async () => {
    const result = await parseSlhBillWorkbook(createSlhBillFixture({ netFormula: '=V17-W17', netValue: '121000' }))
    expect(result.reported.embeddedForeignUnitsPerCny).toBeNull()
    expect(result.reported.netAmountTwd).toBe('121000.00')
    // 不带除数时该单元格本应等于不折算口径，因此不产生差异；但需要提示补汇率。
    expect(result.findings).toEqual([
      // 账单级问题没有行号，原表行号同样为空。
      { kind: 'RATE_MISSING', severity: 'warning', lineNumber: null, sourceRowNumber: null, message: '账单公式未自带汇率，入库时需读取系统当前汇率或手工填写' },
    ])
  })

  it('reports a line whose freight disagrees with the recomputation', async () => {
    const rows = [
      { B: '46024', C: '0102-01柜', D: '千树贸易', E: 'WG-0102-0092', F: 'L-010229', G: '农用履带旋耕机', H: '1', I: 'CTN', J: '885', K: 'KGS', L: '215', M: '137', N: '113', O: '117.545380703489', P: '5', Q: '5', R: '9999', S: '30', T: '100', U: '10129', V: '129000', W: '6000', X: '重货费100 偏遠費6000NT', Y: '测试收货人二' },
    ]
    const result = await parseSlhBillWorkbook(createSlhBillFixture({
      rows, subtotal: { payable: '10129', cod: '129000', ntd: '6000' }, netValue: '25625',
    }))
    // 行级出入项同时带账单内序号与原表行号：前者用于定位，后者与界面「行号」列一致。
    expect(result.findings).toContainEqual({ kind: 'FREIGHT_MISMATCH', severity: 'difference', lineNumber: 1, sourceRowNumber: 14, message: '运费复算 4425.00 与账单 9999 不一致' })
    expect(result.findings).toContainEqual({ kind: 'PAYABLE_MISMATCH', severity: 'difference', lineNumber: 1, sourceRowNumber: 14, message: '合计应付复算 4555.00 与账单 10129 不一致' })
  })

  it('reads an empty amount cell as null and keeps an explicit zero', async () => {
    const result = await parseSlhBillWorkbook(createSlhBillFixture())
    // 来源用「空」表示本行不涉及该项，用「0」表示该项为零；两种写法不能再合并成 0.00。
    expect(result.lines.map(line => [
      line.freightAmountCny, line.codHandlingAmountCny, line.surchargeAmountCny,
      line.codAmountTwd, line.ntdSurchargeAmountTwd,
    ])).toEqual([
      ['0', null, null, null, '2000'],
      ['4425', '30', '100', '129000', '6000'],
      ['1170', null, '100', null, null],
    ])
    // 空值按「不涉及」参与合计，累加结果与合并成 0.00 时完全一致。
    expect(result.totals).toMatchObject({
      freightTotalAmountCny: '5595.00',
      codHandlingTotalAmountCny: '30.00',
      surchargeTotalAmountCny: '200.00',
      payableTotalAmountCny: '5825.00',
      codTotalAmountTwd: '129000.00',
      ntdSurchargeTotalAmountTwd: '8000.00',
    })
    expect(result.findings).toEqual([])
  })

  it('reports a missing amount column as 不涉及 instead of comparing it against 0.00', async () => {
    const rows = [
      { B: '46024', C: '0102-01柜', D: '千树贸易', E: 'WG-0102-0092', F: 'L-010229', G: '农用履带旋耕机', H: '1', I: 'CTN', J: '100', K: 'KGS', O: '117.55', P: '5', Q: '5', Y: '测试收货人二' },
    ]
    const result = await parseSlhBillWorkbook(createSlhBillFixture({
      rows, subtotal: { payable: '0', cod: '0', ntd: '0' }, netValue: '0',
    }))
    expect(result.findings).toEqual([
      { kind: 'FREIGHT_MISMATCH', severity: 'difference', lineNumber: 1, sourceRowNumber: 14, message: '账单未填运费（本行不涉及），复算为 500.00' },
      { kind: 'PAYABLE_MISMATCH', severity: 'difference', lineNumber: 1, sourceRowNumber: 14, message: '账单未填合计应付金额（本行不涉及），复算为 500.00' },
    ])
  })

  it('reports remark fees that the matching amount column does not carry', async () => {
    const rows: ReadonlyArray<Record<string, string>> = [
      { B: '46024', C: '0102-01柜', D: '千树贸易', E: 'WG-0102-0092', F: 'L-010229', G: '农用履带旋耕机', H: '1', I: 'CTN', J: '100', K: 'KGS', O: '117.55', P: '5', Q: '5', R: '500', S: '30', U: '530', X: '重货费100', Y: '测试收货人二' },
      { B: '46038', C: '0116柜', D: '千树贸易', E: 'ZY202449875559', F: 'L-011652', G: '腳手架', H: '1', I: 'CTN', J: '200', K: 'KGS', O: '39', P: '5', Q: '5', R: '1000', S: '30', T: '100', U: '1130', X: '重货费100偏遠費2000NT', Y: '测试收货人三' },
    ]
    const result = await parseSlhBillWorkbook(createSlhBillFixture({
      rows, subtotal: { payable: '1660', cod: '0', ntd: '0' }, netValue: '0',
    }))
    // 备注确实列了费用、对应列却没填：这是来源矛盾，但措辞不能说成「与 0.00 不一致」。
    expect(result.findings).toEqual([
      { kind: 'CHARGE_MISMATCH', severity: 'difference', lineNumber: 1, sourceRowNumber: 14, message: '备注人民币费用合计 100.00，但账单未填附加费（本行不涉及）' },
      { kind: 'CHARGE_MISMATCH', severity: 'difference', lineNumber: 2, sourceRowNumber: 15, message: '备注台币费用合计 2000.00，但账单未填 NTD 杂费（本行不涉及）' },
    ])
  })

  it('flags a dimension carrying more decimals than the record precision', async () => {
    const rows = [
      { B: '46024', C: '0102-01柜', D: '千树贸易', E: 'WG-0102-0092', F: 'L-010229', G: '农用履带旋耕机', H: '1', I: 'CTN', J: '885', K: 'KGS', L: '215.125', M: '137', N: '113', O: '117.55', P: '5', Q: '5', R: '4425', S: '30', T: '100', U: '4555', V: '129000', W: '6000', X: '重货费100 偏遠費6000NT', Y: '测试收货人二' },
    ]
    const result = await parseSlhBillWorkbook(createSlhBillFixture({
      rows, subtotal: { payable: '4555', cod: '129000', ntd: '6000' }, netValue: '25625',
    }))
    expect(result.findings.some(finding => finding.kind === 'DIMENSION_PRECISION' && finding.lineNumber === 1)).toBe(true)
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
