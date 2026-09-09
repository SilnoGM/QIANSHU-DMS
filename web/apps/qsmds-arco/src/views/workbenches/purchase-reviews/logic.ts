import type { PurchaseOrderStatusCountItemDto } from '@/api/generated/types.gen'
import type { PurchaseOrderListQuery } from '@/api/modules/purchase-orders'

export type ReviewView = 'PENDING_REVIEW' | 'APPROVED' | 'CANCELLED'

export function buildReviewQuery(reviewView: ReviewView, keyword: string, page: number, pageSize: number): PurchaseOrderListQuery {
  return { view: 'all', reviewView, keyword: keyword.trim() || undefined, page, pageSize }
}

export function countReviewViews(items: readonly PurchaseOrderStatusCountItemDto[]): Record<ReviewView, number> {
  const count = (value: PurchaseOrderStatusCountItemDto['value']) => items.find(item => item.value === value)?.count ?? 0
  return { PENDING_REVIEW: count('PENDING_REVIEW'), APPROVED: count('CONFIRMED') + count('COMPLETED'), CANCELLED: count('CANCELLED') }
}
