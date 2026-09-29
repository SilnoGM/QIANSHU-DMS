import { containerImportZip, numberCell, textCell } from './container-import.fixture'

/**
 * 自有脱敏的顺联航对账单 OOXML 样本：结构照抄真实账单（表头在第 13 行、数据行、
 * 三行尾部合计），但金额取自真实账单、收货人信息一律替换为测试文本。
 */
export interface SlhBillFixtureOptions {
  /** 覆盖数据行；用于构造与账单缓存值不一致的样本。 */
  rows?: ReadonlyArray<Record<string, string>>
  /** 覆盖「小计」行的应付金额、代收货款与 NTD 杂费。 */
  subtotal?: { payable: string, cod: string, ntd: string }
  /** 尾部「合计应付台币NTD」单元格公式；null 表示账单不自带汇率。 */
  netFormula?: string | null
  netValue?: string
}

const HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['B', '装柜日期'], ['C', '柜号'], ['D', '发货人'], ['E', '入倉單號'], ['F', '嘜頭'],
  ['G', '货物品名'], ['H', '箱数'], ['I', ''], ['J', '出货重量'], ['K', ''],
  ['L', '装箱尺寸cm'], ['M', ''], ['N', ''], ['O', '材数'], ['P', '类别'], ['Q', '单价RMB'],
  ['R', '运费\nRMB'], ['S', '代收手续费\nRMB'], ['T', '附加费RMB'], ['U', '合计应付金额RMB'],
  ['V', '代收货款\nNTD'], ['W', '偏远费\nNTD'], ['X', '备注'], ['Y', '收货人信息'],
]

/** 数据行取值：金额与尺寸与真实账单一致，仅收货人信息脱敏。 */
const ROWS: ReadonlyArray<Record<string, string>> = [
  { B: '46002', C: '1211-01柜', D: '千树贸易', E: 'WG-0078-0072', F: 'J-121125', G: '农用四轮微耕机', H: '1', I: 'CTN', K: 'KGS', R: '0', U: '0', W: '2000', X: '补 卸货费2000NT', Y: '测试收货人一' },
  { B: '46024', C: '0102-01柜', D: '千树贸易', E: 'WG-0102-0092', F: 'L-010229', G: '农用履带旋耕机', H: '1', I: 'CTN', J: '885', K: 'KGS', L: '215', M: '137', N: '113', O: '117.545380703489', P: '5', Q: '5', R: '4425', S: '30', T: '100', U: '4555', V: '129000', W: '6000', X: '重货费100 偏遠費6000NT', Y: '测试收货人二' },
  { B: '46038', C: '0116柜', D: '千树贸易', E: 'ZY202449875559（中通快运）', F: 'L-011652', G: '腳手架', H: '1', I: 'CTN', J: '213', K: 'KGS', L: '190', M: '92', N: '63', O: '39', P: '5', Q: '30', R: '1170', T: '100', U: '1270', X: '重货费100', Y: '测试收货人三' },
]

const NUMBER_COLUMNS = new Set(['B', 'H', 'J', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'])

export function slhBillRow(row: number, values: Record<string, string>): string {
  return `<row r="${row}">${Object.entries(values).map(([column, value]) => NUMBER_COLUMNS.has(column) ? numberCell(`${column}${row}`, value) : textCell(`${column}${row}`, value)).join('')}</row>`
}

export function createSlhBillFixture(options: SlhBillFixtureOptions = {}): Buffer {
  const netFormula = options.netFormula === undefined ? '=(V17-W17)/4.8' : options.netFormula
  const netValue = options.netValue ?? '25208.33'
  const rows = options.rows ?? ROWS
  const subtotal = options.subtotal ?? { payable: '5825', cod: '129000', ntd: '8000' }
  const head = [
    '<row r="1">' + textCell('B1', '顺联航国际物流有限公司（台湾专线海运）') + '</row>',
    '<row r="2">' + textCell('B2', '对 账 单') + '</row>',
    '<row r="4">' + textCell('B4', '1、下述所列代收货款仅用于核对，未入账，我司将在货款收回后入账；') + '</row>',
    // 表头之前的银行账号区属于噪声，解析必须忽略。
    '<row r="8">' + textCell('B8', '请将款项汇至我司如下账号：') + textCell('F8', '公账：') + '</row>',
    '<row r="11">' + textCell('B11', '户名:测试户名') + '</row>',
    '<row r="13">' + HEADERS.map(([column, value]) => value === '' ? '' : textCell(`${column}13`, value)).join('') + '</row>',
  ].join('')
  const body = rows.map((values, index) => slhBillRow(14 + index, values)).join('')
  const footer = [
    slhBillRow(17, { B: '小计：', U: subtotal.payable, V: subtotal.cod, W: subtotal.ntd }),
    slhBillRow(18, { B: '合计应付人民币RMB:', U: `-${subtotal.payable}` }),
    `<row r="19">${textCell('B19', '合计应付台币NTD：')}${netFormula === null ? numberCell('U19', netValue) : numberCell('U19', netValue, netFormula)}</row>`,
  ].join('')
  return containerImportZip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="待签收返款账单" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${head}${body}${footer}</sheetData><mergeCells><mergeCell ref="H13:I13"/><mergeCell ref="J13:K13"/><mergeCell ref="L13:N13"/></mergeCells></worksheet>`,
  })
}
