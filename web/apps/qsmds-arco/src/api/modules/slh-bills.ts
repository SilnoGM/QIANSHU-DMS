import type { AxiosInstance } from 'axios'
import type { SlhBillDto, SlhBillImportCreateDto, SlhBillImportPreviewDto, SlhBillLinePageDto, SlhBillMediaAssetDto, SlhBillPageDto, SlhBillsLinesData, SlhBillsListData, SlhBillStagedFileDto } from '../generated/types.gen'
import api from '../index'

export type SlhBillListQuery = NonNullable<SlhBillsListData['query']>
export type SlhBillLineQuery = NonNullable<SlhBillsLinesData['query']>
const path = (id: string) => `slh-bills/${encodeURIComponent(id)}`
const read = (signal: AbortSignal) => ({ signal, errorPresentation: 'local' as const })
const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })
export function createSlhBillsApi(client: AxiosInstance) {
  return {
    list: (query: SlhBillListQuery, signal: AbortSignal) => client.get<SlhBillPageDto>('slh-bills', { ...read(signal), params: query }),
    get: (id: string, signal: AbortSignal) => client.get<SlhBillDto>(path(id), read(signal)),
    lines: (id: string, query: SlhBillLineQuery, signal: AbortSignal) => client.get<SlhBillLinePageDto>(`${path(id)}/lines`, { ...read(signal), params: query }),
    uploadSourceFile: (file: File, signal: AbortSignal) => {
      const body = new FormData()
      // 服务端的流式解析器必须先接收类型，再接收文件流，顺序不能调整。
      body.append('mediaType', 'DOCUMENT')
      body.append('file', file)
      return client.post<SlhBillStagedFileDto>('slh-bills/source-file-uploads', body, write(signal))
    },
    importPreview: (data: SlhBillMediaAssetDto, signal: AbortSignal) => client.post<SlhBillImportPreviewDto>('slh-bills/import-preview', data, write(signal)),
    // 账单是外部凭证且会消耗编号，重复提交必须命中同一张账单，因此写请求携带幂等键且禁用自动重试。
    create: (data: SlhBillImportCreateDto, key: string, signal: AbortSignal) => client.post<SlhBillDto>('slh-bills', data, { ...write(signal), headers: { 'Idempotency-Key': key } }),
    downloadSourceFile: (id: string, signal: AbortSignal) => client.get<Blob>(`${path(id)}/source-file`, { ...read(signal), responseType: 'blob' }),
  }
}
export default createSlhBillsApi(api)
