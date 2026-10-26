import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 日期时间字段的源码契约使用 Node.js 内置 runner。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('日期时间字段组合日历与时间滚轮，不再使用原生时间输入', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsDateTimeField/index.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'QsDateTimeField', inheritAttrs: false \}\)/u)
  assert.match(source, /defineModel<string>\(\{ required: true \}\)/u)
  assert.match(source, /<FaDate/u)
  assert.match(source, /<FaCalendarDate/u)
  assert.match(source, /<TimeWheelPanel/u)
  assert.match(source, /sticky="always"/u)
  assert.match(source, /prioritize-position/u)
  assert.match(source, /side="right"/u)
  assert.match(source, /z-3000/u)
  assert.match(source, /handleTimeTriggerClick/u)
  assert.match(source, /timeFlyoutOffset/u)
  assert.match(source, /:disable-future|disableFuture/u)
  assert.match(source, /role="dialog"/u)
  assert.match(source, /min-h-11/u)
  assert.match(source, /:aria-label="triggerAriaLabel"/u)
  assert.match(source, /v-bind="\$attrs"/u)
  assert.doesNotMatch(source, /type="time"/u)
  assert.doesNotMatch(source, /type="datetime-local"/u)
  assert.doesNotMatch(source, /--reka-popover-content-available-height/u)
  assert.doesNotMatch(source, /getLocalTimeZone/u)
})

test('时间滚轮使用三列 listbox、滚动居中和键盘选择', () => {
  const wheel = readRelativeSource(
    '../../src/components/business/QsDateTimeField/time-wheel-panel.vue',
  )

  assert.match(wheel, /role="listbox"/u)
  assert.match(wheel, /role="option"/u)
  assert.match(wheel, /aria-activedescendant/u)
  assert.match(wheel, /aria-selected/u)
  assert.match(wheel, /function scrollToIndex/u)
  assert.match(wheel, /@scroll\.passive="handleScroll/u)
  assert.match(wheel, /function handleKeydown/u)
  assert.match(wheel, /minuteRangeForHour/u)
  assert.match(wheel, /secondRangeForMinute/u)
  assert.doesNotMatch(wheel, /<input/u)
})

test('字段逻辑固定使用上海墙钟并拒绝无时区输入', () => {
  const logic = readRelativeSource(
    '../../src/components/business/QsDateTimeField/logic.ts',
  )

  assert.match(logic, /BUSINESS_TIME_ZONE = 'Asia\/Shanghai'/u)
  assert.match(logic, /ISO_WITH_ZONE_PATTERN/u)
  assert.match(logic, /toZoned\(/u)
  assert.doesNotMatch(logic, /getLocalTimeZone/u)
})

test('组件说明明确值格式、时区、精度与时间滚轮契约', () => {
  const readme = readRelativeSource(
    '../../src/components/business/QsDateTimeField/README.md',
  )

  assert.match(readme, /Asia\/Shanghai/u)
  assert.match(readme, /UTC ISO/u)
  assert.match(readme, /precision/u)
  assert.match(readme, /YYYY-MM-DD/u)
  assert.match(readme, /时间滚轮|滚动/u)
})
