export interface NotificationQuietHours {
  readonly start: string
  readonly end: string
  readonly timezone: string
}

export interface NotificationQuietHoursSetting extends NotificationQuietHours {
  readonly enabled: boolean
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u
const DEFAULT_TIMEZONE = 'Asia/Shanghai'

/** 事件渠道未配置静默时段的默认值；关闭开关必须显式写 enabled=false。 */
export const DEFAULT_NOTIFICATION_QUIET_HOURS: NotificationQuietHoursSetting = Object.freeze({
  enabled: true,
  start: '23:00',
  end: '08:45',
  timezone: DEFAULT_TIMEZONE,
})

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

/**
 * 解析事件渠道的静默配置。
 * - enabled 缺省按开启处理，兼容旧格式。
 * - enabled=false 且未带时间时回填默认时间，方便重新开启。
 * - 开启时 start/end 必须合法。
 */
export function parseNotificationQuietHoursSetting(value: unknown): NotificationQuietHoursSetting | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    return null
  }
  const enabled = record.enabled !== false
  const start = record.start
  const end = record.end
  if (!enabled && start === undefined && end === undefined) {
    return { ...DEFAULT_NOTIFICATION_QUIET_HOURS, enabled: false }
  }
  if (typeof start !== 'string' || typeof end !== 'string') {
    return null
  }
  if (parseTime(start) === null || parseTime(end) === null) {
    return null
  }
  const timezone = typeof record.timezone === 'string' && record.timezone.length > 0
    ? record.timezone
    : DEFAULT_TIMEZONE
  return {
    enabled,
    end,
    start,
    timezone,
  }
}

/** 调度只关心“当前是否静默”；显式关闭或格式非法都返回 null。 */
export function parseNotificationQuietHours(value: unknown): NotificationQuietHours | null {
  const setting = parseNotificationQuietHoursSetting(value)
  if (setting === null || !setting.enabled) {
    return null
  }
  return { end: setting.end, start: setting.start, timezone: setting.timezone }
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
