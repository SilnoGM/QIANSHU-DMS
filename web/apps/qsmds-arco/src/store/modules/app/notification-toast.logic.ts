export interface NotificationToastItem {
  readonly id: string
  readonly title: string
  readonly body: string
}

export type NotificationToastAlert
  = | {
    readonly kind: 'item'
    readonly key: string
    readonly item: NotificationToastItem
  }
  | {
    readonly kind: 'summary'
    readonly key: string
    readonly count: number
  }

/**
 * 同一批新消息最多逐条提示 maxItems 条，超过后收敛成一条汇总，
 * 避免扫描任务或日汇总一次弹出十几条 Toast。
 */
export function mergeNotificationToastAlerts(
  current: readonly NotificationToastAlert[],
  incoming: readonly NotificationToastItem[],
  maxItems = 2,
): NotificationToastAlert[] {
  const limit = Math.max(1, Math.trunc(maxItems))
  const items = new Map<string, NotificationToastItem>()
  let summaryCount = 0
  for (const alert of current) {
    if (alert.kind === 'summary') {
      summaryCount += alert.count
      continue
    }
    items.set(alert.item.id, alert.item)
  }
  let added = 0
  for (const item of incoming) {
    if (items.has(item.id)) {
      continue
    }
    items.set(item.id, item)
    added += 1
  }
  if (added === 0) {
    return [...current]
  }
  if (summaryCount > 0 || items.size > limit) {
    return [{
      count: summaryCount + items.size,
      key: `summary:${Date.now()}`,
      kind: 'summary',
    }]
  }
  return [...items.values()].map(item => ({
    item,
    key: `item:${item.id}`,
    kind: 'item' as const,
  }))
}
