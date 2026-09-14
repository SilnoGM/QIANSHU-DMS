import type { AxiosInstance } from 'axios'
import type { PurchaseShipmentDetailDto, PurchaseShipmentPageDto, PurchaseShipmentsListData, PurchaseShipmentsStatusCountsData, PurchaseShipmentStatusCountsDto } from '../generated/types.gen'
import api from '../index'

export type PurchaseShipmentListQuery = NonNullable<PurchaseShipmentsListData['query']>
export type PurchaseShipmentCountsQuery = NonNullable<PurchaseShipmentsStatusCountsData['query']>

export function createPurchaseShipmentsApi(client: AxiosInstance) {
  return {
    list: (query: PurchaseShipmentListQuery, signal: AbortSignal) => client.get<PurchaseShipmentPageDto>('purchase-order-parts', { params: query, signal, errorPresentation: 'local' }),
    statusCounts: (query: PurchaseShipmentCountsQuery, signal: AbortSignal) => client.get<PurchaseShipmentStatusCountsDto>('purchase-order-parts/status-counts', { params: query, signal, errorPresentation: 'local' }),
    getById: (partId: string, signal: AbortSignal) => client.get<PurchaseShipmentDetailDto>(`purchase-order-parts/${encodeURIComponent(partId)}`, { signal, errorPresentation: 'local' }),
  }
}

export default createPurchaseShipmentsApi(api)
