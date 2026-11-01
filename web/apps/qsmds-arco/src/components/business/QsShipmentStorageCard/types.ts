import type { ShipmentStorageClaimRequestSummaryDto, ShipmentStorageListItemDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

/** 卡片只消费寄仓列表 DTO；页面负责权限、状态文案和操作结果。 */
export type QsShipmentStorageCardRecord = ShipmentStorageListItemDto

export interface QsShipmentStorageCardProps {
  record: QsShipmentStorageCardRecord
  currencies: readonly CurrencyDescriptor[]
  statusLabel: string
  statusClass: string
  /** null 表示当前状态允许申请调货；文案非空时按钮置灰并显示原因。 */
  applyDisabledReason?: string | null
  claimRequest?: ShipmentStorageClaimRequestSummaryDto | null
  currentUserId?: string
}
