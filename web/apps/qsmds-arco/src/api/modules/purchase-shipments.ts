import type { AxiosInstance } from 'axios'
import type { CreateShipmentLoadGroupDto, PurchaseShipmentDeliverRequestDto, PurchaseShipmentDeliverResultDto, PurchaseShipmentDetailDto, PurchaseShipmentPageDto, PurchaseShipmentsListData, PurchaseShipmentsStatusCountsData, PurchaseShipmentStatusCountsDto, ReleaseShipmentLoadGroupDto, ShipmentLoadGroupDto } from '../generated/types.gen'
import api from '../index'

export type PurchaseShipmentListQuery = NonNullable<PurchaseShipmentsListData['query']>
export type PurchaseShipmentCountsQuery = NonNullable<PurchaseShipmentsStatusCountsData['query']>

export function createPurchaseShipmentsApi(client: AxiosInstance) {
  return {
    list: (query: PurchaseShipmentListQuery, signal: AbortSignal) => client.get<PurchaseShipmentPageDto>('purchase-order-parts', { params: query, signal, errorPresentation: 'local' }),
    statusCounts: (query: PurchaseShipmentCountsQuery, signal: AbortSignal) => client.get<PurchaseShipmentStatusCountsDto>('purchase-order-parts/status-counts', { params: query, signal, errorPresentation: 'local' }),
    getById: (partId: string, signal: AbortSignal) => client.get<PurchaseShipmentDetailDto>(`purchase-order-parts/${encodeURIComponent(partId)}`, { signal, errorPresentation: 'local' }),
    deliver: (partId: string, data: PurchaseShipmentDeliverRequestDto, signal: AbortSignal) => client.post<PurchaseShipmentDeliverResultDto>(`purchase-order-parts/${encodeURIComponent(partId)}/deliver`, data, { errorPresentation: 'local', retry: false, signal }),
    createLoadGroup: (data: CreateShipmentLoadGroupDto, signal: AbortSignal) => client.post<ShipmentLoadGroupDto>('purchase-order-parts/load-groups', data, { errorPresentation: 'local', retry: false, signal }),
    releaseLoadGroup: (groupId: string, data: ReleaseShipmentLoadGroupDto, signal: AbortSignal) => client.post<ShipmentLoadGroupDto>(`purchase-order-parts/load-groups/${encodeURIComponent(groupId)}/release`, data, { errorPresentation: 'local', retry: false, signal }),
  }
}

export default createPurchaseShipmentsApi(api)
