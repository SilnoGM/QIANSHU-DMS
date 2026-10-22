import { Prisma } from '../../generated/prisma/client'

/**
 * 装柜关联的唯一资格口径：预览候选、确认导入、单条新增/编辑与历史回填都复用这里。
 * 判定顺序按「终态优先」排列，保证同一条数据只给出一个可解释的直接原因。
 */
export const containerShipmentEligibilitySelect = {
  status: true,
  deliveredAt: true,
  loadedAt: true,
  warehouseReceivedAt: true,
  destinationWarehouseValue: true,
  containerLoadingItems: { select: { containerBatchId: true } },
} satisfies Prisma.PurchaseOrderPartSelect

export type ContainerShipmentEligibilityRow = Prisma.PurchaseOrderPartGetPayload<{
  select: typeof containerShipmentEligibilitySelect
}>

export type ContainerShipmentEligibilityCode =
  | 'CONTAINER_SHIPMENT_UNAVAILABLE'
  | 'CONTAINER_SHIPMENT_DELIVERED'
  | 'CONTAINER_SHIPMENT_ALREADY_ASSIGNED'
  | 'CONTAINER_SHIPMENT_ALREADY_LOADED'
  | 'CONTAINER_SHIPMENT_NOT_RECEIVED'
  | 'CONTAINER_SHIPMENT_WAREHOUSE_MISMATCH'

export interface ContainerShipmentEligibilityFailure {
  readonly code: ContainerShipmentEligibilityCode
  readonly message: string
  readonly status: 409 | 422
}

export function resolveContainerShipmentEligibility(
  shipment: ContainerShipmentEligibilityRow,
  batchId: string,
  warehouseValue: string,
): ContainerShipmentEligibilityFailure | null {
  if (shipment.status !== 'ACTIVE') {
    return {
      code: 'CONTAINER_SHIPMENT_UNAVAILABLE',
      message: '货件尚未生效或已取消',
      status: 422,
    }
  }
  // 签收是终态：不允许任何新增装柜关联，即使本柜已有明细也不追加。
  if (shipment.deliveredAt !== null) {
    return {
      code: 'CONTAINER_SHIPMENT_DELIVERED',
      message: '货件已签收，不能装柜',
      status: 422,
    }
  }

  const batchIds = new Set(
    shipment.containerLoadingItems.map(item => item.containerBatchId),
  )
  if ([...batchIds].some(id => id !== batchId)) {
    return {
      code: 'CONTAINER_SHIPMENT_ALREADY_ASSIGNED',
      message: '货件已分配到其他柜次，不能跨柜拆分',
      status: 409,
    }
  }
  // loadedAt 是永久事实：明细被解绑/删除后仍然保留，因此没有本柜明细时不能再进新柜次。
  if (shipment.loadedAt !== null && !batchIds.has(batchId)) {
    return {
      code: 'CONTAINER_SHIPMENT_ALREADY_LOADED',
      message: '货件已装柜，不能关联新的柜次',
      status: 409,
    }
  }
  if (shipment.warehouseReceivedAt === null) {
    return {
      code: 'CONTAINER_SHIPMENT_NOT_RECEIVED',
      message: '货件尚未到仓，不能装柜',
      status: 422,
    }
  }
  if (shipment.destinationWarehouseValue !== warehouseValue) {
    return {
      code: 'CONTAINER_SHIPMENT_WAREHOUSE_MISMATCH',
      message: '货件目的地仓库与柜次装柜仓库不一致',
      status: 422,
    }
  }
  return null
}
