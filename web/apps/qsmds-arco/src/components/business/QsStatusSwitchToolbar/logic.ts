import type { QsStatusSwitchOverflowMetrics } from './types'

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
