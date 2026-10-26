import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 日期时间字段的时区、精度与边界逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import { parseDate } from '@internationalized/date'
import {
  clampTimeToBounds,
  currentDateTimeParts,
  currentDateTimeValue,
  formatDateTimeValue,
  formatDisplayValue,
  formatDraftTime,
  hourWithinTimeBounds,
  isDateOutsideBounds,
  minuteRangeForHour,
  parseDateTimeValue,
  parseDraftTime,
  resolveDateTimeBounds,
  secondRangeForMinute,
  validateDateTimeParts,
} from '../../src/components/business/QsDateTimeField/logic'

test('业务时区固定为 Asia/Shanghai，UTC 时间按上海墙钟解析', () => {
  const parts = parseDateTimeValue('2026-10-26T06:30:00.000Z', 'minute')
  assert.ok(parts)
  assert.equal(parts.date.toString(), '2026-10-26')
  assert.equal(parts.hour, 14)
  assert.equal(parts.minute, 30)
  assert.equal(parts.second, 0)

  // UTC 16:30 已经是上海次日 00:30，日期字段不能跟着浏览器时区走。
  const crossDay = currentDateTimeParts(new Date('2026-10-26T16:30:00.000Z'))
  assert.equal(crossDay.date.toString(), '2026-10-27')
  assert.equal(crossDay.hour, 0)
  assert.equal(crossDay.minute, 30)
})

test('分钟与秒精度输出规范化 UTC ISO，日期精度只输出年月日', () => {
  assert.equal(formatDateTimeValue({
    date: parseDate('2026-10-26'),
    hour: 14,
    minute: 30,
    second: 45,
    millisecond: 123,
  }, 'minute'), '2026-10-26T06:30:00.000Z')

  assert.equal(formatDateTimeValue({
    date: parseDate('2026-10-26'),
    hour: 14,
    minute: 30,
    second: 45,
    millisecond: 123,
  }, 'second'), '2026-10-26T06:30:45.123Z')

  assert.equal(formatDateTimeValue({
    date: parseDate('2026-10-26'),
    hour: 14,
    minute: 30,
    second: 45,
    millisecond: 123,
  }, 'date'), '2026-10-26')

  assert.equal(currentDateTimeValue('date', new Date('2026-10-26T16:30:00.000Z')), '2026-10-27')
  assert.equal(currentDateTimeValue('minute', new Date('2026-10-26T06:30:45.123Z')), '2026-10-26T06:30:00.000Z')
})

test('触发器展示与草稿时间按精度截断', () => {
  assert.equal(formatDisplayValue('2026-10-26T06:30:45.123Z', 'minute'), '2026-10-26 14:30')
  assert.equal(formatDisplayValue('2026-10-26T06:30:45.123Z', 'second'), '2026-10-26 14:30:45')
  assert.equal(formatDisplayValue('2026-10-26', 'date'), '2026-10-26')
  assert.equal(formatDisplayValue('', 'minute'), '')

  assert.equal(formatDraftTime({ hour: 9, minute: 5, second: 7, millisecond: 0 }, 'minute'), '09:05')
  assert.equal(formatDraftTime({ hour: 9, minute: 5, second: 7, millisecond: 0 }, 'second'), '09:05:07')
})

test('无时区、非法日历值不会进入模型', () => {
  for (const value of ['', '2026-10-26', '2026-10-26T14:30', '2026-02-30T06:30:00.000Z', 'not-a-date']) {
    assert.equal(parseDateTimeValue(value, 'minute'), null)
  }
  assert.equal(parseDateTimeValue('2026-10-26', 'date')?.date.toString(), '2026-10-26')
  assert.equal(parseDateTimeValue('2026-02-30', 'date'), null)
})

test('未来时间按上海墙钟在日期和时刻两级拦截', () => {
  // 上海 2026-10-26 14:30
  const bounds = resolveDateTimeBounds({
    disableFuture: true,
    now: new Date('2026-10-26T06:30:00.000Z'),
    precision: 'minute',
  })
  const today = parseDate('2026-10-26')
  const at = (hour: number, minute: number) => ({
    date: today,
    hour,
    minute,
    second: 0,
    millisecond: 0,
  })

  assert.equal(validateDateTimeParts(at(14, 30), bounds, 'minute'), null)
  assert.equal(validateDateTimeParts(at(14, 31), bounds, 'minute'), 'FUTURE')
  assert.equal(validateDateTimeParts({
    ...at(14, 0),
    date: parseDate('2026-10-27'),
  }, bounds, 'minute'), 'FUTURE')
  assert.equal(isDateOutsideBounds(parseDate('2026-10-27'), bounds), true)
  assert.equal(isDateOutsideBounds(parseDate('2026-10-26'), bounds), false)
})

test('最早时间限制到时分秒，最大时间区分配置上限与当前时间', () => {
  const minBounds = resolveDateTimeBounds({
    min: '2026-10-26T05:00:00.000Z',
    now: new Date('2026-10-26T06:30:00.000Z'),
    precision: 'second',
  })
  const today = parseDate('2026-10-26')
  const at = (hour: number, minute: number, second: number) => ({
    date: today,
    hour,
    minute,
    second,
    millisecond: 0,
  })

  assert.equal(validateDateTimeParts(at(12, 59, 59), minBounds, 'second'), 'BEFORE_MIN')
  assert.equal(validateDateTimeParts(at(13, 0, 0), minBounds, 'second'), null)

  const maxBounds = resolveDateTimeBounds({
    max: '2026-10-26T06:00:00.000Z',
    now: new Date('2026-10-26T06:30:00.000Z'),
    precision: 'minute',
  })
  assert.equal(validateDateTimeParts(at(14, 1, 0), maxBounds, 'minute'), 'AFTER_MAX')
  assert.equal(validateDateTimeParts(at(14, 0, 0), maxBounds, 'minute'), null)
})

test('日期精度忽略时间边界，只比较日期', () => {
  const bounds = resolveDateTimeBounds({
    disableFuture: true,
    now: new Date('2026-10-26T16:30:00.000Z'),
    precision: 'date',
  })
  const today = parseDate('2026-10-27')

  assert.equal(validateDateTimeParts({
    date: today,
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 999,
  }, bounds, 'date'), null)
  assert.equal(validateDateTimeParts({
    date: parseDate('2026-10-28'),
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, bounds, 'date'), 'FUTURE')
})

test('草稿时间解析严格拒绝越界值', () => {
  assert.deepEqual(parseDraftTime('09:05', 'minute'), { hour: 9, minute: 5, second: 0, millisecond: 0 })
  assert.deepEqual(parseDraftTime('09:05:07', 'second'), { hour: 9, minute: 5, second: 7, millisecond: 0 })
  assert.equal(parseDraftTime('24:00', 'minute'), null)
  assert.equal(parseDraftTime('09:60', 'minute'), null)
  assert.equal(parseDraftTime('09:05:60', 'second'), null)
  assert.equal(parseDraftTime('', 'minute'), null)
})

test('时间滚轮按同日边界限制小时、分钟和秒', () => {
  const minTime = { hour: 13, minute: 15, second: 20, millisecond: 0 }
  const maxTime = { hour: 15, minute: 30, second: 40, millisecond: 0 }

  assert.equal(hourWithinTimeBounds(12, minTime, maxTime), false)
  assert.equal(hourWithinTimeBounds(13, minTime, maxTime), true)
  assert.equal(hourWithinTimeBounds(15, minTime, maxTime), true)
  assert.equal(hourWithinTimeBounds(16, minTime, maxTime), false)

  assert.deepEqual(minuteRangeForHour(13, minTime, maxTime), { min: 15, max: 59 })
  assert.deepEqual(minuteRangeForHour(14, minTime, maxTime), { min: 0, max: 59 })
  assert.deepEqual(minuteRangeForHour(15, minTime, maxTime), { min: 0, max: 30 })

  assert.deepEqual(secondRangeForMinute(13, 15, minTime, maxTime), { min: 20, max: 59 })
  assert.deepEqual(secondRangeForMinute(13, 16, minTime, maxTime), { min: 0, max: 59 })
  assert.deepEqual(secondRangeForMinute(15, 30, minTime, maxTime), { min: 0, max: 40 })
})

test('换小时或分钟后草稿时间夹到边界内', () => {
  const minTime = { hour: 13, minute: 15, second: 20, millisecond: 0 }
  const maxTime = { hour: 15, minute: 30, second: 40, millisecond: 0 }

  assert.deepEqual(clampTimeToBounds({
    hour: 12,
    minute: 59,
    second: 59,
    millisecond: 0,
  }, minTime, maxTime), minTime)
  assert.deepEqual(clampTimeToBounds({
    hour: 16,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, minTime, maxTime), maxTime)
  assert.deepEqual(clampTimeToBounds({
    hour: 14,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, minTime, maxTime), { hour: 14, minute: 0, second: 0, millisecond: 0 })
})
