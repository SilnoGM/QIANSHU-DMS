import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 日期筛选组件源码契约使用 Node.js 内置 runner。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('日期范围筛选封装选择、完成和清除交互但不承载领域查询字段', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsDateRangeFilter/index.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'QsDateRangeFilter' \}\)/u)
  assert.match(source, /defineModel<CalendarDateRangeValue>/u)
  assert.match(source, /<FaCalendarDateRange/u)
  assert.match(source, /\spicker(?:\s|>)/u)
  assert.match(source, /v-model:open="pickerOpen"/u)
  assert.match(source, /@complete="handleComplete"/u)
  assert.match(source, /#trigger="\{ disabled, label, readonly \}"/u)
  assert.match(source, /:aria-label="`打开\$\{props\.calendarLabel\}选择：\$\{label\}`"/u)
  assert.match(source, /const hasValue = computed/u)
  assert.match(source, /v-if="hasValue"/u)
  assert.match(source, /i-lucide:x/u)
  assert.match(source, /group-hover:opacity-100/u)
  assert.match(source, /group-focus-within:opacity-100/u)
  assert.match(source, /@click\.stop="clear"/u)
  assert.match(source, /modelValue\.value = \{ end: undefined, start: undefined \}/u)
  assert.match(source, /emit\('clear'\)/u)
  assert.doesNotMatch(source, /orderDateFrom|orderDateTo|@\/api\/modules/u)
})

test('日期范围筛选说明明确由业务页面处理查询副作用', () => {
  const readme = readRelativeSource(
    '../../src/components/business/QsDateRangeFilter/README.md',
  )

  assert.match(readme, /QsDateRangeFilter/u)
  assert.match(readme, /不请求 API/u)
  assert.match(readme, /complete/u)
  assert.match(readme, /clear/u)
})
