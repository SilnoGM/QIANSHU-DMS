import type { AxiosInstance } from 'axios'
import type { PurchasePaymentRecordPageDto } from '../generated/types.gen'
import api from '../index'

export interface PurchasePaymentRecordQuery {
  page: number
  pageSize: number
  keyword?: string
  status?: 'ALL' | 'ACTIVE' | 'VOIDED'
}

export function createPurchaseOrderPaymentsApi(client: AxiosInstance) {
  return {
    list: (query: PurchasePaymentRecordQuery, signal: AbortSignal) =>
      client.get<PurchasePaymentRecordPageDto>('purchase-order-payments', {
        errorPresentation: 'local',
        params: query,
        signal,
      }),
  }
}

export default createPurchaseOrderPaymentsApi(api)
