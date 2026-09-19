import type { AxiosInstance } from 'axios'
import type { ContainerImportConfirmDto, ContainerImportPreviewDto, ContainerImportResultDto } from '../generated/types.gen'
import api from '../index'

const path = (id: string) => `container-batches/${encodeURIComponent(id)}`
export function createContainerImportApi(client: AxiosInstance) {
  return {
    preview: (id: string, signal: AbortSignal) => client.get<ContainerImportPreviewDto>(`${path(id)}/import-preview`, { signal, errorPresentation: 'local' }),
    confirm: (id: string, data: ContainerImportConfirmDto, key: string, signal: AbortSignal) => client.post<ContainerImportResultDto>(`${path(id)}/import`, data, { signal, errorPresentation: 'local', retry: false, headers: { 'Idempotency-Key': key } }),
  }
}
export default createContainerImportApi(api)
