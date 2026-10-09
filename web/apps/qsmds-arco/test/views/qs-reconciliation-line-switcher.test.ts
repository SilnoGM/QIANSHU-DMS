import type { QsReconciliationLineSwitcherTone } from '../../src/components/business/QsReconciliationLineSwitcher/types'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑与三语键对齐使用 Node.js 内置 runner 验证。
import test from 'node:test'
import {
  buildLineSwitcherWindow,
  LINE_SWITCHER_DEFAULT_SIDE_COUNT,
  LINE_SWITCHER_TONE_BAR_CLASSES,
  resolveLineSwitcherSideCount,
  resolveLineSwitcherStep,
  resolveLineSwitcherTone,
} from '../../src/components/business/QsReconciliationLineSwitcher/logic'
import en from '../../src/locales/lang/qs-reconciliation-line-switcher/en.json'
import zhCn from '../../src/locales/lang/qs-reconciliation-line-switcher/zh-cn.json'
import zhTw from '../../src/locales/lang/qs-reconciliation-line-switcher/zh-tw.json'

test('折叠条带窗口贴边铺满真实项，首尾不补空槽位', () => {
  assert.deepEqual(buildLineSwitcherWindow(12, 6, 3), [3, 4, 5, 6, 7, 8, 9])
  // 选中首项：窗口贴左边，选中项落在条带最左槽而不是正中。
  assert.deepEqual(buildLineSwitcherWindow(12, 0, 3), [0, 1, 2, 3, 4, 5, 6])
  // 选中末项：窗口贴右边。
  assert.deepEqual(buildLineSwitcherWindow(12, 11, 3), [5, 6, 7, 8, 9, 10, 11])
  // 窗口长度随每侧项数变化，但始终不超过数组长度。
  assert.deepEqual(buildLineSwitcherWindow(12, 11, 1), [9, 10, 11])
  assert.deepEqual(buildLineSwitcherWindow(5, 2, 3), [0, 1, 2, 3, 4])
})

test('折叠条带窗口对空数组与无选中位置给出稳定结果', () => {
  assert.deepEqual(buildLineSwitcherWindow(0, -1, 3), [])
  assert.deepEqual(buildLineSwitcherWindow(0, 0, 3), [])
  // 无选中（v-model 为 null）时平铺前 7 项，模板不放大任何一项。
  assert.deepEqual(buildLineSwitcherWindow(12, -1, 3), [0, 1, 2, 3, 4, 5, 6])
})

test('每侧可见项数非法时回落默认值，合法零值保留', () => {
  assert.equal(resolveLineSwitcherSideCount(undefined), LINE_SWITCHER_DEFAULT_SIDE_COUNT)
  assert.equal(resolveLineSwitcherSideCount(Number.NaN), LINE_SWITCHER_DEFAULT_SIDE_COUNT)
  assert.equal(resolveLineSwitcherSideCount(Number.POSITIVE_INFINITY), LINE_SWITCHER_DEFAULT_SIDE_COUNT)
  assert.equal(resolveLineSwitcherSideCount(-1), LINE_SWITCHER_DEFAULT_SIDE_COUNT)
  assert.equal(resolveLineSwitcherSideCount(2.7), 2)
  assert.equal(resolveLineSwitcherSideCount(0), 0)
  assert.deepEqual(buildLineSwitcherWindow(12, 5, 0), [5])
  assert.deepEqual(buildLineSwitcherWindow(12, 5, 2.7), [3, 4, 5, 6, 7])
})

test('上一条与下一条到数组首尾即停，不做循环', () => {
  assert.equal(resolveLineSwitcherStep(0, 12, -1), null)
  assert.equal(resolveLineSwitcherStep(11, 12, 1), null)
  assert.equal(resolveLineSwitcherStep(5, 12, 1), 6)
  assert.equal(resolveLineSwitcherStep(5, 12, -1), 4)
  // 无选中位置或空数组时不产生新位置，由页面负责校正模型值。
  assert.equal(resolveLineSwitcherStep(-1, 12, 1), null)
  assert.equal(resolveLineSwitcherStep(0, 0, 1), null)
})

test('状态色映射只认调用方传入的 statusTones，未登记状态回落 neutral', () => {
  const tones = { 未核对: 'danger', 已核对: 'success' } as const
  assert.equal(resolveLineSwitcherTone('未核对', tones), 'danger')
  assert.equal(resolveLineSwitcherTone('已核对', tones), 'success')
  // 组件不硬编码任何状态字面量：换一套取值同样成立，未登记的一律中性。
  assert.equal(resolveLineSwitcherTone('待确认', tones), 'neutral')
  assert.equal(resolveLineSwitcherTone('未核对', {}), 'neutral')
})

test('全部 tone 都有底部横条样式，避免新增语义时静默丢色', () => {
  const tones: readonly QsReconciliationLineSwitcherTone[] = ['danger', 'success', 'warning', 'neutral']
  for (const tone of tones) {
    assert.equal(typeof LINE_SWITCHER_TONE_BAR_CLASSES[tone], 'string')
    assert.notEqual(LINE_SWITCHER_TONE_BAR_CLASSES[tone].trim(), '')
  }
  assert.deepEqual([...Object.keys(LINE_SWITCHER_TONE_BAR_CLASSES)].sort(), [...tones].sort())
})

function collectKeys(source: Record<string, unknown>): string[] {
  return Object.entries(source).flatMap(([key, value]) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? collectKeys(value as Record<string, unknown>).map(child => `${key}.${child}`)
      : [key]
  )).sort()
}

test('对账明细行切换组件三语文案键完全对齐', () => {
  const reference = collectKeys(zhCn as unknown as Record<string, unknown>)
  assert.deepEqual(collectKeys(zhTw as unknown as Record<string, unknown>), reference)
  assert.deepEqual(collectKeys(en as unknown as Record<string, unknown>), reference)
  // 文案必须落到同一个命名空间，防止后续新增键被悄悄放到别处。
  assert.deepEqual(reference, [
    'qsReconciliationLineSwitcher.ariaLabel',
    'qsReconciliationLineSwitcher.collapse',
    'qsReconciliationLineSwitcher.empty',
    'qsReconciliationLineSwitcher.expand',
    'qsReconciliationLineSwitcher.itemAriaLabel',
    'qsReconciliationLineSwitcher.next',
    'qsReconciliationLineSwitcher.previous',
  ])
})
