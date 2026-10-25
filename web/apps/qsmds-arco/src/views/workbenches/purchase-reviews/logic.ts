import type { PurchaseOrderStatusCountItemDto } from '@/api/generated/types.gen'
import type { PurchaseOrderListQuery } from '@/api/modules/purchase-orders'

export type ReviewView = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export function buildReviewQuery(reviewView: ReviewView, keyword: string, page: number, pageSize: number): PurchaseOrderListQuery {
  return { view: 'all', reviewView, keyword: keyword.trim() || undefined, page, pageSize }
}

export function countReviewViews(items: readonly PurchaseOrderStatusCountItemDto[]): Record<ReviewView, number> {
  const count = (value: PurchaseOrderStatusCountItemDto['value']) => items.find(item => item.value === value)?.count ?? 0
  const rejected = count('REJECTED')
  return {
    PENDING_REVIEW: count('PENDING_REVIEW'),
    APPROVED: count('CONFIRMED') + count('COMPLETED'),
    REJECTED: rejected,
    // CANCELLED 口径包含已驳回；审核工作台的已取消页签只保留手工取消。
    CANCELLED: Math.max(0, count('CANCELLED') - rejected),
  }
}
