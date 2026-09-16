import type { AxiosInstance } from 'axios'
import type { PurchasePayableOrderDto, PurchasePayableOrderPageDto, PurchasePayablePayDto } from '../generated/types.gen'
import api from '../index'

export interface PurchaseOrderPayableQuery {
  page: number
  pageSize: number
  keyword?: string
}

export function createPurchaseOrderPayablesApi(client: AxiosInstance) {
  return {
    list: (query: PurchaseOrderPayableQuery, signal: AbortSignal) => client.get<PurchasePayableOrderPageDto>('purchase-order-payables', { errorPresentation: 'local', params: query, signal }),
    get: (id: string, signal: AbortSignal) => client.get<PurchasePayableOrderDto>(`purchase-order-payables/${encodeURIComponent(id)}`, { errorPresentation: 'local', signal }),
    getByOrder: (id: string, signal: AbortSignal) => client.get<PurchasePayableOrderDto>(`purchase-order-payables/orders/${encodeURIComponent(id)}`, { errorPresentation: 'local', signal }),
    // 财务写入不自动重试；未知结果由付款页面保留原始输入与幂等键。
    pay: (id: string, data: PurchasePayablePayDto, idempotencyKey: string, signal: AbortSignal) => client.post<PurchasePayableOrderDto>(`purchase-order-payables/${encodeURIComponent(id)}/pay`, data, { errorPresentation: 'local', headers: { 'Idempotency-Key': idempotencyKey }, retry: false, signal }),
  }
}

export default createPurchaseOrderPayablesApi(api)
