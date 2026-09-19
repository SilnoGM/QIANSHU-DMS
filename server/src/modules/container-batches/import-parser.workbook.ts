import { posix } from 'node:path'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { ContainerWorkbookParseError, type WorkbookCell, type WorkbookSheet } from './import-parser.types'
import { attribute, child, children, parseWorkbookXml, textContent } from './import-parser.xml'

const LIMIT = 32 * 1024 * 1024
const INTERESTING = /^(?:xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/u
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) reject(new ContainerWorkbookParseError())
      else resolve(zip)
    })
  })
}
async function readXmlEntry(zip: ZipFile, entry: Entry): Promise<string> {
  const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zip.openReadStream(entry, (error, result) => { if (error || !result) reject(new ContainerWorkbookParseError()); else resolve(result) })
  })
  const buffers: Buffer[] = []
  let size = 0, crc = 0xffffffff
  for await (const part of stream) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part)
    size += buffer.length
    if (size > entry.uncompressedSize || size > LIMIT) throw new ContainerWorkbookParseError('装柜明细表解压内容过大')
    for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
    buffers.push(buffer)
  }
  if (size !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) throw new ContainerWorkbookParseError('装柜明细表内容校验失败')
  const buffer = Buffer.concat(buffers)
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le')
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le')
  return buffer.toString('utf8')
}
async function readPackage(buffer: Buffer): Promise<Map<string, string>> {
  if (buffer.length > 50 * 1024 * 1024) throw new ContainerWorkbookParseError('装柜明细表文件过大')
  const zip = await openZip(buffer), files = new Map<string, string>(), names = new Set<string>()
  let expanded = 0, selected = 0, count = 0
  return await new Promise((resolve, reject) => {
    let finished = false
    const fail = (error: unknown) => {
      if (finished) return
      finished = true; zip.close(); reject(error instanceof ContainerWorkbookParseError ? error : new ContainerWorkbookParseError())
    }
    zip.on('error', fail)
    zip.on('end', () => { if (!finished) { finished = true; resolve(files) } })
    zip.on('entry', (entry: Entry) => {
      const read = async () => {
        const name = entry.fileName
        expanded += entry.uncompressedSize
        if (++count > 2000 || names.has(name.toLowerCase()) || /(?:^|\/)\.\.?(?:\/|$)|\\|^\//u.test(name) || (entry.generalPurposeBitFlag & 1) || expanded > 200 * 1024 * 1024) throw new ContainerWorkbookParseError('装柜明细表压缩包无效或内容过多')
        names.add(name.toLowerCase())
        if (INTERESTING.test(name)) {
          selected += entry.uncompressedSize
          if (selected > LIMIT || entry.uncompressedSize > 16 * 1024 * 1024) throw new ContainerWorkbookParseError('装柜明细表解析内容过大')
          files.set(name, await readXmlEntry(zip, entry))
        }
        zip.readEntry()
      }
      void read().catch(fail)
    })
    zip.readEntry()
  })
}
export function cellPosition(reference: string): { column: number, row: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,5})$/u.exec(reference)
  if (!match) throw new ContainerWorkbookParseError('装柜明细表包含无效单元格坐标')
  const column = [...match[1]].reduce((total, value) => total * 26 + value.charCodeAt(0) - 64, 0), row = Number(match[2])
  if (column > 256 || row > 10_000) throw new ContainerWorkbookParseError('装柜明细表超过 10000 行或 256 列限制')
  return { column, row }
}
function loadSheet(name: string, index: number, xml: string, strings: string[]): WorkbookSheet {
  const root = parseWorkbookXml(xml), rows: WorkbookSheet['rows'] = new Map()
  if (root.name !== 'worksheet') throw new ContainerWorkbookParseError()
  let cellCount = 0
  for (const rowNode of children(child(root, 'sheetData') ?? root, 'row')) {
    const rowNumber = Number(rowNode.attributes.r)
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 10_000 || rows.has(rowNumber)) throw new ContainerWorkbookParseError('装柜明细表行号无效或超过 10000 行限制')
    const row = new Map<number, WorkbookCell>(); rows.set(rowNumber, row)
    for (const cellNode of children(rowNode, 'c')) {
      if (++cellCount > 100_000) throw new ContainerWorkbookParseError('装柜明细表单元格过多')
      const reference = cellNode.attributes.r, position = cellPosition(reference)
      if (position.row !== rowNumber || row.has(position.column)) throw new ContainerWorkbookParseError('装柜明细表单元格坐标重复或无效')
      const type = cellNode.attributes.t ?? 'n', raw = child(cellNode, 'v')?.text ?? null
      let value = raw
      if (type === 's') {
        if (raw === null || !/^\d+$/u.test(raw) || strings[Number(raw)] === undefined) throw new ContainerWorkbookParseError('装柜明细表共享文字索引无效')
        value = strings[Number(raw)]
      }
      else if (type === 'inlineStr') value = child(cellNode, 'is') ? textContent(child(cellNode, 'is')!) : null
      const formula = child(cellNode, 'f')
      row.set(position.column, { reference, value, formula: formula?.text ?? null, sharedFormulaIndex: formula?.attributes.si ?? null, type, mergedFrom: null })
    }
  }
  // 合并单元格只传播实际来源值并保留原坐标；不把普通空白行猜测为上一行的数据。
  let propagated = 0
  for (const merge of children(child(root, 'mergeCells') ?? root, 'mergeCell')) {
    const [start, end] = (merge.attributes.ref ?? '').split(':').map(cellPosition)
    if (!end || end.row < start.row || end.column < start.column) throw new ContainerWorkbookParseError('装柜明细表合并单元格无效')
    const source = rows.get(start.row)?.get(start.column)
    if (!source) continue
    for (let r = start.row; r <= end.row; r++) {
      const row = rows.get(r)
      if (!row) continue
      for (let c = start.column; c <= end.column; c++) {
        if (++propagated > 100_000) throw new ContainerWorkbookParseError('装柜明细表合并区域过大')
        if ((r !== start.row || c !== start.column) && !row.get(c)?.value) row.set(c, { ...source, mergedFrom: source.reference })
      }
    }
  }
  return { name, index, rows }
}
export async function readContainerWorkbook(buffer: Buffer): Promise<WorkbookSheet[]> {
  const files = await readPackage(buffer), workbook = files.get('xl/workbook.xml'), relations = files.get('xl/_rels/workbook.xml.rels')
  if (!workbook || !relations) throw new ContainerWorkbookParseError()
  const root = parseWorkbookXml(workbook), relRoot = parseWorkbookXml(relations)
  if (root.name !== 'workbook' || relRoot.name !== 'Relationships') throw new ContainerWorkbookParseError()
  const stringsXml = files.get('xl/sharedStrings.xml')
  const strings = stringsXml ? children(parseWorkbookXml(stringsXml), 'si').map(textContent) : []
  const sheets = children(child(root, 'sheets') ?? root, 'sheet')
  if (sheets.length > 50) throw new ContainerWorkbookParseError('装柜明细表最多包含 50 个工作表')
  return sheets.map((sheet, index) => {
    const rel = children(relRoot, 'Relationship').find(item => item.attributes.Id === attribute(sheet, 'id'))
    if (!rel || rel.attributes.TargetMode === 'External' || !rel.attributes.Type?.endsWith('/worksheet')) throw new ContainerWorkbookParseError('装柜明细表工作表引用无效')
    const target = rel.attributes.Target ?? '', normalized = posix.normalize(target.startsWith('/') ? target.slice(1) : `xl/${target}`)
    if (!/^xl\/worksheets\/[^/]+\.xml$/u.test(normalized) || !files.has(normalized)) throw new ContainerWorkbookParseError('装柜明细表缺少工作表')
    return loadSheet(sheet.attributes.name ?? `Sheet${index + 1}`, index, files.get(normalized)!, strings)
  })
}
