import type {
  NumberingDateFormat,
  NumberingResetPolicy,
} from './rule-types'

export const NUMBERING_TIMEZONE = 'Asia/Shanghai' as const

export interface ShanghaiDateParts {
  readonly year: string
  readonly month: string
  readonly day: string
}

const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat(
  'en-US-u-ca-gregory-nu-latn',
  {
    timeZone: NUMBERING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  },
)

/**
 * 函数只消费调用方传入的数据库事务时间，不读取 Date.now()。Intl 明确指定
 * IANA 时区、Gregorian calendar 和 Latin digits，避免 Node 进程本地时区或
 * locale 改变 period key。
 */
export function getShanghaiDateParts(databaseTime: Date): ShanghaiDateParts {
  if (!(databaseTime instanceof Date) || Number.isNaN(databaseTime.getTime())) {
    throw new RangeError('数据库时间必须是有效的 Date')
  }

  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(databaseTime)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError('无法提取上海时区日期')
  }

  return {
    year: year.padStart(4, '0'),
    month,
    day,
  }
}

export function getNumberingPeriodKey(
  resetPolicy: NumberingResetPolicy,
  databaseTime: Date,
): string {
  if (resetPolicy === 'NEVER') {
    // NEVER 也要求显式传入数据库时间，使上层保持统一函数签名和时钟来源。
    getShanghaiDateParts(databaseTime)
    return 'ALL'
  }

  const { year, month, day } = getShanghaiDateParts(databaseTime)

  switch (resetPolicy) {
    case 'YEARLY':
      return year
    case 'MONTHLY':
      return `${year}${month}`
    case 'DAILY':
      return `${year}${month}${day}`
  }
}

export function renderNumberingDate(
  format: NumberingDateFormat,
  databaseTime: Date,
): string {
  const { year, month, day } = getShanghaiDateParts(databaseTime)

  switch (format) {
    case 'YYYY':
      return year
    case 'YY':
      return year.slice(-2)
    case 'MM':
      return month
    case 'DD':
      return day
    case 'YYYYMM':
      return `${year}${month}`
    case 'YYYYMMDD':
      return `${year}${month}${day}`
    case 'YYMMDD':
      return `${year.slice(-2)}${month}${day}`
  }
}
