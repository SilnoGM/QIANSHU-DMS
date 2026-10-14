import type { AxiosInstance } from 'axios'
import type {
  InvoiceRequestCancelDto,
  InvoiceRequestDto,
  InvoiceRequestNotifyDto,
  InvoiceRequestPageDto,
  InvoiceRequestResubmitDto,
  InvoiceRequestReturnDto,
  InvoiceRequestSettleDto,
  InvoiceRequestsListData,
  InvoiceRequestsStatusCountsData,
  InvoiceRequestStatusCountsDto,
  InvoiceRequestSubmitDto,
} from '../generated/types.gen'
import api from '../index'

export type InvoiceRequestListQuery = NonNullable<InvoiceRequestsListData['query']>
export type InvoiceRequestStatusCountsQuery = NonNullable<InvoiceRequestsStatusCountsData['query']>

/**
 * 开票申请的请求契约。
 *
 * 写请求一律 `retry: false`：状态流转由服务端前置条件与乐观锁裁决，自动重放只会把
 * 「已变化」的冲突藏起来。提交是唯一带幂等键的动作，重试必须复用同一个键。
 */
export function createInvoiceRequestsApi(client: AxiosInstance) {
  const path = (id: string) => `invoice-requests/${encodeURIComponent(id)}`
  const read = (signal: AbortSignal) => ({ errorPresentation: 'local' as const, signal })
  const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })
  return {
    list: (query: InvoiceRequestListQuery, signal: AbortSignal) =>
      client.get<InvoiceRequestPageDto>('invoice-requests', { ...read(signal), params: query }),
    // 状态计数独立于分页刷新，用来喂六态工具栏。
    statusCounts: (query: InvoiceRequestStatusCountsQuery, signal: AbortSignal) =>
      client.get<InvoiceRequestStatusCountsDto>('invoice-requests/status-counts', { ...read(signal), params: query }),
    get: (id: string, signal: AbortSignal) => client.get<InvoiceRequestDto>(path(id), read(signal)),
    submit: (data: InvoiceRequestSubmitDto, key: string, signal: AbortSignal) =>
      client.post<InvoiceRequestDto>('invoice-requests', data, { ...write(signal), headers: { 'Idempotency-Key': key } }),
    resubmit: (id: string, data: InvoiceRequestResubmitDto, signal: AbortSignal) =>
      client.post<InvoiceRequestDto>(`${path(id)}/resubmissions`, data, write(signal)),
    requestReturn: (id: string, data: InvoiceRequestReturnDto, signal: AbortSignal) =>
      client.post<InvoiceRequestDto>(`${path(id)}/returns`, data, write(signal)),
    notify: (id: string, data: InvoiceRequestNotifyDto, signal: AbortSignal) =>
      client.post<InvoiceRequestDto>(`${path(id)}/notifications`, data, write(signal)),
    cancel: (id: string, data: InvoiceRequestCancelDto, signal: AbortSignal) =>
      client.post<InvoiceRequestDto>(`${path(id)}/cancellations`, data, write(signal)),
    settle: (id: string, data: InvoiceRequestSettleDto, signal: AbortSignal) =>
      client.post<InvoiceRequestDto>(`${path(id)}/settlements`, data, write(signal)),
    uploadDocument: (id: string, file: File, signal: AbortSignal) => {
      const body = new FormData()
      // 服务端的流式解析器必须先拿到类型再拿到文件流，顺序不能调整。
      body.append('mediaType', 'IMAGE')
      body.append('file', file)
      return client.post<InvoiceRequestDto>(`${path(id)}/document-uploads`, body, write(signal))
    },
    documentBlob: (id: string, signal: AbortSignal) =>
      client.get<Blob>(`${path(id)}/document`, { ...read(signal), responseType: 'blob' }),
  }
}

export default createInvoiceRequestsApi(api)
