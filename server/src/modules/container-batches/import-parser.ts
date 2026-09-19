import { importCellNumber, importPackageCount } from './import-parser.numbers'
import { ContainerWorkbookParseError, type ParsedContainerRow, type WorkbookCell, type WorkbookSheet } from './import-parser.types'
import { readContainerWorkbook } from './import-parser.workbook'

export { ContainerWorkbookParseError } from './import-parser.types'
export type { ParsedContainerRow } from './import-parser.types'
type Field = keyof Omit<ParsedContainerRow, 'rowKey' | 'sourceSheetName' | 'sourceRowNumber' | 'sourceData' | 'errors' | 'warnings'>
type Columns = Partial<Record<Field, number>>
function headerText(value: string) { return value.replace(/[\s.（）()]/gu, '').toLowerCase() }
const HEADERS: Partial<Record<Field, string[]>> = {
  containerBatchName: ['item', '柜次', '柜号', '櫃號', '柜次名称'],
  warehouseReceiptReference: ['入倉單號', '入仓单号', '入仓参考'],
  oceanShippingMarkText: ['嘜頭', '唛头', '海运唛头'],
  goodsName: ['descriptionofgoods', '品名', '产品名称', '貨名'],
  packageCount: ['ctn', '件数', '件數', '包装件数'],
  packageUnit: ['包装单位', '包裝單位'],
  grossWeightKg: ['gw', '毛重', '毛重kg', '整行毛重kg'],
  lengthCm: ['measurement', '尺寸', '长', '長', '长cm'],
  widthCm: ['宽', '寬', '宽cm'], heightCm: ['高', '高cm'],
  reportedVolumeCai: ['材數', '材数', '来源材积', '来源材积材'],
  recipientName: ['收件人', '收件人姓名'], recipientPhone: ['電話', '电话', '收件人电话'],
  recipientAddress: ['地址', '收货地址', '收件地址'], codAmountTwd: ['代收台幣', '代收台币', '代收货款', '代收'], remark: ['备注', '備註'],
}
function findColumns(row: Map<number, WorkbookCell>): Columns | null {
  const result: Columns = {}
  for (const [column, cell] of row) {
    if (!cell.value || cell.mergedFrom) continue
    const label = headerText(cell.value)
    for (const [field, aliases] of Object.entries(HEADERS)) if (aliases.some(alias => headerText(alias) === label)) result[field as Field] = column
  }
  if (!result.goodsName || !result.warehouseReceiptReference || !result.oceanShippingMarkText || !result.packageCount) return null
  if (result.lengthCm) { result.widthCm ??= result.lengthCm + 1; result.heightCm ??= result.lengthCm + 2 }
  result.packageUnit ??= result.packageCount + 1
  return result
}
function batchName(value: string | null): string | null {
  const match = /(?:^|[^\d])(\d{4}(?:-\d{2})?)[柜櫃](?:子)?/u.exec(value ?? '')
  return match ? `${match[1]}柜` : null
}
function normalizeText(cell: WorkbookCell | undefined, maximum: number, label: string, errors: string[]): string | null {
  const value = cell?.value?.replace(/[\r\n\t]+/gu, ' ').trim() || null
  if (cell?.type === 'e' || (!value && cell?.formula !== null && cell?.formula !== undefined)) errors.push(`${label}单元格公式结果无效`)
  if (value && ([...value].length > maximum || /[\p{Cc}\p{Cs}]/u.test(value))) errors.push(`${label}内容过长或含无效字符`)
  return value
}
function parseRow(sheet: WorkbookSheet, rowNumber: number, cells: Map<number, WorkbookCell>, columns: Columns, fallbackBatch: string | null): ParsedContainerRow | null {
  const cell = (field: Field) => columns[field] ? cells.get(columns[field]) : undefined
  const identity = [cell('warehouseReceiptReference'), cell('oceanShippingMarkText'), cell('goodsName')].map(value => value?.value?.trim()).filter(Boolean)
  if (!identity.length || (!cell('oceanShippingMarkText')?.value && !cell('warehouseReceiptReference')?.value && identity.every(value => /^(?:合计|合計|总计|總計|total|备注|備註|说明|說明)/iu.test(value!)))) return null
  const errors: string[] = [], warnings: string[] = []
  const text = (field: Field, label: string, maximum: number) => normalizeText(cell(field), maximum, label, errors)
  const numeric = (field: Field, label: string, scale: number, precision: number, positive = false) => {
    try { return importCellNumber(cell(field), sheet, scale, precision, positive) }
    catch { errors.push(`${label}${cell(field)?.formula !== null && cell(field)?.formula !== undefined ? '公式无法可靠解析或结果无效' : '必须为有效数值'}`); return null }
  }
  const goodsName = text('goodsName', '品名', 255) ?? ''
  if (!goodsName) errors.push('品名不能为空')
  let count = 0
  try { count = importPackageCount(cell('packageCount'), sheet) }
  catch { errors.push('包装件数必须为 1 至 1000000 的整数') }
  const recipientPhone = text('recipientPhone', '收件人电话', 128)
  if (recipientPhone && cell('recipientPhone')?.type === 'n') warnings.push('电话以数字保存，可能已丢失前导零，请核对原始联系方式')
  const sourceData: ParsedContainerRow['sourceData'] = { cells: {} }
  for (const value of cells.values()) {
    const { value: raw, formula, type, sharedFormulaIndex, mergedFrom } = value
    sourceData.cells[value.reference] = { value: raw, formula, type, sharedFormulaIndex, mergedFrom }
  }
  const rawBatch = text('containerBatchName', '柜次名称', 128), containerBatchName = batchName(rawBatch) ?? fallbackBatch
  if (rawBatch && !batchName(rawBatch)) errors.push('来源柜次名称无法识别')
  return {
    rowKey: `${sheet.index + 1}:${rowNumber}`, sourceSheetName: sheet.name, sourceRowNumber: rowNumber,
    containerBatchName, warehouseReceiptReference: text('warehouseReceiptReference', '入仓参考', 500), oceanShippingMarkText: text('oceanShippingMarkText', '海运唛头', 128),
    goodsName, packageCount: count, packageUnit: text('packageUnit', '包装单位', 32),
    grossWeightKg: numeric('grossWeightKg', '整行毛重', 3, 18, true), lengthCm: numeric('lengthCm', '每件长度', 3, 18, true),
    widthCm: numeric('widthCm', '每件宽度', 3, 18, true), heightCm: numeric('heightCm', '每件高度', 3, 18, true),
    reportedVolumeCai: numeric('reportedVolumeCai', '来源材积', 8, 24),
    recipientName: text('recipientName', '收件人', 128), recipientPhone, recipientAddress: text('recipientAddress', '收件地址', 2000),
    codAmountTwd: numeric('codAmountTwd', '代收金额', 2, 30), remark: text('remark', '备注', 500), sourceData, errors, warnings,
  }
}
export async function parseContainerWorkbook(buffer: Buffer): Promise<{ rows: ParsedContainerRow[], warnings: string[] }> {
  try {
    const sheets = await readContainerWorkbook(buffer), rows: ParsedContainerRow[] = [], warnings: string[] = []
    for (const sheet of sheets) {
      let columns: Columns | null = null, fallbackBatch = batchName(sheet.name)
      for (const [rowNumber, cells] of [...sheet.rows].sort(([a], [b]) => a - b)) {
        const header = findColumns(cells)
        if (header) { columns = header; continue }
        if (!columns) { fallbackBatch ??= [...cells.values()].map(value => batchName(value.value)).find(Boolean) ?? null; continue }
        const row = parseRow(sheet, rowNumber, cells, columns, fallbackBatch)
        if (row) rows.push(row)
        if (rows.length > 5000) throw new ContainerWorkbookParseError('单次最多解析 5000 条装柜明细')
      }
      if (!columns) warnings.push(`工作表“${sheet.name}”未识别到装柜明细表头，已跳过`)
    }
    if (!rows.length) throw new ContainerWorkbookParseError('未找到有效装柜明细，请检查表头及货物资料')
    return { rows, warnings }
  }
  catch (error) {
    if (error instanceof ContainerWorkbookParseError) throw error
    throw new ContainerWorkbookParseError()
  }
}
