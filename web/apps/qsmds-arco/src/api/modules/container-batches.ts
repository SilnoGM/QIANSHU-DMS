import type { AxiosInstance } from 'axios'
import type { ContainerBatchCreateDto, ContainerBatchDto, ContainerBatchesListData, ContainerBatchPageDto, ContainerBatchUpdateDto, ContainerLoadingItemCreateDto, ContainerLoadingItemDto, ContainerLoadingItemPageDto, ContainerLoadingItemUpdateDto, ContainerSwapContextDto, ContainerSwapRequestDto, ContainerSwapResultDto } from '../generated/types.gen'
import api from '../index'

export type ContainerListQuery = NonNullable<ContainerBatchesListData['query']>
export interface ContainerSwapContextQuery {
  leftShipmentId: string
  rightShipmentId: string
}
const path = (id: string) => `container-batches/${encodeURIComponent(id)}`
const read = (signal: AbortSignal) => ({ signal, errorPresentation: 'local' as const })
const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })
export function createContainerBatchesApi(client: AxiosInstance) {
  return {
    list: (query: ContainerListQuery, signal: AbortSignal) => client.get<ContainerBatchPageDto>('container-batches', { ...read(signal), params: query }),
    get: (id: string, signal: AbortSignal) => client.get<ContainerBatchDto>(path(id), read(signal)),
    items: (id: string, query: ContainerListQuery, signal: AbortSignal) => client.get<ContainerLoadingItemPageDto>(`${path(id)}/items`, { ...read(signal), params: query }),
    swapContext: (query: ContainerSwapContextQuery, signal: AbortSignal) => client.get<ContainerSwapContextDto>('container-batches/swap-context', { ...read(signal), params: query }),
    swap: (data: ContainerSwapRequestDto, key: string, signal: AbortSignal) => client.post<ContainerSwapResultDto>('container-batches/swap', data, { ...write(signal), headers: { 'Idempotency-Key': key } }),
    create: (data: ContainerBatchCreateDto, key: string, signal: AbortSignal) => client.post<ContainerBatchDto>('container-batches', data, { ...write(signal), headers: { 'Idempotency-Key': key } }),
    update: (id: string, data: ContainerBatchUpdateDto, signal: AbortSignal) => client.patch<ContainerBatchDto>(path(id), data, write(signal)),
    createItem: (id: string, data: ContainerLoadingItemCreateDto, key: string, signal: AbortSignal) => client.post<ContainerLoadingItemDto>(`${path(id)}/items`, data, { ...write(signal), headers: { 'Idempotency-Key': key } }),
    updateItem: (id: string, itemId: string, data: ContainerLoadingItemUpdateDto, signal: AbortSignal) => client.patch<ContainerLoadingItemDto>(`${path(id)}/items/${encodeURIComponent(itemId)}`, data, write(signal)),
  }
}
export default createContainerBatchesApi(api)
