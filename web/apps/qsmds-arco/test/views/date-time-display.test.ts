import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 日期时间组件纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  DEFAULT_TIME_ZONE,
  EMPTY_DATE_TIME_TEXT,
  formatDateTime,
} from '../../src/components/base/DateTimeDisplay/format'

const FIXED_INSTANT = '2026-07-20T08:16:35.000Z'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('同一时刻可按上海、台北、吉隆坡和纽约时区显示', () => {
  assert.equal(formatDateTime(FIXED_INSTANT, 'datetime', 'Asia/Shanghai'), '2026-07-20 16:16:35')
  assert.equal(formatDateTime(FIXED_INSTANT, 'datetime', 'Asia/Taipei'), '2026-07-20 16:16:35')
  assert.equal(formatDateTime(FIXED_INSTANT, 'datetime', 'Asia/Kuala_Lumpur'), '2026-07-20 16:16:35')
  assert.equal(formatDateTime(FIXED_INSTANT, 'datetime', 'America/New_York'), '2026-07-20 04:16:35')
})

test('日期、日期时间和时间模式均使用稳定的 24 小时格式', () => {
  assert.equal(formatDateTime(FIXED_INSTANT, 'date', 'Asia/Shanghai'), '2026-07-20')
  assert.equal(formatDateTime(FIXED_INSTANT, 'datetime', 'Asia/Shanghai'), '2026-07-20 16:16:35')
  assert.equal(formatDateTime(FIXED_INSTANT, 'time', 'Asia/Shanghai'), '16:16:35')
  assert.equal(formatDateTime('2026-07-20T16:16:35+08:00', 'datetime', 'Asia/Shanghai'), '2026-07-20 16:16:35')
})

test('Date、ISO 8601 字符串与 Unix 毫秒时间戳表达同一时刻', () => {
  const timestamp = Date.parse(FIXED_INSTANT)

  assert.equal(formatDateTime(new Date(timestamp), 'datetime', 'UTC'), '2026-07-20 08:16:35')
  assert.equal(formatDateTime(FIXED_INSTANT, 'datetime', 'UTC'), '2026-07-20 08:16:35')
  assert.equal(formatDateTime(timestamp, 'datetime', 'UTC'), '2026-07-20 08:16:35')
  assert.equal(formatDateTime(1000, 'datetime', 'UTC'), '1970-01-01 00:00:01')
})

test('默认使用 Asia/Shanghai 时区', () => {
  assert.equal(DEFAULT_TIME_ZONE, 'Asia/Shanghai')
  assert.equal(formatDateTime(FIXED_INSTANT), '2026-07-20 16:16:35')
})

test('拒绝无显式时区、无效日历值、非法时区和非有限时间戳', () => {
  const invalidValues = [
    null,
    undefined,
    '',
    '2026-07-20',
    '2026-07-20 08:16:35',
    '2026-07-20T08:16:35',
    '2026-02-30T08:16:35Z',
    '2026-07-20T24:00:00Z',
    '2026-07-20T08:16:35+15:00',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date('invalid'),
  ] as const

  for (const value of invalidValues) {
    assert.equal(formatDateTime(value, 'datetime', 'Asia/Shanghai'), EMPTY_DATE_TIME_TEXT)
  }

  assert.equal(formatDateTime(FIXED_INSTANT, 'datetime', 'Mars/Olympus_Mons'), EMPTY_DATE_TIME_TEXT)
})

test('DateTimeDisplay 是带语义与无障碍信息的无业务依赖展示组件', () => {
  const source = readRelativeSource(
    '../../src/components/base/DateTimeDisplay/index.vue',
  )
  const unoConfig = readRelativeSource('../../../../uno.config.ts')
  const shortcut = unoConfig.match(/'qs-type-data': '([^']+)'/u)?.[1]

  assert.match(source, /defineOptions\(\{ name: 'DateTimeDisplay' \}\)/u)
  assert.match(source, /formatDateTime/u)
  assert.match(source, /<time/u)
  assert.match(source, /:data-time-zone="timeZone"/u)
  assert.match(source, /:data-format="format"/u)
  assert.match(source, /:aria-label="ariaLabel"/u)
  assert.match(source, /\bqs-type-data\b/u)
  assert.doesNotMatch(source, /\bfont-medium\b/u)
  assert.doesNotMatch(source, /\btracking-tight\b/u)
  assert.match(source, /whitespace-nowrap/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)

  assert.ok(shortcut)
  assert.match(shortcut, /\bfont-mono\b/u)
  assert.match(shortcut, /\[font-size:var\(--qs-type-size-sm,0\.875rem\)\]/u)
  assert.match(shortcut, /\[font-weight:var\(--qs-type-weight-regular,400\)\]/u)
  assert.match(shortcut, /\[line-height:var\(--qs-type-leading-sm,1\.25rem\)\]/u)
  assert.match(shortcut, /\btabular-nums\b/u)
})

test('日期独立页面只挂载日期展示区，并保持示例与业务依赖隔离', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/basic/date-time-display.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/basic/components/DateTimeDisplayShowcase.vue',
  )

  assert.match(pageSource, /defineOptions\(\{ name: 'ComponentLibraryDateTimeDisplay' \}\)/u)
  assert.match(pageSource, /import DateTimeDisplayShowcase from '.\/components\/DateTimeDisplayShowcase\.vue'/u)
  assert.match(pageSource, /title="日期显示"/u)
  assert.match(pageSource, /route-path="\/component-library\/basic\/date-time-display"/u)
  assert.match(pageSource, /stage-label="日期组件已展示"/u)
  assert.match(pageSource, /<DateTimeDisplayShowcase\s*\/>/u)
  assert.doesNotMatch(pageSource, /AmountDisplay|GenericTableShowcase/u)
  assert.match(showcaseSource, /<DateTimeDisplay/u)
  for (const timeZone of ['Asia/Shanghai', 'Asia/Taipei', 'Asia/Kuala_Lumpur', 'America/New_York']) {
    assert.match(showcaseSource, new RegExp(`timeZone: '${timeZone}'`, 'u'))
  }
  assert.doesNotMatch(showcaseSource, /@\/api|useApp\w*Store/u)
})
