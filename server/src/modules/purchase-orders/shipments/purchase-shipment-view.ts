import type { PurchaseOrderPartStatus } from '../../../generated/prisma/enums'
import type { PurchaseShipmentView } from './purchase-shipment.dto'

export interface PurchaseShipmentViewFacts {
  status: PurchaseOrderPartStatus
  shippedAt: Date | null
  warehouseReceivedAt: Date | null
  loadedAt: Date | null
  deliveredAt: Date | null
}

/**
 * 货件状态视图的唯一派生口径：签收优先于装柜，装柜优先于到仓，到仓优先于发货。
 * 货件列表与导入候选必须共用这里，避免两处状态文案漂移。
 */
export function resolvePurchaseShipmentViewStatus(
  row: PurchaseShipmentViewFacts,
): Exclude<PurchaseShipmentView, 'ALL'> {
  if (row.status !== 'ACTIVE') return row.status
  if (row.deliveredAt !== null) return 'DELIVERED'
  if (row.loadedAt !== null) return 'CONTAINER_LOADED'
  if (row.warehouseReceivedAt !== null) return 'WAREHOUSE_RECEIVED'
  return row.shippedAt === null ? 'AWAITING_SHIPMENT' : 'SHIPPED'
}
