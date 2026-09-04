import type {
  FactoryShipmentImpact,
  FactoryShipmentIntent,
  FactoryShipmentModalPurchaseOrder,
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
}

function statusPriority(status: FactoryShipmentPurchaseStatus): number {
  return status === 'ORDERED' || status === 'PREPARING' ? 0 : 1
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

function targetOrders(input: {
  readonly mode: FactoryShipmentSelectionMode
  readonly orders: readonly FactoryShipmentModalPurchaseOrder[]
  readonly selectedIds: readonly string[]
}): FactoryShipmentModalPurchaseOrder[] {
  const selected = new Set(input.selectedIds)
  return input.orders
    .filter(isPendingFactoryShipment)
    .filter(order => input.mode === 'ALL_PENDING' || selected.has(order.id))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function buildFactoryShipmentIntent(input: {
  readonly mode: FactoryShipmentSelectionMode
  readonly orders: readonly FactoryShipmentModalPurchaseOrder[]
  readonly selectedIds: readonly string[]
  readonly reason: string
}): FactoryShipmentIntent {
  const reason = input.reason.trim().normalize('NFKC')
  return {
    mode: input.mode,
    targets: targetOrders(input).map(order => ({
      purchaseOrderId: order.id,
      expectedVersion: order.version,
    })),
    reason: reason.length === 0 ? null : reason,
  }
}

export function calculateFactoryShipmentImpact(input: {
  readonly mode: FactoryShipmentSelectionMode
  readonly orders: readonly FactoryShipmentModalPurchaseOrder[]
  readonly selectedIds: readonly string[]
}): FactoryShipmentImpact {
  const pendingCount = input.orders.filter(isPendingFactoryShipment).length
  const selectedCount = targetOrders(input).length
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
