import type { CalendarDate, DateValue } from '@internationalized/date'
import type {
  QsDateTimeBounds,
  QsDateTimeParts,
  QsDateTimePrecision,
  QsDateTimeValidationError,
  QsTimeParts,
} from './types'

import {
  CalendarDateTime,
  fromDate,
  parseDate,
  toCalendarDate,
  toZoned,
} from '@internationalized/date'

/**
 * 业务日期时间的唯一时区口径。服务端 businessToday、DateTimeDisplay 与所有时间输入
 * 都使用上海墙钟；浏览器本地时区不参与换算，避免同一笔数据在不同电脑上差 8 小时。
 */
export const BUSINESS_TIME_ZONE = 'Asia/Shanghai'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const ISO_WITH_ZONE_PATTERN
  = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/u

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toTimeParts(parts: QsDateTimeParts | QsTimeParts): QsTimeParts {
  return {
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: parts.millisecond,
  }
}

function compareTime(left: QsTimeParts, right: QsTimeParts): number {
  return left.hour - right.hour
    || left.minute - right.minute
    || left.second - right.second
    || left.millisecond - right.millisecond
}

function parseDateOnly(value: string): CalendarDate | null {
  if (!DATE_PATTERN.test(value)) {
    return null
  }
  try {
    const date = parseDate(value)
    return date.toString() === value ? date : null
  }
  catch {
    return null
  }
}

/** 当前时刻按上海墙钟拆成日期与时分秒；UTC 16:30 会自然落到上海次日 00:30。 */
export function currentDateTimeParts(now: Date = new Date()): QsDateTimeParts {
  const zoned = fromDate(now, BUSINESS_TIME_ZONE)
  return {
    date: toCalendarDate(zoned),
    hour: zoned.hour,
    minute: zoned.minute,
    second: zoned.second,
    millisecond: zoned.millisecond,
  }
}

export function businessToday(now: Date = new Date()): string {
  return currentDateTimeParts(now).date.toString()
}

export function currentDateTimeValue(
  precision: QsDateTimePrecision,
  now: Date = new Date(),
): string {
  return formatDateTimeValue(currentDateTimeParts(now), precision)
}

/**
 * 只接受带显式时区的 ISO 日期时间或合法日期字符串。无时区字符串会被浏览器/服务端
 * 按不同规则解释，直接拒绝，避免把本地墙钟误存成 UTC。
 */
export function parseDateTimeValue(
  value: string,
  precision: QsDateTimePrecision,
): QsDateTimeParts | null {
  if (value.trim() === '') {
    return null
  }
  if (precision === 'date') {
    const date = parseDateOnly(value)
    return date
      ? { date, hour: 0, minute: 0, second: 0, millisecond: 0 }
      : null
  }
  if (!ISO_WITH_ZONE_PATTERN.test(value)) {
    return null
  }
  const matched = value.match(ISO_WITH_ZONE_PATTERN)
  if (!matched) {
    return null
  }
  // Date 会把 2 月 30 日自动进位到 3 月 2 日，因此日历字段必须再按日期文本严格回读。
  const date = parseDateOnly(matched[1] ?? '')
  if (!date) {
    return null
  }
  const hour = Number(matched[2])
  const minute = Number(matched[3])
  const second = Number(matched[4] ?? 0)
  if (hour > 23 || minute > 59 || second > 59) {
    return null
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    return null
  }
  return currentDateTimeParts(parsed)
}

export function formatDateTimeValue(
  parts: QsDateTimeParts,
  precision: QsDateTimePrecision,
): string {
  if (precision === 'date') {
    return parts.date.toString()
  }
  const second = precision === 'second' ? parts.second : 0
  const millisecond = precision === 'second' ? parts.millisecond : 0
  return toZoned(
    new CalendarDateTime(
      parts.date.year,
      parts.date.month,
      parts.date.day,
      parts.hour,
      parts.minute,
      second,
      millisecond,
    ),
    BUSINESS_TIME_ZONE,
  ).toDate().toISOString()
}

export function formatDisplayValue(
  value: string,
  precision: QsDateTimePrecision,
): string {
  const parts = parseDateTimeValue(value, precision)
  if (!parts) {
    return ''
  }
  if (precision === 'date') {
    return parts.date.toString()
  }
  const seconds = precision === 'second' ? `:${pad2(parts.second)}` : ''
  return `${parts.date.toString()} ${pad2(parts.hour)}:${pad2(parts.minute)}${seconds}`
}

export function formatDraftTime(
  parts: QsTimeParts,
  precision: QsDateTimePrecision,
): string {
  const seconds = precision === 'second' ? `:${pad2(parts.second)}` : ''
  return `${pad2(parts.hour)}:${pad2(parts.minute)}${seconds}`
}

/** 时间滚轮可能传入空串或不完整值；空串由调用方恢复默认时间。 */
export function parseDraftTime(
  value: string,
  precision: QsDateTimePrecision,
): QsTimeParts | null {
  const matched = value.match(TIME_PATTERN)
  if (!matched) {
    return null
  }
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  const second = precision === 'second' ? Number(matched[3] ?? 0) : 0
  if (hour > 23 || minute > 59 || second > 59) {
    return null
  }
  return { hour, minute, second, millisecond: 0 }
}

export function compareTimeParts(left: QsTimeParts, right: QsTimeParts): number {
  return compareTime(left, right)
}

export function hourWithinTimeBounds(
  hour: number,
  minTime?: QsTimeParts,
  maxTime?: QsTimeParts,
): boolean {
  if (minTime && hour < minTime.hour) {
    return false
  }
  if (maxTime && hour > maxTime.hour) {
    return false
  }
  return true
}

export function minuteRangeForHour(
  hour: number,
  minTime?: QsTimeParts,
  maxTime?: QsTimeParts,
): { max: number, min: number } {
  return {
    min: minTime && hour === minTime.hour ? minTime.minute : 0,
    max: maxTime && hour === maxTime.hour ? maxTime.minute : 59,
  }
}

export function secondRangeForMinute(
  hour: number,
  minute: number,
  minTime?: QsTimeParts,
  maxTime?: QsTimeParts,
): { max: number, min: number } {
  return {
    min: minTime && hour === minTime.hour && minute === minTime.minute
      ? minTime.second
      : 0,
    max: maxTime && hour === maxTime.hour && minute === maxTime.minute
      ? maxTime.second
      : 59,
  }
}

/** 换了小时/分钟后，把分钟/秒夹到当前边界内，避免滚轮停在不可提交的组合上。 */
export function clampTimeToBounds(
  parts: QsTimeParts,
  minTime?: QsTimeParts,
  maxTime?: QsTimeParts,
): QsTimeParts {
  let { hour, minute, second } = parts
  if (
    minTime
    && compareTime({ hour, minute, second, millisecond: 0 }, minTime) < 0
  ) {
    hour = minTime.hour
    minute = minTime.minute
    second = minTime.second
  }
  if (
    maxTime
    && compareTime({ hour, minute, second, millisecond: 0 }, maxTime) > 0
  ) {
    hour = maxTime.hour
    minute = maxTime.minute
    second = maxTime.second
  }
  return { hour, minute, second, millisecond: 0 }
}

function parseBoundParts(
  value: string | undefined,
  precision: QsDateTimePrecision,
): QsDateTimeParts | null {
  if (value === undefined || value.trim() === '') {
    return null
  }
  const dateOnly = parseDateOnly(value)
  if (dateOnly) {
    return { date: dateOnly, hour: 0, minute: 0, second: 0, millisecond: 0 }
  }
  return parseDateTimeValue(value, precision === 'date' ? 'date' : 'second')
}

/**
 * 把 min/max/disableFuture 收敛成日期与时刻两级边界。disableFuture 与显式 max
 * 同时存在时取更早的一个，避免“页面说不能选未来、数据却允许”的口径分裂。
 */
export function resolveDateTimeBounds(input: {
  disableFuture?: boolean
  max?: string
  min?: string
  now?: Date
  precision: QsDateTimePrecision
}): QsDateTimeBounds {
  const nowParts = currentDateTimeParts(input.now)
  const minParts = parseBoundParts(input.min, input.precision)
  const maxParts = parseBoundParts(input.max, input.precision)
  const withTime = input.precision !== 'date'

  let maxDate = maxParts?.date
  let maxTime = withTime && maxParts ? toTimeParts(maxParts) : undefined
  let maxIsNow = false

  if (input.disableFuture) {
    if (!maxDate || nowParts.date.compare(maxDate) < 0) {
      maxDate = nowParts.date
      maxTime = withTime ? toTimeParts(nowParts) : undefined
      maxIsNow = true
    }
    else if (nowParts.date.compare(maxDate) === 0) {
      if (!withTime) {
        maxIsNow = true
      }
      else {
        const nowTime = toTimeParts(nowParts)
        if (!maxTime || compareTime(nowTime, maxTime) < 0) {
          maxTime = nowTime
          maxIsNow = true
        }
      }
    }
  }

  return {
    maxDate,
    maxIsNow,
    maxTime,
    minDate: minParts?.date,
    minTime: withTime && minParts ? toTimeParts(minParts) : undefined,
    today: nowParts.date,
  }
}

export function validateDateTimeParts(
  parts: QsDateTimeParts,
  bounds: QsDateTimeBounds,
  precision: QsDateTimePrecision,
): QsDateTimeValidationError {
  if (bounds.minDate && parts.date.compare(bounds.minDate) < 0) {
    return 'BEFORE_MIN'
  }
  if (bounds.maxDate && parts.date.compare(bounds.maxDate) > 0) {
    return bounds.maxIsNow ? 'FUTURE' : 'AFTER_MAX'
  }
  if (precision === 'date') {
    return null
  }
  if (
    bounds.minDate
    && bounds.minTime
    && parts.date.compare(bounds.minDate) === 0
    && compareTime(parts, bounds.minTime) < 0
  ) {
    return 'BEFORE_MIN'
  }
  if (
    bounds.maxDate
    && bounds.maxTime
    && parts.date.compare(bounds.maxDate) === 0
    && compareTime(parts, bounds.maxTime) > 0
  ) {
    return bounds.maxIsNow ? 'FUTURE' : 'AFTER_MAX'
  }
  return null
}

export function isDateOutsideBounds(
  date: DateValue,
  bounds: QsDateTimeBounds,
): boolean {
  const calendarDate = toCalendarDate(date)
  if (bounds.minDate && calendarDate.compare(bounds.minDate) < 0) {
    return true
  }
  if (bounds.maxDate && calendarDate.compare(bounds.maxDate) > 0) {
    return true
  }
  return false
}
