import type { AxiosInstance } from 'axios'
import type { ContainerSourceFileDto } from '../generated/types.gen'
import api from '../index'

export function createContainerSourceFilesApi(client: AxiosInstance) {
  const path = (id: string) => `container-batches/${encodeURIComponent(id)}`
  const uploadFile = (url: string, file: File, signal: AbortSignal) => {
    const body = new FormData()
    // 既有流式解析器必须先接收类型，再接收文件流。
    body.append('mediaType', 'DOCUMENT')
    body.append('file', file)
    return client.post<ContainerSourceFileDto>(url, body, { errorPresentation: 'local', retry: false, signal })
  }
  return {
    uploadForCreate: (file: File, signal: AbortSignal) => uploadFile('container-batches/source-file-uploads', file, signal),
    upload: (id: string, file: File, signal: AbortSignal) => uploadFile(`${path(id)}/source-file-uploads`, file, signal),
    metadata: (id: string, signal: AbortSignal) => client.get<ContainerSourceFileDto>(`${path(id)}/source-file`, { errorPresentation: 'local', signal }),
    download: (id: string, signal: AbortSignal) => client.get<Blob>(`${path(id)}/source-file/content`, { errorPresentation: 'local', responseType: 'blob', signal }),
  }
}
export default createContainerSourceFilesApi(api)
