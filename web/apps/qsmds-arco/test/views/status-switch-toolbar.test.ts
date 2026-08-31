import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑与展示隔离契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  getStatusSwitchScrollTarget,
  hasStatusSwitchRightOverflow,
  withStatusSwitchCounts,
} from '../../src/components/business/QsStatusSwitchToolbar/logic'

test('状态计数按稳定 value 合并，缺失值归零并保留原项目属性', () => {
  assert.deepEqual(withStatusSwitchCounts([
    { label: '全部订单', value: 'ALL' },
    { disabled: true, label: '已确认', value: 'CONFIRMED' },
    { count: 99, label: '已完成', value: 'COMPLETED' },
  ], [
    { count: 8, value: 'ALL' },
    { count: 0, value: 'CONFIRMED' },
  ]), [
    { count: 8, label: '全部订单', value: 'ALL' },
    { count: 0, disabled: true, label: '已确认', value: 'CONFIRMED' },
    { count: 0, label: '已完成', value: 'COMPLETED' },
  ])
})

test('状态切换工具栏只在视口右侧仍有隐藏内容时显示浏览入口', () => {
  assert.equal(hasStatusSwitchRightOverflow({
    clientWidth: 600,
    scrollLeft: 0,
    scrollWidth: 600,
  }), false)
  assert.equal(hasStatusSwitchRightOverflow({
    clientWidth: 600,
    scrollLeft: 0,
    scrollWidth: 900,
  }), true)
  assert.equal(hasStatusSwitchRightOverflow({
    clientWidth: 600,
    scrollLeft: 299.5,
    scrollWidth: 900,
  }), false)
})

test('状态切换工具栏按视口比例向右浏览并且不会超过最大滚动距离', () => {
  assert.equal(getStatusSwitchScrollTarget({
    clientWidth: 100,
    scrollLeft: 0,
    scrollWidth: 500,
  }), 120)
  assert.equal(getStatusSwitchScrollTarget({
    clientWidth: 500,
    scrollLeft: 100,
    scrollWidth: 1000,
  }), 400)
  assert.equal(getStatusSwitchScrollTarget({
    clientWidth: 500,
    scrollLeft: 480,
    scrollWidth: 1000,
  }), 500)
})

test('状态切换工具栏组件保持受控模型、可访问按钮与自动溢出职责', async () => {
  const source = await readFile(
    new URL('../../src/components/business/QsStatusSwitchToolbar/index.vue', import.meta.url),
    'utf8',
  )

  assert.match(source, /defineOptions\(\{ name: 'QsStatusSwitchToolbar' \}\)/u)
  assert.match(source, /defineModel<string>\(\{ required: true \}\)/u)
  assert.match(source, /useResizeObserver/u)
  assert.match(source, /aria-pressed/u)
  assert.match(source, /:disabled="item\.disabled"/u)
  assert.match(source, /i-lucide:chevron-right/u)
  assert.match(source, /rounded-\[2px\] bg-primary h-1 w-5 bottom-0 left-1\/2 absolute -translate-x-1\/2/u)
  assert.match(source, /box-shadow: 0 0 0 1px oklch\(var\(--background\)\)/u)
  assert.match(source, /prefers-reduced-motion/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|useRoute/u)
})

test('状态切换工具栏 Showcase 使用本地状态覆盖计数、禁用和窄屏溢出场景', async () => {
  const source = await readFile(
    new URL(
      '../../src/views/component_library/business/components/StatusSwitchToolbarShowcase.vue',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(source, /<QsStatusSwitchToolbar/u)
  assert.match(source, /全部待办/u)
  assert.match(source, /待采购/u)
  assert.match(source, /已完成/u)
  assert.match(source, /disabled: true/u)
  assert.doesNotMatch(source, /NO_COUNT|无计数状态/u)
  assert.match(source, /class="max-w-\[390px\]"/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|useRoute/u)
})
