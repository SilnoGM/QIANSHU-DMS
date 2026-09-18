import type { PurchaseShipmentListQuery } from '@/api/modules/purchase-shipments'

export const SHIPMENT_VIEWS = ['ALL', 'PENDING_REVIEW', 'AWAITING_SHIPMENT', 'SHIPPED', 'WAREHOUSE_RECEIVED', 'CONTAINER_LOADED', 'OVERSEAS_STORAGE', 'DELIVERED', 'CANCELLED'] as const
export type ShipmentView = typeof SHIPMENT_VIEWS[number]
export type ShipmentListQuery = Omit<PurchaseShipmentListQuery, 'view'> & { view?: ShipmentView }

/** 已到仓→已装柜；已装柜可签收或海外寄仓，寄仓中可签收，已签收为终态。本轮仅预留视图和按钮。 */
export function isShipmentPlaceholderView(view: ShipmentView | undefined): view is 'CONTAINER_LOADED' | 'OVERSEAS_STORAGE' | 'DELIVERED' {
  return view === 'CONTAINER_LOADED' || view === 'OVERSEAS_STORAGE' || view === 'DELIVERED'
}

export function shipmentPlaceholderAction(view: ShipmentView, status: Exclude<ShipmentView, 'ALL'>): 'loadContainer' | 'sign' | null {
  if (view === 'WAREHOUSE_RECEIVED' && status === 'WAREHOUSE_RECEIVED') {
    return 'loadContainer'
  }
  return view === 'CONTAINER_LOADED' && status === 'CONTAINER_LOADED' ? 'sign' : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function date(value: unknown): string | undefined {
  const candidate = text(value)
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) {
    return undefined
  }
  const parsed = new Date(`${candidate}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : undefined
}

/** URL 是视图及筛选真相源，切换 Tabs 重建页面时仍可恢复同一查询。 */
export function parseShipmentQuery(raw: Record<string, unknown>): ShipmentListQuery {
  const result: ShipmentListQuery = {
    view: SHIPMENT_VIEWS.includes(raw.view as ShipmentView) ? raw.view as ShipmentView : 'AWAITING_SHIPMENT',
    page: typeof raw.page === 'string' && /^[1-9]\d*$/u.test(raw.page) && Number.isSafeInteger(Number(raw.page)) ? Number(raw.page) : 1,
    pageSize: ['20', '50', '100'].includes(String(raw.pageSize)) ? Number(raw.pageSize) : 20,
  }
  const keyword = text(raw.keyword)
  const supplierValue = text(raw.supplierValue)
  const createdByUserId = text(raw.createdByUserId)
  if (keyword) {
    result.keyword = keyword
  }
  if (supplierValue && raw.supplierSource !== 'CUSTOM_TEXT') {
    result.supplierValue = supplierValue
  }
  if (createdByUserId && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(createdByUserId)) {
    result.createdByUserId = createdByUserId
  }
  if (raw.purchaseType === 'SALES_LINKED' || raw.purchaseType === 'STOCK') {
    result.purchaseType = raw.purchaseType
  }
  if (raw.supplierSource === 'DICTIONARY' || raw.supplierSource === 'CUSTOM_TEXT') {
    result.supplierSource = raw.supplierSource
  }
  const from = date(raw.orderDateFrom)
  const to = date(raw.orderDateTo)
  if (from && (!to || from <= to)) {
    result.orderDateFrom = from
  }
  if (to && (!from || from <= to)) {
    result.orderDateTo = to
  }
  return result
}

export function buildShipmentRouteQuery(query: ShipmentListQuery): Record<string, string> {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))
}

export function shipmentCountsQuery(query: ShipmentListQuery) {
  const { view: _view, page: _page, pageSize: _pageSize, sort: _sort, ...filters } = query
  return filters
}

export function formatShipmentNumber(partNumber: number): string {
  return `货件-${String(partNumber).padStart(2, '0')}`
}

export function shipmentStatusClass(status: Exclude<ShipmentView, 'ALL'>): string {
  return {
    PENDING_REVIEW: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    AWAITING_SHIPMENT: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    SHIPPED: 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    WAREHOUSE_RECEIVED: 'border-primary/35 bg-primary/10 text-primary',
    CONTAINER_LOADED: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    OVERSEAS_STORAGE: 'border-orange-500/35 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    DELIVERED: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    CANCELLED: 'border-destructive/35 bg-destructive/10 text-destructive',
  }[status]
}

/** 历史货件保留 raw value；停用和未知状态以服务端当前字典解释为准。 */
export function formatDestinationWarehouse(
  row: {
    readonly destinationWarehouseValue: string | null
    readonly destinationWarehouse: { readonly value: string, readonly label: string | null, readonly known: boolean, readonly effectiveEnabled: boolean } | null
  },
  translate: (key: string) => string,
): string {
  if (row.destinationWarehouseValue === null) {
    return translate('purchaseShipments.warehouseMissing')
  }
  const warehouse = row.destinationWarehouse
  if (!warehouse?.known) {
    return `${row.destinationWarehouseValue}（${translate('purchaseShipments.warehouseUnknown')}）`
  }
  const label = warehouse.label ?? row.destinationWarehouseValue
  return warehouse.effectiveEnabled ? label : `${label}（${translate('purchaseShipments.disabled')}）`
}
