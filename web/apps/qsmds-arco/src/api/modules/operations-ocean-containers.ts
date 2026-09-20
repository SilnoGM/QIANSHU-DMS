import type { AxiosInstance } from 'axios'
import type { OperationsOceanContainerChangeDto, OperationsOceanContainerChangeResultDto, OperationsOceanContainerItemsListData, OperationsOceanContainerLineDto, OperationsOceanContainerLinePageDto, OperationsOceanContainerPageDto, OperationsOceanContainersListData, OperationsOceanContainerUndoChangeDto } from '../generated/types.gen'
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
    // 未知保存结果由用户使用原 requestKey 重试，HTTP 层不能自行重复写入。
    changeItem: (id: string, itemId: string, input: OperationsOceanContainerChangeDto, signal: AbortSignal) => client.post<OperationsOceanContainerChangeResultDto>(`${path(id)}/items/${encodeURIComponent(itemId)}/changes`, input, { ...read(signal), retry: false }),
    undoChange: (id: string, itemId: string, changeId: string, input: OperationsOceanContainerUndoChangeDto, signal: AbortSignal) => client.post<OperationsOceanContainerChangeResultDto>(`${path(id)}/items/${encodeURIComponent(itemId)}/changes/${encodeURIComponent(changeId)}/undo`, input, { ...read(signal), retry: false }),
  }
}

export type OperationsOceanContainerApi = ReturnType<typeof createOperationsOceanContainersApi>
export default createOperationsOceanContainersApi(api)
