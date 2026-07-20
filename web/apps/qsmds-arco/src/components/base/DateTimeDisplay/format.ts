export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'
export const EMPTY_DATE_TIME_TEXT = '—'

export type DateTimeDisplayFormat = 'date' | 'datetime' | 'time'
export type DateTimeDisplayValue = Date | number | string | null | undefined

const EXPLICIT_ZONE_ISO_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.\d{1,9})?)?(?<zone>Z|[+-](?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u
const SUPPORTED_FORMATS: readonly DateTimeDisplayFormat[] = ['date', 'datetime', 'time']

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function getDaysInMonth(year: number, month: number): number {
  const daysByMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return daysByMonth[month - 1] ?? 0
}

/**
 * 严格校验带显式时区的 ISO 8601 字符串。
 *
 * Date.parse 会把 2 月 30 日等非法日期自动进位，因此必须先校验日历字段；
 * 同时拒绝无 Z/offset 的字符串，避免同一输入随浏览器所在时区产生不同结果。
 */
function isExplicitZoneIsoString(value: string): boolean {
  const match = EXPLICIT_ZONE_ISO_PATTERN.exec(value)
  if (!match?.groups) {
    return false
  }

  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const day = Number(match.groups.day)
  const hour = Number(match.groups.hour)
  const minute = Number(match.groups.minute)
  const second = Number(match.groups.second ?? '0')

  if (
    month < 1
    || month > 12
    || day < 1
    || day > getDaysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    return false
  }

  if (match.groups.zone !== 'Z') {
    const offsetHour = Number(match.groups.offsetHour)
    const offsetMinute = Number(match.groups.offsetMinute)

    // IANA 当前民用时区的 UTC 偏移不超过 14 小时；14 小时时不允许额外分钟。
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return false
    }
  }

  return Number.isFinite(Date.parse(value))
}

function normalizeDateTimeValue(value: DateTimeDisplayValue): Date | undefined {
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isFinite(timestamp) ? new Date(timestamp) : undefined
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return undefined
    }

    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : undefined
  }

  if (typeof value !== 'string' || !isExplicitZoneIsoString(value)) {
    return undefined
  }

  return new Date(value)
}

/**
 * 使用 formatToParts 后手动拼接结果，保证三个展示模式始终采用固定数字宽度与 24 小时制，
 * 不把 locale 的分隔符、字段顺序或浏览器默认时区泄漏到组件输出。
 */
export function formatDateTime(
  value: DateTimeDisplayValue,
  format: DateTimeDisplayFormat = 'datetime',
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const date = normalizeDateTimeValue(value)
  if (!date || !SUPPORTED_FORMATS.includes(format) || timeZone.trim() === '') {
    return EMPTY_DATE_TIME_TEXT
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone,
      year: 'numeric',
    })
    const parts = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, part.value]),
    ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>
    const dateText = `${parts.year}-${parts.month}-${parts.day}`
    const timeText = `${parts.hour}:${parts.minute}:${parts.second}`

    if ([parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].some(part => !part)) {
      return EMPTY_DATE_TIME_TEXT
    }

    if (format === 'date') {
      return dateText
    }

    return format === 'time' ? timeText : `${dateText} ${timeText}`
  }
  catch {
    return EMPTY_DATE_TIME_TEXT
  }
}
