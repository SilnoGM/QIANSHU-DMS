import { containerImportHeader, containerImportRow, createContainerImportFixture, numberCell, textCell } from '../../../test/fixtures/container-import.fixture'
import { parseContainerWorkbook } from './import-parser'

describe('container workbook parser', () => {
  it('maps carrier headers, preserves a ten-piece row and does not multiply gross weight', async () => {
    const result = await parseContainerWorkbook(createContainerImportFixture())
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ rowKey: '1:3', sourceSheetName: '装柜资料', sourceRowNumber: 3, containerBatchName: '0917柜', warehouseReceiptReference: 'MARK/001/货件-01', oceanShippingMarkText: 'L-091700-01~10', packageCount: 10, grossWeightKg: '180', lengthCm: '128', reportedVolumeCai: '12.88272', recipientPhone: '0912345678', codAmountTwd: '20000', errors: [] })
  })
  it('keeps original numeric strings/formulas and warns instead of restoring lost phone zeros', async () => {
    const row = containerImportRow(3).replace(textCell('O3', '0912345678'), numberCell('O3', '912345678')).replace(numberCell('L3', '12.882720'), numberCell('L3', '12.8827201234567', 'I3*J3*K3/28316*E3'))
    const { rows } = await parseContainerWorkbook(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + row }] }))
    expect(rows[0].reportedVolumeCai).toBe('12.88272012')
    expect(rows[0].recipientPhone).toBe('912345678')
    expect(rows[0].warnings.join()).toContain('前导零')
    expect(rows[0].sourceData).toMatchObject({ cells: { L3: { value: '12.8827201234567', formula: 'I3*J3*K3/28316*E3' } } })
  })
  it('handles multi-sheet names, merged data and repeated headers; skips totals and formula-only templates', async () => {
    const rows = containerImportHeader() + containerImportRow(3) + containerImportRow(4, { A: null, B: null }) + `<row r="5">${textCell('A5', '合计')}${numberCell('E5', '20', 'SUM(E3:E4)')}</row><row r="6">${numberCell('L6', '0', 'I6*J6*K6/28316*E6')}</row>`
    const result = await parseContainerWorkbook(createContainerImportFixture({ sheets: [{ name: '0917柜', rows, merges: ['A3:A4', 'B3:B4'] }, { name: '说明', rows: `<row r="1">${textCell('A1', '说明')}</row>` }] }))
    expect(result.rows).toHaveLength(2)
    expect(result.rows[1].warehouseReceiptReference).toBe('MARK/001/货件-01')
    expect(result.rows[1].containerBatchName).toBe('0917柜')
    expect(result.warnings.join()).toContain('说明')
  })
  it('uses distinct stable keys on multiple data sheets and skips repeated table headers', async () => {
    const header = containerImportHeader().replace(/r="([A-Z]*)1"/gu, 'r="$114"').replace(/r="([A-Z]*)2"/gu, 'r="$115"')
    const result = await parseContainerWorkbook(createContainerImportFixture({ sheets: [
      { name: '0917柜', rows: containerImportHeader() + containerImportRow(3, { A: null }) + header + containerImportRow(16, { A: null }) },
      { name: '0918-01柜', rows: containerImportHeader() + containerImportRow(3, { A: null }) },
    ] }))
    expect(result.rows.map(row => row.rowKey)).toEqual(['1:3', '1:16', '2:3'])
    expect(result.rows.map(row => row.containerBatchName)).toEqual(['0917柜', '0917柜', '0918-01柜'])
  })
  it('preserves decimal precision for large money and scientific notation without floating-point conversion', async () => {
    const result = await parseContainerWorkbook(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + containerImportRow(3, { Q: '9007199254740993.01', G: '1.25E3' }) }] }))
    expect(result.rows[0]).toMatchObject({ codAmountTwd: '9007199254740993.01', grossWeightKg: '1250', errors: [] })
  })
  it('rejects corrupted stored-entry checksums even when the XML remains readable', async () => {
    const buffer = createContainerImportFixture()
    const start = buffer.indexOf(Buffer.from('<workbook'))
    const offset = buffer.indexOf(Buffer.from('name="'), start)
    // 只改变属性名大小写，XML 仍合法，但 ZIP 中保存的校验和已经失效。
    buffer[offset] = 'N'.charCodeAt(0)
    await expect(parseContainerWorkbook(buffer)).rejects.toThrow()
  })
  it('calculates only safe arithmetic without a cache and reports missing references or unsupported formulas', async () => {
    const rows = containerImportHeader() + containerImportRow(3).replace(numberCell('L3', '12.882720'), '<c r="L3"><f>I3*J3*K3/28316*E3</f></c>') + containerImportRow(4).replace(numberCell('L4', '12.882720'), '<c r="L4"><f>WEBSERVICE("https://invalid")</f></c>')
    const result = await parseContainerWorkbook(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows }] }))
    expect(result.rows[0].reportedVolumeCai).toBe('12.88317559')
    expect(result.rows[1].reportedVolumeCai).toBeNull()
    expect(result.rows[1].errors.join()).toContain('公式')
  })
  it('reports malformed numbers and missing business fields on individual rows', async () => {
    const result = await parseContainerWorkbook(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + containerImportRow(3, { E: '1.5', G: '-1', D: null }) }] }))
    expect(result.rows[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('件数'), expect.stringContaining('毛重'), expect.stringContaining('品名')]))
  })
  it('does not round a fractional package count into an integer', async () => {
    const result = await parseContainerWorkbook(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + containerImportRow(3, { E: '1.0000000001' }) }] }))
    expect(result.rows[0].errors.join()).toContain('件数')
  })
  it('retains shared-formula cached values and reference indexes', async () => {
    const row = containerImportRow(3).replace(numberCell('L3', '12.882720'), '<c r="L3"><f t="shared" si="0"/><v>12.88272</v></c>')
    const result = await parseContainerWorkbook(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + row }] }))
    expect(result.rows[0].reportedVolumeCai).toBe('12.88272')
    expect(result.rows[0].sourceData.cells.L3).toMatchObject({ formula: '', sharedFormulaIndex: '0' })
  })
  it.each(['I3/0', 'L3+1', 'Z3*2', '[Book.xlsx]Sheet1!A1'])('reports invalid or unsafe uncached formula %s', async formula => {
    const row = containerImportRow(3).replace(numberCell('L3', '12.882720'), `<c r="L3"><f>${formula}</f></c>`)
    const result = await parseContainerWorkbook(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + row }] }))
    expect(result.rows[0].errors.join()).toContain('公式')
  })
  it('reads rich shared text without treating XML text as markup', async () => {
    const row = containerImportRow(3).replace(textCell('D3', '测试设备'), '<c r="D3" t="s"><v>0</v></c>')
    const result = await parseContainerWorkbook(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + row }], overrides: { 'xl/sharedStrings.xml': '<sst><si><r><t>设备 &amp; </t></r><r><t>&lt;型号&gt;</t></r></si></sst>' } }))
    expect(result.rows[0].goodsName).toBe('设备 & <型号>')
  })
  it.each([
    ['not zip', () => Buffer.from('bad')],
    ['malformed XML', () => createContainerImportFixture({ overrides: { 'xl/workbook.xml': '<workbook><sheets></workbook>' } })],
    ['XML entities', () => createContainerImportFixture({ overrides: { 'xl/sharedStrings.xml': '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><sst/>' } })],
    ['unknown entities', () => createContainerImportFixture({ overrides: { 'xl/sharedStrings.xml': '<sst><si><t>&constructor;</t></si></sst>' } })],
    ['external worksheet', () => createContainerImportFixture({ overrides: { 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="worksheet" Target="https://invalid" TargetMode="External"/></Relationships>' } })],
    ['missing headers', () => createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportRow(3) }] })],
    ['empty template', () => createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() }] })],
    ['row limit', () => createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + containerImportRow(100001) }] })],
    ['too many worksheets', () => createContainerImportFixture({ sheets: Array.from({ length: 51 }, (_, index) => ({ name: `sheet${index}`, rows: containerImportHeader() + containerImportRow(3) })) })],
    ['excessive XML depth', () => createContainerImportFixture({ overrides: { 'xl/sharedStrings.xml': `<sst>${'<r>'.repeat(70)}x${'</r>'.repeat(70)}</sst>` } })],
  ])('rejects %s', async (_, make) => { await expect(parseContainerWorkbook(make())).rejects.toThrow() })
})
