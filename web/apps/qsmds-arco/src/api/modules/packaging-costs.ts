import type { AxiosInstance } from 'axios'
import type { PackagingCostImageUploadDto, PackagingCostRequestCreateDto, PackagingCostRequestDto, PackagingCostRequestPageDto, PackagingCostRequestPayDto, PackagingCostShipmentContextDto, PackagingCostsListData } from '../generated/types.gen'
import api from '../index'

export type PackagingCostListQuery = NonNullable<PackagingCostsListData['query']>

/** 费用提报与付款禁止自动重试，未知结果仅由用户复用原幂等键确认。 */
export function createPackagingCostsApi(client: AxiosInstance) {
  const path = (id: string) => `packaging-cost-requests/${encodeURIComponent(id)}`
  return {
    shipmentContext: (id: string, signal: AbortSignal) => client.get<PackagingCostShipmentContextDto>(`packaging-cost-requests/shipment-context/${encodeURIComponent(id)}`, { errorPresentation: 'local', signal }),
    uploadImage: (file: File, signal: AbortSignal) => {
      const body = new FormData()
      body.append('mediaType', 'IMAGE')
      body.append('file', file)
      return client.post<PackagingCostImageUploadDto>('packaging-cost-requests/images', body, { errorPresentation: 'local', retry: false, signal })
    },
    submit: (data: PackagingCostRequestCreateDto, idempotencyKey: string, signal: AbortSignal) => client.post<PackagingCostRequestDto>('packaging-cost-requests', data, { errorPresentation: 'local', headers: { 'Idempotency-Key': idempotencyKey }, retry: false, signal }),
    list: (query: PackagingCostListQuery, signal: AbortSignal) => client.get<PackagingCostRequestPageDto>('packaging-cost-requests', { errorPresentation: 'local', params: query, signal }),
    detail: (id: string, signal: AbortSignal) => client.get<PackagingCostRequestDto>(path(id), { errorPresentation: 'local', signal }),
    pay: (id: string, data: PackagingCostRequestPayDto, signal: AbortSignal) => client.post<PackagingCostRequestDto>(`${path(id)}/pay`, data, { errorPresentation: 'local', retry: false, signal }),
  }
}
export default createPackagingCostsApi(api)
