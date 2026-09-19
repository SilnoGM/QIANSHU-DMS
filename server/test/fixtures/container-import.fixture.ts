/** 自有脱敏 OOXML 测试资料，只表达承运商表头结构。 */
export function createContainerImportFixture(options: {
  sheets?: Array<{ name: string, rows: string, merges?: string[] }>
  sharedStrings?: string[]
  overrides?: Record<string, string>
} = {}): Buffer {
  const sheets = options.sheets ?? [{ name: '装柜资料', rows: containerImportHeader() + containerImportRow(3) }]
  const entries: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  }
  sheets.forEach((sheet, i) => {
    entries[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${sheet.rows}</sheetData><mergeCells>${(sheet.merges ?? ['E2:F2', 'G2:H2', 'I2:K2']).map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells></worksheet>`
  })
  if (options.sharedStrings) entries['xl/sharedStrings.xml'] = `<sst>${options.sharedStrings.map(value => `<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`
  Object.assign(entries, options.overrides)
  return containerImportZip(entries)
}

export function escapeXml(value: string) { return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;') }
export function textCell(reference: string, value: string) { return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>` }
export function numberCell(reference: string, value: string, formula?: string) { return `<c r="${reference}">${formula === undefined ? '' : `<f>${escapeXml(formula)}</f>`}<v>${escapeXml(value)}</v></c>` }
export function containerImportHeader() {
  return `<row r="1">${textCell('A1', '测试承运商装柜资料')}</row><row r="2">${Object.entries({ A: 'ITEM', B: '入倉單號', C: '嘜頭', D: 'Description of Goods', E: 'CTN', G: 'G.W', I: 'Measurement', L: '材數', M: '客户', N: '地址', O: '電話', P: '收件人', Q: '代收\n（台幣）', R: '备注' }).map(([col, value]) => textCell(`${col}2`, value)).join('')}</row>`
}
export function containerImportRow(row: number, changes: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = { A: '0917柜', B: 'MARK/001/货件-01', C: 'L-091700-01~10', D: '测试设备', E: '10', F: 'CTN', G: '180', H: 'KGS', I: '128', J: '19', K: '15', L: '12.882720', N: '测试市测试路1号', O: '0912345678', P: '测试收件人', Q: '20000', R: null, ...changes }
  return `<row r="${row}">${Object.entries(values).filter(([, value]) => value !== null).map(([col, value]) => ['E', 'G', 'I', 'J', 'K', 'L', 'Q'].includes(col) ? numberCell(`${col}${row}`, value!) : textCell(`${col}${row}`, value!)).join('')}</row>`
}
export function containerImportZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const [filename, xml] of Object.entries(entries)) {
    const name = Buffer.from(filename), body = Buffer.from(xml)
    let checksum = 0xffffffff
    for (const byte of body) {
      checksum ^= byte
      for (let bit = 0; bit < 8; bit++) checksum = checksum & 1 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1
    }
    checksum = (checksum ^ 0xffffffff) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6)
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8)
    header.writeUInt32LE(checksum, 16); header.writeUInt32LE(body.length, 20); header.writeUInt32LE(body.length, 24); header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE((0o100640 << 16) >>> 0, 38); header.writeUInt32LE(offset, 42)
    central.push(header, name); offset += local.length + name.length + body.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
