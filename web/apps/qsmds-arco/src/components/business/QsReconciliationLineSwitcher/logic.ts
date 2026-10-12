import type { QsReconciliationLineSwitcherTone } from './types'

/** 每侧默认可见的相邻项数量；折叠条带槽位数恒为 `2 * sideCount + 1`。 */
export const LINE_SWITCHER_DEFAULT_SIDE_COUNT = 3

/**
 * 状态语义色 → 底部横条样式。取色与账单域既有口径一致：
 * 未核对红（destructive）、已核对绿（emerald）、未登记的中性灰。
 */
export const LINE_SWITCHER_TONE_BAR_CLASSES: Readonly<Record<QsReconciliationLineSwitcherTone, string>> = {
  danger: 'bg-destructive',
  success: 'bg-emerald-500 dark:bg-emerald-400',
  warning: 'bg-amber-500 dark:bg-amber-400',
  neutral: 'bg-muted-foreground',
}

/**
 * 归一化每侧可见项数：非有限值或负数一律回落默认值，小数向下取整。
 * 0 是合法值（条带只显示选中项），保留而不回落。
 */
export function resolveLineSwitcherSideCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return LINE_SWITCHER_DEFAULT_SIDE_COUNT
  }
  const normalized = Math.floor(value)
  return normalized < 0 ? LINE_SWITCHER_DEFAULT_SIDE_COUNT : normalized
}

/**
 * 折叠条带要渲染的下标窗口：贴边铺满 `2 * sideCount + 1` 个真实项，不做空槽占位，
 * 因此首尾处选中项会随窗口移动到条带两端。数组项数不足时返回全部下标。
 * `selectedIndex < 0`（模型值为 null）时窗口从 0 开始，模板不放大任何一项。
 */
export function buildLineSwitcherWindow(
  itemCount: number,
  selectedIndex: number,
  sideCount: number,
): readonly number[] {
  if (itemCount <= 0) {
    return []
  }
  const normalizedSideCount = resolveLineSwitcherSideCount(sideCount)
  const slotCount = normalizedSideCount * 2 + 1
  const anchor = selectedIndex < 0 ? normalizedSideCount : selectedIndex
  const start = Math.min(
    Math.max(anchor - normalizedSideCount, 0),
    Math.max(itemCount - slotCount, 0),
  )
  const length = Math.min(slotCount, itemCount)
  return Array.from({ length }, (_, offset) => start + offset)
}

/**
 * 上一条 / 下一条的步进结果：到数组首尾返回 null，按钮据此禁用，不做循环。
 * 无选中位置或空数组时同样返回 null，初始选中由页面负责。
 */
export function resolveLineSwitcherStep(
  selectedIndex: number,
  itemCount: number,
  delta: -1 | 1,
): number | null {
  if (selectedIndex < 0 || itemCount <= 0) {
    return null
  }
  const next = selectedIndex + delta
  return next < 0 || next >= itemCount ? null : next
}

/** 状态取值 → tone：调用方未登记的状态一律回落中性灰。 */
export function resolveLineSwitcherTone(
  status: string,
  tones: Readonly<Record<string, QsReconciliationLineSwitcherTone>>,
): QsReconciliationLineSwitcherTone {
  return tones[status] ?? 'neutral'
}
