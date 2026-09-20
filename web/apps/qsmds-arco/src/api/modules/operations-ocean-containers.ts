import type { AxiosInstance } from 'axios'
import type { OperationsOceanContainerItemsListData, OperationsOceanContainerLineDto, OperationsOceanContainerLinePageDto, OperationsOceanContainerPageDto, OperationsOceanContainersListData } from '../generated/types.gen'
import api from '../index'

export type OperationsOceanContainerQuery = NonNullable<OperationsOceanContainersListData['query']>
export type OperationsOceanContainerItemsQuery = NonNullable<OperationsOceanContainerItemsListData['query']>

const path = (id: string) => `operations/ocean-containers/${encodeURIComponent(id)}`
const read = (signal: AbortSignal) => ({ signal, errorPresentation: 'local' as const })

export function createOperationsOceanContainersApi(client: AxiosInstance) {
  return {
    list: (query: OperationsOceanContainerQuery, signal: AbortSignal) => client.get<OperationsOceanContainerPageDto>('operations/ocean-containers', { ...read(signal), params: query }),
    items: (id: string, query: OperationsOceanContainerItemsQuery, signal: AbortSignal) => client.get<OperationsOceanContainerLinePageDto>(`${path(id)}/items`, { ...read(signal), params: query }),
    item: (id: string, itemId: string, signal: AbortSignal) => client.get<OperationsOceanContainerLineDto>(`${path(id)}/items/${encodeURIComponent(itemId)}`, read(signal)),
  }
}

export type OperationsOceanContainerApi = ReturnType<typeof createOperationsOceanContainersApi>
export default createOperationsOceanContainersApi(api)
