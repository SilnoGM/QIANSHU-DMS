import type { NotificationDeliveryDto, NotificationRecordDto } from '@/api/generated/types.gen'
import { deliveryStatusLabel } from './records.presentation'

export interface RecordDeliverySummaryItem {
  channel: 'IN_APP' | 'WECOM'
  detail: string | null
  label: string
  tone: 'danger' | 'normal' | 'warning'
}

const DELIVERY_STATUS_ORDER: readonly NotificationDeliveryDto['status'][] = [
  'FAILED',
  'EXPIRED',
  'PENDING',
  'SENDING',
  'PARTIAL',
  'CANCELLED',
  'SKIPPED',
  'ACCEPTED',
]

const DELIVERY_STATUS_RANK = new Map(
  DELIVERY_STATUS_ORDER.map((status, index) => [status, index]),
)

export function deliveryTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0)
}

export function pendingDeliveryCount(record: Pick<NotificationRecordDto, 'wecomDeliveryCounts'>): number {
  return record.wecomDeliveryCounts?.PENDING ?? 0
}

export function failedDeliveryCount(record: Pick<NotificationRecordDto, 'wecomDeliveryCounts'>): number {
  return record.wecomDeliveryCounts?.FAILED ?? 0
}

export function inAppReadCount(record: Pick<NotificationRecordDto, 'inAppItemCount' | 'inAppUnreadCount'>): number {
  return Math.max(0, record.inAppItemCount - record.inAppUnreadCount)
}

export function canCancelRecord(record: Pick<NotificationRecordDto, 'wecomDeliveryCounts' | 'status'>, canManage: boolean): boolean {
  return canManage
    && record.status === 'PENDING'
    && pendingDeliveryCount(record) > 0
}

/**
 * 表格只展示“站内多少人、企业微信多少人”以及需要立即关注的数量，
 * 完整状态分布留在详情抽屉，避免列表单元格变成状态字典。
 */
export function recordDeliverySummary(
  record: Pick<NotificationRecordDto, 'channels' | 'wecomDeliveryCounts' | 'inAppItemCount' | 'inAppUnreadCount'>,
): RecordDeliverySummaryItem[] {
  const items: RecordDeliverySummaryItem[] = []

  if (record.channels.includes('IN_APP')) {
    const unread = record.inAppUnreadCount
    items.push({
      channel: 'IN_APP',
      label: `站内 ${record.inAppItemCount} 人`,
      tone: unread > 0 ? 'warning' : 'normal',
      detail: record.inAppItemCount === 0 ? '未生成收件' : unread > 0 ? `未读 ${unread}` : null,
    })
  }

  if (record.channels.includes('WECOM')) {
    const counts = record.wecomDeliveryCounts ?? {}
    const total = deliveryTotal(counts)
    const failed = counts.FAILED ?? 0
    items.push({
      channel: 'WECOM',
      label: `企业微信 ${total} 人`,
      tone: failed > 0 ? 'danger' : 'normal',
      detail: total === 0 ? '未生成交付' : failed > 0 ? `失败 ${failed}` : null,
    })
  }

  return items
}

export function deliveryStatusEntries(
  record: Pick<NotificationRecordDto, 'wecomDeliveryCounts'>,
): Array<{ count: number, label: string, status: NotificationDeliveryDto['status'] }> {
  return DELIVERY_STATUS_ORDER
    .map(status => ({
      status,
      label: deliveryStatusLabel(status),
      count: record.wecomDeliveryCounts?.[status] ?? 0,
    }))
    .filter(item => item.count > 0)
}

/**
 * 详情优先展示失败与待处理项，便于管理员先定位异常；同一状态的原始顺序保持不变。
 */
export function sortRecordDeliveries(
  deliveries: readonly NotificationDeliveryDto[],
): NotificationDeliveryDto[] {
  return deliveries
    .map((delivery, index) => ({ delivery, index }))
    .sort((left, right) => {
      const rankDifference = (DELIVERY_STATUS_RANK.get(left.delivery.status) ?? 99)
        - (DELIVERY_STATUS_RANK.get(right.delivery.status) ?? 99)
      return rankDifference === 0 ? left.index - right.index : rankDifference
    })
    .map(item => item.delivery)
}
