import type { AxiosInstance } from 'axios'
import type {
  SalesReceiptApprovalContextDto,
  SalesReceiptApproveDto,
  SalesReceiptRejectDto,
  SalesReceiptRequestCreateDto,
  SalesReceiptRequestDetailDto,
  SalesReceiptRequestPageDto,
  SalesReceiptsListData,
} from '../generated/types.gen'
import api from '../index'

export type SalesReceiptListQuery = NonNullable<SalesReceiptsListData['query']>

/** 金额与预览版本仅传输服务端契约；写入禁止自动重试，提交重放保留原键。 */
export function createSalesReceiptsApi(client: AxiosInstance) {
  const path = (id: string) => `sales-receipt-requests/${encodeURIComponent(id)}`
  return {
    submit: (orderId: string, data: SalesReceiptRequestCreateDto, idempotencyKey: string, signal: AbortSignal) => client.post<SalesReceiptRequestDetailDto>(
      `sales-orders/${encodeURIComponent(orderId)}/receipt-requests`,
      data,
      { errorPresentation: 'local', headers: { 'Idempotency-Key': idempotencyKey }, retry: false, signal },
    ),
    list: (query: SalesReceiptListQuery, signal: AbortSignal) => client.get<SalesReceiptRequestPageDto>('sales-receipt-requests', { errorPresentation: 'local', params: query, signal }),
    orderRequests: (orderId: string, query: SalesReceiptListQuery, signal: AbortSignal) => client.get<SalesReceiptRequestPageDto>(`sales-orders/${encodeURIComponent(orderId)}/receipt-requests`, { errorPresentation: 'local', params: query, signal }),
    detail: (id: string, signal: AbortSignal) => client.get<SalesReceiptRequestDetailDto>(path(id), { errorPresentation: 'local', signal }),
    approvalContext: (id: string, signal: AbortSignal) => client.get<SalesReceiptApprovalContextDto>(`${path(id)}/approval-context`, { errorPresentation: 'local', signal }),
    approve: (id: string, data: SalesReceiptApproveDto, signal: AbortSignal) => client.post<SalesReceiptRequestDetailDto>(`${path(id)}/approve`, data, { errorPresentation: 'local', retry: false, signal }),
    reject: (id: string, data: SalesReceiptRejectDto, signal: AbortSignal) => client.post<SalesReceiptRequestDetailDto>(`${path(id)}/reject`, data, { errorPresentation: 'local', retry: false, signal }),
  }
}
export default createSalesReceiptsApi(api)
