export interface NotificationQuietHours {
  readonly start: string
  readonly end: string
  readonly timezone: string
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u
const DEFAULT_TIMEZONE = 'Asia/Shanghai'

function parseTime(value: string): number | null {
  const match = value.match(TIME_PATTERN)
  if (match === null) {
    return null
  }
  return Number(match[1]) * 60 + Number(match[2])
}

function zonedParts(date: Date, timezone: string): {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
} | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone: timezone,
      year: 'numeric',
    }).formatToParts(date)
    const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(part => part.type === type)?.value)
    const result = {
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      month: get('month'),
      second: get('second'),
      year: get('year'),
    }
    return Object.values(result).every(Number.isSafeInteger) ? result : null
  }
  catch {
    return null
  }
}

function timezoneOffsetMs(date: Date, timezone: string): number | null {
  const parts = zonedParts(date, timezone)
  if (parts === null) {
    return null
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - date.getTime()
}

/** 把指定时区的墙钟时间转成 UTC 瞬时；上海无夏令时，仍按通用偏移计算。 */
function zonedDateTimeToUtc(
  parts: { readonly year: number, readonly month: number, readonly day: number, readonly hour: number, readonly minute: number },
  timezone: string,
): Date | null {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const firstOffset = timezoneOffsetMs(new Date(guess), timezone)
  if (firstOffset === null) {
    return null
  }
  const first = new Date(guess - firstOffset)
  const secondOffset = timezoneOffsetMs(first, timezone)
  return secondOffset === null ? null : new Date(guess - secondOffset)
}

/** 解析数据库中的 quiet_hours JSON；形状非法时返回 null，调用方应回退到渠道默认值。 */
export function parseNotificationQuietHours(value: unknown): NotificationQuietHours | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.start !== 'string' || typeof record.end !== 'string') {
    return null
  }
  if (parseTime(record.start) === null || parseTime(record.end) === null) {
    return null
  }
  const timezone = typeof record.timezone === 'string' && record.timezone.length > 0
    ? record.timezone
    : DEFAULT_TIMEZONE
  return { end: record.end, start: record.start, timezone }
}

export function isWithinQuietHours(now: Date, quiet: NotificationQuietHours): boolean {
  const start = parseTime(quiet.start)
  const end = parseTime(quiet.end)
  const local = zonedParts(now, quiet.timezone)
  if (start === null || end === null || local === null || start === end) {
    return false
  }
  const current = local.hour * 60 + local.minute
  return start < end
    ? current >= start && current < end
    : current >= start || current < end
}

/**
 * 返回静默窗口结束时间（即下一次可发送时间）。
 * 只在当前已处于静默窗口内时调用；跨天窗口按上海墙钟计算。
 */
export function nextQuietHoursEnd(now: Date, quiet: NotificationQuietHours): Date | null {
  const start = parseTime(quiet.start)
  const end = parseTime(quiet.end)
  const local = zonedParts(now, quiet.timezone)
  if (start === null || end === null || local === null || start === end) {
    return null
  }
  const current = local.hour * 60 + local.minute
  const overnight = start > end
  const inMorningTail = overnight && current < end
  const daysToAdd = inMorningTail ? 0 : overnight ? 1 : 0
  return zonedDateTimeToUtc({
    day: local.day + daysToAdd,
    hour: Math.floor(end / 60),
    minute: end % 60,
    month: local.month,
    year: local.year,
  }, quiet.timezone)
}
