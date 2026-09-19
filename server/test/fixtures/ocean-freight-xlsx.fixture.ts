/** 最小自有 OOXML 包；通过真实文档验证器，不读取用户的业务表格或增加 ZIP 写入依赖。 */
export function createOceanXlsxFixture(): Buffer {
  const entries = [
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>'],
    // Excel/WPS 的普通字体主题包含 script 属性，来源上传也必须接受这一真实结构。
    ['xl/theme/theme1.xml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="Office"><a:majorFont><a:font script="Hans" typeface="SimSun"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>'],
  ]
  const locals: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const [filename, xml] of entries) {
    const name = Buffer.from(filename), body = Buffer.from(xml)
    let checksum = 0xffffffff
    for (const byte of body) {
      checksum ^= byte
      for (let bit = 0; bit < 8; bit++) checksum = checksum & 1 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1
    }
    checksum = (checksum ^ 0xffffffff) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50)
    header.writeUInt16LE(0x0314, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt32LE(checksum, 16)
    header.writeUInt32LE(body.length, 20)
    header.writeUInt32LE(body.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE((0o100640 << 16) >>> 0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)
    offset += local.length + name.length + body.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
