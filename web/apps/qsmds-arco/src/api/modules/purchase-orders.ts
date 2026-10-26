import type { AxiosInstance } from 'axios'
import type {
  CreatePurchaseOrderRequestDto,
  FactoryShipmentResultDto,
  PurchaseOrderDetailDto,
  PurchaseOrderDocumentAttachRequestDto,
  PurchaseOrderFactoryShipmentRequestDto,
  PurchaseOrderFulfillmentStatusRequestDto,
  PurchaseOrderGenerateImageDraftRequestDto,
  PurchaseOrderImageDraftDto,
  PurchaseOrderImageDraftResponseDto,
  PurchaseOrderPageDto,
  PurchaseOrderPaymentRequestDto,
  PurchaseOrderPaymentVoidRequestDto,
  PurchaseOrderPrepareReviewShippingMarksRequestDto,
  PurchaseOrderProductOptionsDto,
  PurchaseOrderRejectRequestDto,
  PurchaseOrderReviewContextDto,
  PurchaseOrderReviewRequestDto,
  PurchaseOrderShippingMarkResolutionDto,
  PurchaseOrdersListData,
  PurchaseOrderSourceSalesOrderLinesDto,
  PurchaseOrderSourceSalesOrdersDto,
  PurchaseOrdersProductOptionsData,
  PurchaseOrdersShippingMarkResolutionData,
  PurchaseOrdersSourceSalesOrderLinesData,
  PurchaseOrdersSourceSalesOrdersData,
  PurchaseOrdersStatusCountsData,
  PurchaseOrderStatusCountsDto,
  PurchaseOrderStatusRequestDto,
  PurchaseOrderTemporaryDocumentDto,
  PurchaseOrderWarehouseReceiptRequestDto,
} from '../generated/types.gen'

import api from '../index'

export type PurchaseOrderListQuery = NonNullable<PurchaseOrdersListData['query']>
export type PurchaseOrderShippingMarkResolutionQuery = NonNullable<
  PurchaseOrdersShippingMarkResolutionData['query']
>
export type PurchaseOrderProductOptionsQuery = NonNullable<
  PurchaseOrdersProductOptionsData['query']
>
export type PurchaseOrderSourceSalesOrdersQuery = NonNullable<
  PurchaseOrdersSourceSalesOrdersData['query']
>
export type PurchaseOrderSourceSalesOrderLinesQuery = NonNullable<
  PurchaseOrdersSourceSalesOrderLinesData['query']
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
    orderImageDraft: (purchaseOrderId: string, signal: AbortSignal) =>
      client.get<PurchaseOrderImageDraftResponseDto>(`${orderPath(purchaseOrderId)}/order-image-draft`, {
        errorPresentation: 'local',
        signal,
      }),
    prepareReviewShippingMarks: (purchaseOrderId: string, data: PurchaseOrderPrepareReviewShippingMarksRequestDto, signal: AbortSignal) =>
      client.post<PurchaseOrderDetailDto>(`${orderPath(purchaseOrderId)}/prepare-review-shipping-marks`, data, {
        errorPresentation: 'local',
        retry: false,
        signal,
      }),
    generateOrderImageDraft: (purchaseOrderId: string, data: PurchaseOrderGenerateImageDraftRequestDto, signal: AbortSignal) =>
      client.post<PurchaseOrderImageDraftDto>(`${orderPath(purchaseOrderId)}/order-image-drafts`, data, {
        errorPresentation: 'local',
        retry: false,
        signal,
      }),
    getOrderImageDraftContent: (purchaseOrderId: string, draftId: string, signal: AbortSignal) =>
      client.get<Blob>(`${orderPath(purchaseOrderId)}/order-image-drafts/${encodeURIComponent(draftId)}/content`, {
        errorPresentation: 'local',
        responseType: 'blob',
        signal,
      }),
    reviewContext: (purchaseOrderId: string, signal: AbortSignal) =>
      client.get<PurchaseOrderReviewContextDto>(`${orderPath(purchaseOrderId)}/review-context`, {
        errorPresentation: 'local',
        signal,
      }),
    review: (purchaseOrderId: string, data: PurchaseOrderReviewRequestDto, signal: AbortSignal) =>
      client.post<PurchaseOrderDetailDto>(`${orderPath(purchaseOrderId)}/review`, data, {
        errorPresentation: 'local',
        retry: false,
        signal,
      }),
    reject: (purchaseOrderId: string, data: PurchaseOrderRejectRequestDto, signal: AbortSignal) =>
      client.post<PurchaseOrderDetailDto>(`${orderPath(purchaseOrderId)}/reject`, data, {
        errorPresentation: 'local',
        retry: false,
        signal,
      }),
    shippingMarkResolution: (
      query: PurchaseOrderShippingMarkResolutionQuery,
      signal: AbortSignal,
    ) => client.get<PurchaseOrderShippingMarkResolutionDto>(
      'purchase-orders/shipping-mark-resolution',
      { errorPresentation: 'local', params: query, signal },
    ),
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
    sourceSalesOrderLines: (
      salesOrderId: string,
      query: PurchaseOrderSourceSalesOrderLinesQuery,
      signal: AbortSignal,
    ) =>
      client.get<PurchaseOrderSourceSalesOrderLinesDto>(
        `purchase-orders/source-sales-orders/${encodeURIComponent(salesOrderId)}/lines`,
        { errorPresentation: 'local', params: query, signal },
      ),
    uploadTemporaryDocument: (
      file: File,
      signal: AbortSignal,
    ) => {
      const body = new FormData()
      // 采购单和签收单只接受图片；流式 parser 要求 mediaType 位于 file part 之前。
      body.append('mediaType', 'IMAGE')
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
    recordWarehouseReceipt: (
      purchaseOrderId: string,
      data: PurchaseOrderWarehouseReceiptRequestDto,
      signal: AbortSignal,
    ) => client.post<PurchaseOrderDetailDto>(
      `${orderPath(purchaseOrderId)}/warehouse-receipts`,
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
    attachDocument: (
      purchaseOrderId: string,
      data: PurchaseOrderDocumentAttachRequestDto,
      signal: AbortSignal,
    ) => client.post<PurchaseOrderDetailDto>(
      `${orderPath(purchaseOrderId)}/documents`,
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
