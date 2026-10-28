import type { AxiosInstance } from 'axios'
import type {
  ReleaseShipmentStorageRequestDto,
  RelocateShipmentStorageRequestDto,
  ShipmentStorageDetailDto,
  ShipmentStorageListData,
  ShipmentStoragePageDto,
} from '../generated/types.gen'
import api from '../index'

export type ShipmentStorageListQuery = NonNullable<ShipmentStorageListData['query']>

/** 释放与位置移动禁止自动重试；未知结果由用户复用原请求键确认。 */
export function createShipmentStorageApi(client: AxiosInstance) {
  const path = (id: string) => `shipment-storage/${encodeURIComponent(id)}`
  return {
    list: (query: ShipmentStorageListQuery, signal: AbortSignal) =>
      client.get<ShipmentStoragePageDto>('shipment-storage', { errorPresentation: 'local', params: query, signal }),
    detail: (id: string, signal: AbortSignal) =>
      client.get<ShipmentStorageDetailDto>(path(id), { errorPresentation: 'local', signal }),
    release: (data: ReleaseShipmentStorageRequestDto, signal: AbortSignal) =>
      client.post<ShipmentStorageDetailDto[]>('shipment-storage/releases', data, { errorPresentation: 'local', retry: false, signal }),
    relocate: (id: string, data: RelocateShipmentStorageRequestDto, signal: AbortSignal) =>
      client.post<ShipmentStorageDetailDto>(`${path(id)}/location`, data, { errorPresentation: 'local', retry: false, signal }),
  }
}

export default createShipmentStorageApi(api)
