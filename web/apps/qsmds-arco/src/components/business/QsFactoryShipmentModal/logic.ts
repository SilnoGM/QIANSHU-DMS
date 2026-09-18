import type {
  FactoryShipmentImpact,
  FactoryShipmentIntent,
  FactoryShipmentModalPurchaseOrder,
  FactoryShipmentPart,
  FactoryShipmentPurchaseStatus,
  FactoryShipmentSelectionMode,
} from './types'

export interface FactoryShipmentStatusMeta {
  readonly className: string
  readonly label: string
}

const statusMeta: Record<FactoryShipmentPurchaseStatus, FactoryShipmentStatusMeta> = {
  ORDERED: {
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    label: '已下单',
  },
  PREPARING: {
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    label: '备货中',
  },
  PARTIALLY_SHIPPED: {
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    label: '部分发货',
  },
  SHIPPED: {
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    label: '已发货',
  },
  SIGNED: {
    className: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
    label: '已签收',
  },
}

export function isPendingFactoryShipment(
  order: FactoryShipmentModalPurchaseOrder,
): boolean {
  return order.fulfillmentStatus === 'ORDERED'
    || order.fulfillmentStatus === 'PREPARING'
    || order.fulfillmentStatus === 'PARTIALLY_SHIPPED'
}

function statusPriority(status: FactoryShipmentPurchaseStatus): number {
  return status === 'ORDERED' || status === 'PREPARING' || status === 'PARTIALLY_SHIPPED' ? 0 : 1
}

export function sortFactoryShipmentOrders(
  orders: readonly FactoryShipmentModalPurchaseOrder[],
): FactoryShipmentModalPurchaseOrder[] {
  return [...orders].sort((left, right) => (
    statusPriority(left.fulfillmentStatus) - statusPriority(right.fulfillmentStatus)
    || left.orderDate.localeCompare(right.orderDate)
    || left.orderNo.localeCompare(right.orderNo)
    || left.id.localeCompare(right.id)
  ))
}

export function isPendingShipmentPart(part: FactoryShipmentPart): boolean {
  return part.status === 'ACTIVE' && part.shippedAt === null
}

export function defaultShipmentSelection(orders: readonly FactoryShipmentModalPurchaseOrder[]): string[] {
  const parts = orders.flatMap(order => isPendingFactoryShipment(order) ? order.parts.filter(isPendingShipmentPart) : [])
  return parts.length === 1 ? [parts[0]!.id] : []
}

function shipmentTargets(input: {
  readonly mode: FactoryShipmentSelectionMode
  readonly orders: readonly FactoryShipmentModalPurchaseOrder[]
  readonly selectedIds: readonly string[]
}): Omit<FactoryShipmentIntent['targets'][number], 'destinationWarehouses'>[] {
  const selected = new Set(input.selectedIds)
  return input.orders.filter(isPendingFactoryShipment)
    .map(order => ({
      purchaseOrderId: order.id,
      expectedVersion: order.version,
      partIds: order.parts.filter(isPendingShipmentPart)
        .filter(part => input.mode === 'ALL_PENDING' || selected.has(part.id))
        .map(part => part.id)
        .sort(),
    }))
    .filter(target => target.partIds.length > 0)
    .sort((left, right) => left.purchaseOrderId.localeCompare(right.purchaseOrderId))
}

export function buildFactoryShipmentIntent(input: {
  readonly mode: FactoryShipmentSelectionMode
  readonly orders: readonly FactoryShipmentModalPurchaseOrder[]
  readonly selectedIds: readonly string[]
  readonly reason: string
  readonly trackingNumbersByPart?: Readonly<Record<string, string>>
  readonly destinationWarehousesByPart: Readonly<Record<string, string | null>>
}): FactoryShipmentIntent {
  const reason = input.reason.trim().normalize('NFKC')
  return {
    mode: input.mode,
    targets: shipmentTargets(input).map((target) => {
      // 草稿随勾选保留，只提交本次实际发出的货件，避免附带已取消选择的物流信息。
      const trackingNumbers = target.partIds.flatMap((partId) => {
        const value = input.trackingNumbersByPart?.[partId] ?? ''
        const error = validateShipmentTrackingNo(value)
        if (error) {
          throw new Error(error)
        }
        const trackingNo = value.trim()
        return trackingNo ? [{ partId, trackingNo }] : []
      })
      const destinationWarehouses = target.partIds.map((partId) => {
        const warehouseValue = input.destinationWarehousesByPart[partId]
        if (warehouseValue === null || warehouseValue === undefined || warehouseValue.length === 0) {
          throw new Error('warehouseRequired')
        }
        return { partId, warehouseValue }
      })
      return trackingNumbers.length ? { ...target, destinationWarehouses, trackingNumbers } : { ...target, destinationWarehouses }
    }),
    reason: reason.length === 0 ? null : reason,
  }
}

export function validateDestinationWarehouse(
  value: string | null | undefined,
  selectableValues: readonly string[],
): 'required' | 'unavailable' | null {
  if (value === null || value === undefined || value.length === 0) {
    return 'required'
  }
  return selectableValues.includes(value) ? null : 'unavailable'
}

export function validateShipmentTrackingNo(value: string): 'tooLong' | 'controlCharacters' | null {
  if (/\p{Cc}/u.test(value)) {
    return 'controlCharacters'
  }
  return [...value.trim()].length > 100 ? 'tooLong' : null
}

export function calculateFactoryShipmentImpact(input: {
  readonly mode: FactoryShipmentSelectionMode
  readonly orders: readonly FactoryShipmentModalPurchaseOrder[]
  readonly selectedIds: readonly string[]
}): FactoryShipmentImpact {
  const pendingCount = input.orders.filter(isPendingFactoryShipment).flatMap(order => order.parts.filter(isPendingShipmentPart)).length
  const selectedCount = shipmentTargets(input).reduce((sum, target) => sum + target.partIds.length, 0)
  const remainingCount = Math.max(0, pendingCount - selectedCount)
  return {
    selectedCount,
    remainingCount,
    willAdvanceSalesOrder: pendingCount > 0 && remainingCount === 0,
  }
}

export function getPurchaseShipmentStatusMeta(
  status: FactoryShipmentPurchaseStatus,
): FactoryShipmentStatusMeta {
  return statusMeta[status]
}
