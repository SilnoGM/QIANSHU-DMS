import { importCellNumber, importPackageCount } from '../container-batches/import-parser.numbers'
import type { WorkbookCell, WorkbookSheet } from '../container-batches/import-parser.types'
import { readContainerWorkbook } from '../container-batches/import-parser.workbook'
import { formatDecimal, parseDecimal } from '../ocean-freight-calculation/ocean-decimal'
import { parseSlhRemarks, sumSlhCharges } from './slh-bill-charge-parser'
import {
  calculateSlhFreight, calculateSlhPayable, deriveSlhPricingBasis, recordSlhVolume,
  slhAmountsEqual, slhNormalizeAmount, slhVolumeRatio, slhVolumesEqual, sourceDecimalPlaces, sumSlhAmounts,
} from './slh-bill-calculation'
import {
  SlhBillWorkbookParseError,
  type ParsedSlhBill, type ParsedSlhBillLine, type SlhBillFinding, type SlhBillFindingKind,
} from './slh-bill-parser.types'

export { SlhBillWorkbookParseError } from './slh-bill-parser.types'
export type { ParsedSlhBill, ParsedSlhBillLine } from './slh-bill-parser.types'

type Field =
  | 'loadingDate' | 'containerBatchName' | 'warehouseReceiptReference' | 'shippingMarkText'
  | 'goodsName' | 'packageCount' | 'packageUnit' | 'grossWeightKg' | 'weightUnit'
  | 'lengthCm' | 'widthCm' | 'heightCm' | 'reportedVolumeCai' | 'categoryCode' | 'unitPriceAmount'
  | 'freightAmountCny' | 'codHandlingAmountCny' | 'surchargeAmountCny' | 'payableAmountCny'
  | 'codAmountTwd' | 'ntdSurchargeAmountTwd' | 'remark' | 'recipientInfoRaw'
type Columns = Partial<Record<Field, number>>

/** 表头文本归一：去掉空白、换行、括号与冒号后比对，兼容繁简两套写法。 */
function headerText(value: string) { return value.replace(/[\s.（）()：:]/gu, '').toLowerCase() }

const HEADERS: Record<Field, string[]> = {
  loadingDate: ['装柜日期', '裝櫃日期'],
  containerBatchName: ['柜号', '櫃號'],
  warehouseReceiptReference: ['入倉單號', '入仓单号', '入仓参考'],
  shippingMarkText: ['嘜頭', '唛头', '海运唛头'],
  goodsName: ['货物品名', '貨物品名', '品名'],
  packageCount: ['箱数', '箱數'],
  packageUnit: ['单位', '單位'],
  grossWeightKg: ['出货重量', '出貨重量'],
  weightUnit: ['重量单位', '重量單位'],
  lengthCm: ['装箱尺寸cm', '裝箱尺寸cm'],
  widthCm: ['宽cm', '寬cm'],
  heightCm: ['高cm'],
  reportedVolumeCai: ['材数', '材數'],
  categoryCode: ['类别', '類別'],
  unitPriceAmount: ['单价RMB', '單價RMB', '单价', '單價'],
  freightAmountCny: ['运费RMB', '運費RMB'],
  codHandlingAmountCny: ['代收手续费RMB', '代收手續費RMB'],
  surchargeAmountCny: ['附加费RMB', '附加費RMB'],
  payableAmountCny: ['合计应付金额RMB', '合計應付金額RMB'],
  codAmountTwd: ['代收货款NTD', '代收貨款NTD'],
  ntdSurchargeAmountTwd: ['偏远费NTD', '偏遠費NTD'],
  remark: ['备注', '備註'],
  recipientInfoRaw: ['收货人信息', '收貨人信息'],
}

/** 缺任一列即无法构成一张可入库的账单。 */
const REQUIRED: readonly Field[] = [
  'loadingDate', 'containerBatchName', 'goodsName', 'packageCount', 'packageUnit',
  'grossWeightKg', 'lengthCm', 'reportedVolumeCai', 'unitPriceAmount',
  'freightAmountCny', 'codHandlingAmountCny', 'surchargeAmountCny', 'payableAmountCny',
  'codAmountTwd', 'ntdSurchargeAmountTwd', 'remark', 'recipientInfoRaw',
]

const FOOTER_PATTERN = /^(?:小计|小計|合计|合計|总计|總計|total)/iu
const PAYABLE_LABEL_PATTERN = /(?:应付|應付).*(?:人民币|人民幣)/u
const NET_LABEL_PATTERN = /(?:应付|應付).*(?:台币|台幣|台幣)/u
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const MAX_LINES = 5000

function findColumns(row: Map<number, WorkbookCell>): Columns | null {
  const result: Columns = {}
  for (const [column, cell] of row) {
    if (!cell.value || cell.mergedFrom) continue
    const label = headerText(cell.value)
    for (const [field, aliases] of Object.entries(HEADERS) as Array<[Field, string[]]>) {
      if (aliases.some(alias => headerText(alias) === label)) result[field] = column
    }
  }
  // 单位与尺寸的次列在表头上是空白或合并单元格，只能按位置补齐；必须在必填检查之前完成。
  if (result.packageCount !== undefined) result.packageUnit ??= result.packageCount + 1
  if (result.grossWeightKg !== undefined) result.weightUnit ??= result.grossWeightKg + 1
  if (result.lengthCm !== undefined) {
    result.widthCm ??= result.lengthCm + 1
    result.heightCm ??= result.lengthCm + 2
  }
  if (REQUIRED.some(field => result[field] === undefined)) return null
  return result
}

/** 账单里的日期以 Excel 序列值保存；也兼容对方偶尔直接写日期的情形。 */
function toIsoDate(value: string | null): string | null {
  if (value === null) return null
  const text = value.trim()
  if (text === '') return null
  const dashed = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u)
  if (dashed) return `${dashed[1]}-${dashed[2].padStart(2, '0')}-${dashed[3].padStart(2, '0')}`
  const serial = Number(text)
  if (!Number.isFinite(serial) || serial < 1) return null
  return new Date(EXCEL_EPOCH_MS + Math.round(serial) * 86_400_000).toISOString().slice(0, 10)
}

/** 从「合计应付台币NTD」单元格公式里取汇率；带除数即账单自带汇率，不带则须知系统汇率。 */
function embeddedRate(formula: string | null): string | null {
  if (formula === null) return null
  const divisors = [...new Set([...formula.matchAll(/\/(\d+(?:\.\d+)?)/gu)].map(match => match[1]))]
  if (divisors.length !== 1) return null
  try { return formatDecimal(parseDecimal(divisors[0], 30, 12, 'rate'), 30, 12, 'rate') }
  catch { return null }
}

function text(cell: WorkbookCell | undefined, label: string, maximum: number, errors: string[]): string | null {
  const value = cell?.value?.replace(/[\r\n\t]+/gu, ' ').trim() || null
  if (value && ([...value].length > maximum || /[\p{Cc}\p{Cs}]/u.test(value))) errors.push(`${label}内容过长或含无效字符`)
  return value
}

function numeric(cell: WorkbookCell | undefined, sheet: WorkbookSheet, label: string, scale: number, precision: number, errors: string[]): string | null {
  try { return importCellNumber(cell, sheet, scale, precision, false) }
  catch { errors.push(`${label}必须为有效数值`); return null }
}

/** 尾部合计单元格可能是负数，因而直接读缓存值而不用只接受非负数的导入取数器。 */
function footerValue(cells: Map<number, WorkbookCell>, column: number | undefined, label: string, findings: SlhBillFinding[]): string | null {
  const raw = column === undefined ? null : cells.get(column)?.value ?? null
  if (raw === null || raw.trim() === '') return null
  try { return slhNormalizeAmount(raw.trim()) }
  catch { findings.push(finding('SUBTOTAL_MISMATCH', 'warning', null, `${label}无法读取数值`)); return null }
}

/** 记账口径的差异与告警都收进同一份 findings，行级视图由行号派生。 */
function finding(kind: SlhBillFindingKind, severity: 'difference' | 'warning', lineNumber: number | null, message: string, sourceRowNumber: number | null = null): SlhBillFinding {
  return { kind, severity, lineNumber, sourceRowNumber, message }
}

function parseLine(sheet: WorkbookSheet, rowNumber: number, cells: Map<number, WorkbookCell>, columns: Columns, lineNumber: number): { line: ParsedSlhBillLine, findings: SlhBillFinding[] } | null {
  const cell = (field: Field) => {
    const column = columns[field]
    return column === undefined ? undefined : cells.get(column)
  }
  const errors: string[] = [], findings: SlhBillFinding[] = []
  const batchText = text(cell('containerBatchName'), '柜号', 128, errors)
  const goodsName = text(cell('goodsName'), '货物品名', 255, errors) ?? ''
  if (!batchText || !goodsName) return null

  const loadingDate = toIsoDate(cell('loadingDate')?.value ?? null)
  if (loadingDate === null) errors.push('装柜日期无法识别')
  let packageCount = 0
  try { packageCount = importPackageCount(cell('packageCount'), sheet) }
  catch { errors.push('箱数必须为 1 至 1000000 的整数') }

  for (const [field, label] of [['lengthCm', '长'], ['widthCm', '宽'], ['heightCm', '高']] as const) {
    const places = sourceDecimalPlaces(cell(field)?.value ?? null)
    if (places > 2) findings.push(finding('DIMENSION_PRECISION', 'warning', lineNumber, `${label}在来源里保留 ${places} 位小数，已按 2 位小数取整，材积复算可能有偏差`, rowNumber))
  }

  const grossWeightKg = numeric(cell('grossWeightKg'), sheet, '出货重量', 3, 18, errors)
  const lengthCm = numeric(cell('lengthCm'), sheet, '长', 2, 18, errors)
  const widthCm = numeric(cell('widthCm'), sheet, '宽', 2, 18, errors)
  const heightCm = numeric(cell('heightCm'), sheet, '高', 2, 18, errors)
  const reportedVolumeCai = numeric(cell('reportedVolumeCai'), sheet, '材数', 2, 24, errors)
  const unitPriceAmount = numeric(cell('unitPriceAmount'), sheet, '单价', 2, 30, errors)
  const freightAmountCny = numeric(cell('freightAmountCny'), sheet, '运费', 2, 30, errors) ?? '0.00'
  const codHandlingAmountCny = numeric(cell('codHandlingAmountCny'), sheet, '代收手续费', 2, 30, errors) ?? '0.00'
  const surchargeAmountCny = numeric(cell('surchargeAmountCny'), sheet, '附加费', 2, 30, errors) ?? '0.00'
  const payableAmountCny = numeric(cell('payableAmountCny'), sheet, '合计应付金额', 2, 30, errors) ?? '0.00'
  const codAmountTwd = numeric(cell('codAmountTwd'), sheet, '代收货款', 2, 30, errors) ?? '0.00'
  const ntdSurchargeAmountTwd = numeric(cell('ntdSurchargeAmountTwd'), sheet, 'NTD 杂费', 2, 30, errors) ?? '0.00'

  const pricingBasis = deriveSlhPricingBasis(unitPriceAmount)
  const ratio = slhVolumeRatio({ lengthCm, widthCm, heightCm, packageCount })
  const volumeCai = ratio === null ? null : recordSlhVolume(ratio, pricingBasis ?? 'WEIGHT')
  if (ratio === null && pricingBasis === 'VOLUME') errors.push('按材积计价的明细缺少装箱尺寸')

  // 复算与账单缓存值逐项比对；差异只提示，不阻断入库。
  const calculatedFreight = calculateSlhFreight({ unitPriceAmount, pricingBasis, grossWeightKg, volumeCai })
  if (!slhAmountsEqual(calculatedFreight, freightAmountCny)) findings.push(finding('FREIGHT_MISMATCH', 'difference', lineNumber, `运费复算 ${calculatedFreight} 与账单 ${freightAmountCny} 不一致`, rowNumber))
  const calculatedPayable = calculateSlhPayable(calculatedFreight, codHandlingAmountCny, surchargeAmountCny)
  if (!slhAmountsEqual(calculatedPayable, payableAmountCny)) findings.push(finding('PAYABLE_MISMATCH', 'difference', lineNumber, `合计应付复算 ${calculatedPayable} 与账单 ${payableAmountCny} 不一致`, rowNumber))
  if (volumeCai !== null && reportedVolumeCai !== null && !slhVolumesEqual(volumeCai, reportedVolumeCai)) {
    findings.push(finding('VOLUME_MISMATCH', 'difference', lineNumber, `材积复算 ${volumeCai} 与账单 ${reportedVolumeCai} 不一致`, rowNumber))
  }

  const remark = text(cell('remark'), '备注', 2000, errors)
  const { charges, notes } = parseSlhRemarks(remark)
  if (charges.length > 0) {
    const chargeCny = sumSlhCharges(charges, 'CNY')
    const chargeTwd = sumSlhCharges(charges, 'TWD')
    if (!slhAmountsEqual(chargeCny, surchargeAmountCny)) findings.push(finding('CHARGE_MISMATCH', 'difference', lineNumber, `备注人民币费用合计 ${chargeCny} 与附加费 ${surchargeAmountCny} 不一致`, rowNumber))
    if (!slhAmountsEqual(chargeTwd, ntdSurchargeAmountTwd)) findings.push(finding('CHARGE_MISMATCH', 'difference', lineNumber, `备注台币费用合计 ${chargeTwd} 与 NTD 杂费 ${ntdSurchargeAmountTwd} 不一致`, rowNumber))
  }
  // 没有金额的备注片段不能成为费用行，但要让核对的人知道它被忽略了。
  for (const note of notes) findings.push(finding('REMARK_NOTE', 'warning', lineNumber, `备注片段「${note}」没有金额，未计入费用明细`, rowNumber))

  const sourceData: ParsedSlhBillLine['sourceData'] = { cells: {} }
  for (const value of cells.values()) {
    sourceData.cells[value.reference] = { value: value.value, formula: value.formula, type: value.type, sharedFormulaIndex: value.sharedFormulaIndex, mergedFrom: value.mergedFrom }
  }

  return {
    findings,
    line: {
      lineNumber, sourceSheetName: sheet.name, sourceRowNumber: rowNumber,
      loadingDate: loadingDate ?? '', containerBatchName: batchText,
      warehouseReceiptReference: text(cell('warehouseReceiptReference'), '入仓单号', 1000, errors),
      shippingMarkText: text(cell('shippingMarkText'), '嘜头', 500, errors),
      goodsName, packageCount,
      packageUnit: text(cell('packageUnit'), '箱数单位', 32, errors),
      grossWeightKg, weightUnit: text(cell('weightUnit'), '重量单位', 32, errors),
      lengthCm, widthCm, heightCm, reportedVolumeCai, volumeCai,
      categoryCode: text(cell('categoryCode'), '类别', 32, errors),
      unitPriceAmount, pricingBasis,
      freightAmountCny, codHandlingAmountCny, surchargeAmountCny, payableAmountCny,
      codAmountTwd, ntdSurchargeAmountTwd,
      recipientInfoRaw: text(cell('recipientInfoRaw'), '收货人信息', 2000, errors),
      remark, charges, errors, sourceData,
    },
  }
}

/** 解析顺联航对账单：定位表头行、读明细、读尾部合计并复算比对。 */
export async function parseSlhBillWorkbook(buffer: Buffer): Promise<ParsedSlhBill> {
  try {
    const sheets = await readContainerWorkbook(buffer)
    for (const sheet of sheets) {
      const rows = [...sheet.rows].sort(([left], [right]) => left - right)
      const headerIndex = rows.findIndex(([, cells]) => findColumns(cells) !== null)
      if (headerIndex < 0) continue
      const columns = findColumns(rows[headerIndex][1])!
      const lines: ParsedSlhBillLine[] = []
      const findings: SlhBillFinding[] = []
      const footers: Array<{ cells: Map<number, WorkbookCell>, label: string }> = []
      let closed = false
      for (const [rowNumber, cells] of rows.slice(headerIndex + 1)) {
        const label = [...cells.values()].map(value => value.value?.trim() ?? '').find(value => value !== '') ?? ''
        if (closed || FOOTER_PATTERN.test(label)) {
          closed = true
          footers.push({ cells, label })
          continue
        }
        const parsed = parseLine(sheet, rowNumber, cells, columns, lines.length + 1)
        if (parsed) {
          lines.push(parsed.line)
          findings.push(...parsed.findings)
        }
        if (lines.length > MAX_LINES) throw new SlhBillWorkbookParseError('单次最多解析 5000 条账单明细')
      }
      if (lines.length === 0) continue

      const dates = lines.map(line => line.loadingDate).filter(value => value !== '').sort()
      const codTotalAmountTwd = sumSlhAmounts(lines.map(line => line.codAmountTwd))
      const ntdSurchargeTotalAmountTwd = sumSlhAmounts(lines.map(line => line.ntdSurchargeAmountTwd))
      const totals = {
        freightTotalAmountCny: sumSlhAmounts(lines.map(line => line.freightAmountCny)),
        codHandlingTotalAmountCny: sumSlhAmounts(lines.map(line => line.codHandlingAmountCny)),
        surchargeTotalAmountCny: sumSlhAmounts(lines.map(line => line.surchargeAmountCny)),
        payableTotalAmountCny: sumSlhAmounts(lines.map(line => line.payableAmountCny)),
        codTotalAmountTwd,
        ntdSurchargeTotalAmountTwd,
        // 「合计应付台币NTD」按不折算口径：代收货款减去 NTD 杂费合计。
        reportedNetAmountTwd: sumSlhAmounts([codTotalAmountTwd, `-${ntdSurchargeTotalAmountTwd}`]),
      }

      const subtotalRow = footers.find(row => FOOTER_PATTERN.test(row.label))
      const payableRow = footers.find(row => PAYABLE_LABEL_PATTERN.test(row.label))
      const netRow = footers.find(row => NET_LABEL_PATTERN.test(row.label))
      const subtotalPayable = subtotalRow ? footerValue(subtotalRow.cells, columns.payableAmountCny, '小计应付金额', findings) : null
      const subtotalCod = subtotalRow ? footerValue(subtotalRow.cells, columns.codAmountTwd, '小计代收货款', findings) : null
      const subtotalNtd = subtotalRow ? footerValue(subtotalRow.cells, columns.ntdSurchargeAmountTwd, '小计 NTD 杂费', findings) : null
      if (subtotalPayable !== null && !slhAmountsEqual(subtotalPayable, totals.payableTotalAmountCny)) {
        findings.push(finding('SUBTOTAL_MISMATCH', 'difference', null, `账单小计应付 ${subtotalPayable} 与明细累加 ${totals.payableTotalAmountCny} 不一致`))
      }
      if (subtotalCod !== null && !slhAmountsEqual(subtotalCod, totals.codTotalAmountTwd)) {
        findings.push(finding('SUBTOTAL_MISMATCH', 'difference', null, `账单小计代收货款 ${subtotalCod} 与明细累加 ${totals.codTotalAmountTwd} 不一致`))
      }
      if (subtotalNtd !== null && !slhAmountsEqual(subtotalNtd, totals.ntdSurchargeTotalAmountTwd)) {
        findings.push(finding('SUBTOTAL_MISMATCH', 'difference', null, `账单小计 NTD 杂费 ${subtotalNtd} 与明细累加 ${totals.ntdSurchargeTotalAmountTwd} 不一致`))
      }

      const payableAmountCny = payableRow ? footerValue(payableRow.cells, columns.payableAmountCny, '合计应付人民币', findings) : null
      const netCell = netRow && columns.payableAmountCny !== undefined ? netRow.cells.get(columns.payableAmountCny) : undefined
      const netAmountTwd = netRow ? footerValue(netRow.cells, columns.payableAmountCny, '合计应付台币', findings) : null
      const rate = embeddedRate(netCell?.formula ?? null)
      // 公式带除数时该单元格是折算后的人民币金额，与不折算口径不可比，只在无除数时校验。
      if (netAmountTwd !== null && rate === null && !slhAmountsEqual(netAmountTwd, totals.reportedNetAmountTwd)) {
        findings.push(finding('NET_AMOUNT_MISMATCH', 'difference', null, `账单合计应付台币 ${netAmountTwd} 与代收货款减 NTD 杂费 ${totals.reportedNetAmountTwd} 不一致`))
      }
      if (rate === null) findings.push(finding('RATE_MISSING', 'warning', null, '账单公式未自带汇率，入库时需读取系统当前汇率或手工填写'))

      return {
        periodStart: dates[0] ?? '', periodEnd: dates[dates.length - 1] ?? '',
        containerBatchNames: [...new Set(lines.map(line => line.containerBatchName))].sort(),
        totals,
        reported: {
          subtotalPayableAmountCny: subtotalPayable,
          subtotalCodAmountTwd: subtotalCod,
          subtotalNtdSurchargeAmountTwd: subtotalNtd,
          payableAmountCny, netAmountTwd,
          netAmountFormula: netCell?.formula ?? null, embeddedForeignUnitsPerCny: rate,
        },
        lines, findings,
      }
    }
    throw new SlhBillWorkbookParseError('未找到顺联航对账单表头，请确认文件与来源一致')
  }
  catch (error) {
    if (error instanceof SlhBillWorkbookParseError) throw error
    throw new SlhBillWorkbookParseError()
  }
}
