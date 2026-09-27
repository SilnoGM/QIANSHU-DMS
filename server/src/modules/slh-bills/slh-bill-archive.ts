export interface SlhBillArchiveDefaults {
  billName: string
  /** 账单月份（YYYY-MM）；推导不出来时为空串，由用户在弹窗里手选。 */
  billMonth: string
}

const BILL_NAME_MAXIMUM = 200
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const FILE_MONTH_PATTERN = /(\d{1,2})\s*月/u

/** 去掉最后一个扩展名；文件名没有扩展名时原样返回。 */
function stripExtension(fileName: string): string {
  const trimmed = fileName.trim()
  const index = trimmed.lastIndexOf('.')
  return index > 0 ? trimmed.slice(0, index) : trimmed
}

function monthFromPeriodEnd(periodEnd: string): string | null {
  const match = periodEnd.trim().match(ISO_DATE_PATTERN)
  if (match === null) {
    return null
  }
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : null
}

/**
 * 从文件名兜底推导账单月份。
 *
 * 正常流程用不到：解析器已经要求账单必须带可识别的装柜日期，期间结束月一定有值。
 * 保留它是因为文件名里的「N月账单」是对方给的月份口径，若将来期间日期变得可缺失，
 * 这里是唯一还能推出月份的来源。年份只能用当下的年份，因此跨年导入会偏——这也是
 * 它只做兜底、不做首选的原因。
 */
function monthFromFileName(fileName: string, now: Date): string | null {
  const match = fileName.match(FILE_MONTH_PATTERN)
  if (match === null) {
    return null
  }
  const month = Number(match[1])
  if (month < 1 || month > 12) {
    return null
  }
  return `${now.getFullYear()}-${String(month).padStart(2, '0')}`
}

/**
 * 入库确认弹窗的默认归档信息：名称取文件名去扩展名，月份取账单期间结束月
 * （账单里已有的真值），文件名只作兜底。
 */
export function resolveSlhBillArchiveDefaults(input: {
  periodEnd: string
  sourceFileName: string
  now?: Date
}): SlhBillArchiveDefaults {
  const now = input.now ?? new Date()
  const name = stripExtension(input.sourceFileName)
  return {
    billName: name.slice(0, BILL_NAME_MAXIMUM),
    billMonth: monthFromPeriodEnd(input.periodEnd) ?? monthFromFileName(input.sourceFileName, now) ?? '',
  }
}
