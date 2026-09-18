import type { AxiosInstance } from 'axios'
import type { PurchasePayableBatchOrdersDto, PurchasePayableBatchPayDto, PurchasePayableBatchResultDto, PurchasePayableBatchSuppliersDto, PurchasePayableOrderDto, PurchasePayableOrderPageDto, PurchasePayablePayDto, PurchasePayableVoucherUploadDto } from '../generated/types.gen'
import api from '../index'

export interface PurchaseOrderPayableQuery {
  page: number
  pageSize: number
  keyword?: string
}

export function createPurchaseOrderPayablesApi(client: AxiosInstance) {
  return {
    batchSuppliers: (signal: AbortSignal) => client.get<PurchasePayableBatchSuppliersDto>('purchase-order-payables/batch/suppliers', { errorPresentation: 'local', signal }),
    batchOrders: (supplierValue: string, signal: AbortSignal) => client.get<PurchasePayableBatchOrdersDto>('purchase-order-payables/batch/orders', { errorPresentation: 'local', params: { supplierValue }, signal }),
    payBatch: (data: PurchasePayableBatchPayDto, idempotencyKey: string, signal: AbortSignal) => client.post<PurchasePayableBatchResultDto>('purchase-order-payables/batch/pay', data, { errorPresentation: 'local', headers: { 'Idempotency-Key': idempotencyKey }, retry: false, signal }),
    list: (query: PurchaseOrderPayableQuery, signal: AbortSignal) => client.get<PurchasePayableOrderPageDto>('purchase-order-payables', { errorPresentation: 'local', params: query, signal }),
    get: (id: string, signal: AbortSignal) => client.get<PurchasePayableOrderDto>(`purchase-order-payables/${encodeURIComponent(id)}`, { errorPresentation: 'local', signal }),
    getByOrder: (id: string, signal: AbortSignal) => client.get<PurchasePayableOrderDto>(`purchase-order-payables/orders/${encodeURIComponent(id)}`, { errorPresentation: 'local', signal }),
    uploadVoucher: (id: string, file: File, signal: AbortSignal) => {
      const data = new FormData()
      // 流式上传先声明媒体类型，后端收到文件时才能执行对应校验。
      data.append('mediaType', 'IMAGE')
      data.append('file', file)
      return client.post<PurchasePayableVoucherUploadDto>(`purchase-order-payables/${encodeURIComponent(id)}/voucher-uploads`, data, { errorPresentation: 'local', retry: false, signal })
    },
    voucherContentBlob: (id: string, documentId: string, signal: AbortSignal) => client.get<Blob>(`purchase-order-payables/${encodeURIComponent(id)}/vouchers/${encodeURIComponent(documentId)}/content`, { errorPresentation: 'local', responseType: 'blob', signal }),
    // 财务写入不自动重试；未知结果由付款页面保留原始输入与幂等键。
    pay: (id: string, data: PurchasePayablePayDto, idempotencyKey: string, signal: AbortSignal) => client.post<PurchasePayableOrderDto>(`purchase-order-payables/${encodeURIComponent(id)}/pay`, data, { errorPresentation: 'local', headers: { 'Idempotency-Key': idempotencyKey }, retry: false, signal }),
  }
}

export default createPurchaseOrderPayablesApi(api)
