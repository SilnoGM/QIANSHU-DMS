import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import type { PurchaseShipmentListQuery } from '@/api/modules/purchase-shipments'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'
import { formatDestinationWarehouse } from '../../workbenches/shipments/logic'

export const WAREHOUSE_ARRIVAL_VIEWS = ['SHIPPED', 'WAREHOUSE_RECEIVED'] as const
export type WarehouseArrivalView = typeof WAREHOUSE_ARRIVAL_VIEWS[number]
export type WarehouseArrivalAction = 'view' | 'woodenFrame'
const ALL_WAREHOUSES_FILTER = '__all__'
const WAREHOUSE_FILTER_PREFIX = 'warehouse:'

/** 此页面只接收两个到仓视图的公共筛选；排序由视图语义决定，不能被 URL 覆盖。 */
export function parseWarehouseArrivalQuery(raw: Record<string, unknown>): PurchaseShipmentListQuery {
  const view = raw.view === 'SHIPPED' ? 'SHIPPED' : 'WAREHOUSE_RECEIVED'
  const query: PurchaseShipmentListQuery = {
    view,
    page: typeof raw.page === 'string' && /^[1-9]\d*$/u.test(raw.page) && Number.isSafeInteger(Number(raw.page)) ? Number(raw.page) : 1,
    pageSize: ['20', '50', '100'].includes(String(raw.pageSize)) ? Number(raw.pageSize) : 20,
    sort: view === 'SHIPPED' ? 'SHIPPED_DESC' : 'WAREHOUSE_RECEIVED_DESC',
  }
  if (typeof raw.keyword === 'string' && raw.keyword.trim()) {
    query.keyword = raw.keyword.trim()
  }
  if (typeof raw.destinationWarehouseValue === 'string' && raw.destinationWarehouseValue.trim()) {
    query.destinationWarehouseValue = raw.destinationWarehouseValue
  }
  return query
}

export function buildWarehouseArrivalRouteQuery(query: PurchaseShipmentListQuery): Record<string, string> {
  const { sort: _sort, ...routeQuery } = query
  return Object.fromEntries(Object.entries(routeQuery)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => [key, String(value)]))
}

export function warehouseFilterFromQuery(query: Pick<PurchaseShipmentListQuery, 'destinationWarehouseValue'>): string {
  return query.destinationWarehouseValue !== undefined ? `${WAREHOUSE_FILTER_PREFIX}${query.destinationWarehouseValue}` : ALL_WAREHOUSES_FILTER
}

export function warehouseFilterToQuery(value: unknown): Pick<PurchaseShipmentListQuery, 'destinationWarehouseValue'> {
  return typeof value === 'string' && value.startsWith(WAREHOUSE_FILTER_PREFIX) && value.length > WAREHOUSE_FILTER_PREFIX.length
    ? { destinationWarehouseValue: value.slice(WAREHOUSE_FILTER_PREFIX.length) }
    : {}
}

export function buildWarehouseFilterOptions(
  catalog: { readonly items: readonly { readonly value: string, readonly label: string, readonly effectiveEnabled: boolean }[] } | null,
  selectedValue: string | undefined,
  translate: (key: string) => string,
): QsStatusSwitchItem[] {
  const items = catalog?.items ?? []
  const options: QsStatusSwitchItem[] = [
    { value: ALL_WAREHOUSES_FILTER, label: translate('warehouseArrivals.allWarehouses') },
    ...items.map(item => ({
      value: `${WAREHOUSE_FILTER_PREFIX}${item.value}`,
      label: item.effectiveEnabled ? item.label : `${item.label}（${translate('purchaseShipments.disabled')}）`,
    })),
  ]
  if (selectedValue !== undefined && !items.some(item => item.value === selectedValue)) {
    options.push({ value: `${WAREHOUSE_FILTER_PREFIX}${selectedValue}`, label: catalog === null ? selectedValue : `${selectedValue}（${translate('purchaseShipments.warehouseUnknown')}）` })
  }
  return options
}

export function warehouseArrivalActions(view: WarehouseArrivalView, status: PurchaseShipmentListItemDto['viewStatus']): WarehouseArrivalAction[] {
  return view === 'WAREHOUSE_RECEIVED' && status === 'WAREHOUSE_RECEIVED' ? ['view', 'woodenFrame'] : ['view']
}

export function createWarehouseArrivalColumns(view: WarehouseArrivalView, translate: (key: string) => string): QsGenericTableColumn<PurchaseShipmentListItemDto>[] {
  const columns: QsGenericTableColumn<PurchaseShipmentListItemDto>[] = [
    { id: 'shipmentNo', title: translate('purchaseShipments.shipmentNo'), accessorKey: 'shipmentNo', fixed: 'left', minWidth: 250 },
    { id: 'mark', title: translate('purchaseShipments.mark'), accessorKey: 'shippingMarkText', minWidth: 250 },
    { id: 'destinationWarehouse', title: translate('purchaseShipments.destinationWarehouse'), accessorFn: row => formatDestinationWarehouse(row, translate), minWidth: 170 },
    { id: 'products', title: translate('purchaseShipments.products'), accessorFn: row => row.lineSummary.previews.map(item => item.productName).join('、'), minWidth: 200 },
    { id: 'source', title: translate('warehouseArrivals.source'), accessorFn: row => row.salesSource?.customerName ?? translate('purchaseShipments.stockSource'), minWidth: 235 },
    { id: 'trackingNo', title: translate('factoryShipment.tracking.label'), accessorKey: 'trackingNo', minWidth: 200, copyable: true, cellClass: 'qs-type-data' },
    { id: 'shippedAt', title: translate('warehouseArrivals.shippedAt'), accessorKey: 'shippedAt', minWidth: 190, defaultVisible: view === 'SHIPPED' },
  ]
  if (view === 'WAREHOUSE_RECEIVED') {
    columns.push(
      { id: 'warehouseReceivedAt', title: translate('warehouseArrivals.receivedAt'), accessorKey: 'warehouseReceivedAt', minWidth: 190 },
      { id: 'warehouseReceivedBy', title: translate('warehouseArrivals.receivedBy'), accessorFn: row => row.warehouseReceivedBy?.displayName ?? '—', minWidth: 140 },
    )
  }
  return columns
}
