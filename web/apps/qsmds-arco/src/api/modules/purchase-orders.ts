import type { AxiosInstance } from 'axios'
import type {
  CreatePurchaseOrderRequestDto,
  FactoryShipmentResultDto,
  PurchaseOrderDetailDto,
  PurchaseOrderFactoryShipmentRequestDto,
  PurchaseOrderFulfillmentStatusRequestDto,
  PurchaseOrderPageDto,
  PurchaseOrderPaymentRequestDto,
  PurchaseOrderPaymentVoidRequestDto,
  PurchaseOrderProductOptionsDto,
  PurchaseOrdersListData,
  PurchaseOrderSourceSalesOrderLinesDto,
  PurchaseOrderSourceSalesOrdersDto,
  PurchaseOrdersProductOptionsData,
  PurchaseOrdersSourceSalesOrdersData,
  PurchaseOrdersStatusCountsData,
  PurchaseOrderStatusCountsDto,
  PurchaseOrderStatusRequestDto,
  PurchaseOrderTemporaryDocumentDto,
} from '../generated/types.gen'

import api from '../index'

export type PurchaseOrderListQuery = NonNullable<PurchaseOrdersListData['query']>
export type PurchaseOrderProductOptionsQuery = NonNullable<
  PurchaseOrdersProductOptionsData['query']
>
export type PurchaseOrderSourceSalesOrdersQuery = NonNullable<
  PurchaseOrdersSourceSalesOrdersData['query']
>
export type PurchaseOrderStatusCountsQuery = NonNullable<
  PurchaseOrdersStatusCountsData['query']
>

function orderPath(purchaseOrderId: string): string {
  return `purchase-orders/${encodeURIComponent(purchaseOrderId)}`
}

function documentContentPath(
  purchaseOrderId: string,
  documentId: string,
): string {
  return `${orderPath(purchaseOrderId)}/documents/${encodeURIComponent(documentId)}/content`
}

/**
 * 采购 API 适配层只负责 HTTP 契约和重试边界。创建使用调用方持有的幂等 Key；
 * 所有有副作用的请求都关闭自动重试，未知结果由页面使用原 Key 显式重放。
 */
export function createPurchaseOrdersApi(client: AxiosInstance) {
  return {
    list: (query: PurchaseOrderListQuery, signal: AbortSignal) =>
      client.get<PurchaseOrderPageDto>('purchase-orders', {
        errorPresentation: 'local',
        params: query,
        signal,
      }),
    statusCounts: (query: PurchaseOrderStatusCountsQuery, signal: AbortSignal) =>
      client.get<PurchaseOrderStatusCountsDto>('purchase-orders/status-counts', {
        errorPresentation: 'local',
        params: query,
        signal,
      }),
    productOptions: (
      query: PurchaseOrderProductOptionsQuery,
      signal: AbortSignal,
    ) => client.get<PurchaseOrderProductOptionsDto>(
      'purchase-orders/product-options',
      { errorPresentation: 'local', params: query, signal },
    ),
    sourceSalesOrders: (
      query: PurchaseOrderSourceSalesOrdersQuery,
      signal: AbortSignal,
    ) => client.get<PurchaseOrderSourceSalesOrdersDto>(
      'purchase-orders/source-sales-orders',
      { errorPresentation: 'local', params: query, signal },
    ),
    sourceSalesOrderLines: (salesOrderId: string, signal: AbortSignal) =>
      client.get<PurchaseOrderSourceSalesOrderLinesDto>(
        `purchase-orders/source-sales-orders/${encodeURIComponent(salesOrderId)}/lines`,
        { errorPresentation: 'local', signal },
      ),
    uploadTemporaryDocument: (
      file: File,
      mediaType: 'DOCUMENT' | 'IMAGE',
      signal: AbortSignal,
    ) => {
      const body = new FormData()
      // Server 流式 multipart parser 要求 mediaType 位于单个 file part 之前。
      body.append('mediaType', mediaType)
      body.append('file', file, file.name)
      return client.post<PurchaseOrderTemporaryDocumentDto>(
        'purchase-orders/document-uploads',
        body,
        { errorPresentation: 'local', retry: false, signal },
      )
    },
    create: (
      data: CreatePurchaseOrderRequestDto,
      idempotencyKey: string,
      signal: AbortSignal,
    ) => client.post<PurchaseOrderDetailDto>('purchase-orders', data, {
      errorPresentation: 'local',
      headers: { 'Idempotency-Key': idempotencyKey },
      retry: false,
      signal,
    }),
    getById: (purchaseOrderId: string, signal: AbortSignal) =>
      client.get<PurchaseOrderDetailDto>(orderPath(purchaseOrderId), {
        errorPresentation: 'local',
        signal,
      }),
    updateOrderStatus: (
      purchaseOrderId: string,
      data: PurchaseOrderStatusRequestDto,
      signal: AbortSignal,
    ) => client.patch<PurchaseOrderDetailDto>(
      `${orderPath(purchaseOrderId)}/order-status`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    updateFulfillmentStatus: (
      purchaseOrderId: string,
      data: PurchaseOrderFulfillmentStatusRequestDto,
      signal: AbortSignal,
    ) => client.patch<PurchaseOrderDetailDto>(
      `${orderPath(purchaseOrderId)}/fulfillment-status`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    factoryShipment: (
      purchaseOrderId: string,
      data: PurchaseOrderFactoryShipmentRequestDto,
      signal: AbortSignal,
    ) => client.post<FactoryShipmentResultDto>(
      `${orderPath(purchaseOrderId)}/factory-shipments`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    recordPayment: (
      purchaseOrderId: string,
      data: PurchaseOrderPaymentRequestDto,
      signal: AbortSignal,
    ) => client.post<PurchaseOrderDetailDto>(
      `${orderPath(purchaseOrderId)}/payments`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    voidPayment: (
      purchaseOrderId: string,
      paymentId: string,
      data: PurchaseOrderPaymentVoidRequestDto,
      signal: AbortSignal,
    ) => client.post<PurchaseOrderDetailDto>(
      `${orderPath(purchaseOrderId)}/payments/${encodeURIComponent(paymentId)}/void`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    detachDocument: (
      purchaseOrderId: string,
      documentId: string,
      signal: AbortSignal,
    ) => client.delete<PurchaseOrderDetailDto>(
      `${orderPath(purchaseOrderId)}/documents/${encodeURIComponent(documentId)}`,
      { errorPresentation: 'local', retry: false, signal },
    ),
    headDocumentContent: (
      purchaseOrderId: string,
      documentId: string,
      signal: AbortSignal,
    ) => client.head(documentContentPath(purchaseOrderId, documentId), {
      errorPresentation: 'local',
      signal,
    }),
    getDocumentContent: (
      purchaseOrderId: string,
      documentId: string,
      signal: AbortSignal,
    ) => client.get<Blob>(documentContentPath(purchaseOrderId, documentId), {
      errorPresentation: 'local',
      responseType: 'blob',
      signal,
    }),
  }
}

export default createPurchaseOrdersApi(api)
