import type { QsStatusSwitchItem, QsStatusSwitchOverflowMetrics } from './types'

export interface QsStatusSwitchCount {
  readonly value: string
  readonly count: number
}

export interface QsStatusSwitchCountCalibration {
  readonly selectedValue?: string
  readonly selectedCount?: number
}

/**
 * 计数只按稳定 value 合并，不改变标签、禁用态或项目顺序。接口暂缺某个分组时显式补 0；
 * 当前已完成的列表请求可以用 total 校准选中项，避免计数与可见结果短暂不一致。
 */
export function withStatusSwitchCounts(
  items: readonly QsStatusSwitchItem[],
  counts: readonly QsStatusSwitchCount[],
  calibration: QsStatusSwitchCountCalibration = {},
): readonly QsStatusSwitchItem[] {
  const countByValue = new Map(counts.map(item => [item.value, item.count] as const))
  return items.map(item => ({
    ...item,
    count: calibration.selectedValue === item.value
      && calibration.selectedCount !== undefined
      ? calibration.selectedCount
      : countByValue.get(item.value) ?? 0,
  }))
}

/** 浏览器在缩放场景下可能返回小数滚动距离，保留 1px 容差避免按钮闪烁。 */
const OVERFLOW_EPSILON = 1

export function hasStatusSwitchRightOverflow(
  metrics: QsStatusSwitchOverflowMetrics,
): boolean {
  const maxScrollLeft = Math.max(metrics.scrollWidth - metrics.clientWidth, 0)
  return maxScrollLeft - Math.max(metrics.scrollLeft, 0) > OVERFLOW_EPSILON
}

export function getStatusSwitchScrollTarget(
  metrics: QsStatusSwitchOverflowMetrics,
): number {
  const clientWidth = Math.max(metrics.clientWidth, 0)
  const maxScrollLeft = Math.max(metrics.scrollWidth - clientWidth, 0)
  const step = Math.max(Math.floor(clientWidth * 0.6), 120)

  return Math.min(Math.max(metrics.scrollLeft, 0) + step, maxScrollLeft)
}
