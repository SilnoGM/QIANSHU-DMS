import type { AxiosInstance } from 'axios'
import type {
  ClaimShipmentStorageRequestDto,
  RejectShipmentStorageClaimRequestDto,
  ReleaseShipmentStorageRequestDto,
  RelocateShipmentStorageRequestDto,
  ShipmentStorageClaimRequestDto,
  ShipmentStorageDetailDto,
  ShipmentStorageListData,
  ShipmentStoragePageDto,
  ShipmentStorageStatusCountsDto,
} from '../generated/types.gen'
import api from '../index'

export type ShipmentStorageListQuery = NonNullable<ShipmentStorageListData['query']>

/** 释放与位置移动禁止自动重试；未知结果由用户复用原请求键确认。 */
export function createShipmentStorageApi(client: AxiosInstance) {
  const path = (id: string) => `shipment-storage/${encodeURIComponent(id)}`
  return {
    list: (query: ShipmentStorageListQuery, signal: AbortSignal) =>
      client.get<ShipmentStoragePageDto>('shipment-storage', { errorPresentation: 'local', params: query, signal }),
    statusCounts: (query: ShipmentStorageListQuery, signal: AbortSignal) =>
      client.get<ShipmentStorageStatusCountsDto>('shipment-storage/status-counts', { errorPresentation: 'local', params: query, signal }),
    detail: (id: string, signal: AbortSignal) =>
      client.get<ShipmentStorageDetailDto>(path(id), { errorPresentation: 'local', signal }),
    release: (data: ReleaseShipmentStorageRequestDto, signal: AbortSignal) =>
      client.post<ShipmentStorageDetailDto[]>('shipment-storage/releases', data, { errorPresentation: 'local', retry: false, signal }),
    relocate: (id: string, data: RelocateShipmentStorageRequestDto, signal: AbortSignal) =>
      client.post<ShipmentStorageDetailDto>(`${path(id)}/location`, data, { errorPresentation: 'local', retry: false, signal }),
    claim: (id: string, data: ClaimShipmentStorageRequestDto, signal: AbortSignal) =>
      client.post<ShipmentStorageDetailDto>(`${path(id)}/claim`, data, { errorPresentation: 'local', retry: false, signal }),
    claimRequest: (id: string, requestId: string, signal: AbortSignal) =>
      client.get<ShipmentStorageClaimRequestDto>(`${path(id)}/claim-requests/${encodeURIComponent(requestId)}`, { errorPresentation: 'local', signal }),
    createClaimRequest: (id: string, data: ClaimShipmentStorageRequestDto, signal: AbortSignal) =>
      client.post<ShipmentStorageClaimRequestDto>(`${path(id)}/claim-requests`, data, { errorPresentation: 'local', retry: false, signal }),
    // 无业务入参也要发送空 JSON 对象：Axios 对 undefined 不设 Content-Type，会被 CSRF 守卫拒绝。
    withdrawClaimRequest: (id: string, requestId: string, signal: AbortSignal) =>
      client.post<ShipmentStorageClaimRequestDto>(`${path(id)}/claim-requests/${encodeURIComponent(requestId)}/withdraw`, {}, { errorPresentation: 'local', retry: false, signal }),
    approveClaimRequest: (id: string, requestId: string, signal: AbortSignal) =>
      client.post<ShipmentStorageDetailDto>(`${path(id)}/claim-requests/${encodeURIComponent(requestId)}/approve`, {}, { errorPresentation: 'local', retry: false, signal }),
    rejectClaimRequest: (id: string, requestId: string, data: RejectShipmentStorageClaimRequestDto, signal: AbortSignal) =>
      client.post<ShipmentStorageClaimRequestDto>(`${path(id)}/claim-requests/${encodeURIComponent(requestId)}/reject`, data, { errorPresentation: 'local', retry: false, signal }),
  }
}

export default createShipmentStorageApi(api)
