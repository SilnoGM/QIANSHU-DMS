import type { AxiosInstance } from 'axios'
import type {
  CreateSalesOrderRequestDto,
  FactoryShipmentResultDto,
  SalesOrderDeliveryReceiptRequestDto,
  SalesOrderDetailDto,
  SalesOrderFactoryShipmentContextDto,
  SalesOrderFactoryShipmentRequestDto,
  SalesOrderIssuerOptionsDto,
  SalesOrderPageDto,
  SalesOrderPaymentRequestDto,
  SalesOrderPaymentVoidRequestDto,
  SalesOrderPendingPurchaseProductsDto,
  SalesOrderProductEditContextDto,
  SalesOrderProductOptionsDto,
  SalesOrderProductsUpdateRequestDto,
  SalesOrderProductsUpdateResultDto,
  SalesOrdersGetProductEditOptionsData,
  SalesOrdersListData,
  SalesOrdersProductOptionsData,
  SalesOrdersStatusCountsData,
  SalesOrderStatusCountsDto,
  SalesOrderTemporaryDocumentDto,
} from '../generated/types.gen'

import api from '../index'

export type SalesOrderListQuery = NonNullable<SalesOrdersListData['query']>
export type SalesOrderProductOptionsQuery = NonNullable<
  SalesOrdersProductOptionsData['query']
>
export type SalesOrderStatusCountsQuery = NonNullable<
  SalesOrdersStatusCountsData['query']
>
export type SalesOrderProductEditOptionsQuery = NonNullable<
  SalesOrdersGetProductEditOptionsData['query']
>
export type SalesOrderCurrency = 'TWD' | 'MYR'

/**
 * 销售订单 API 适配只负责传输契约。正式保存使用内存幂等 Key 并禁止自动重试；
 * 临时凭证上传没有订单身份，也不得因为上传动作提前触发订单编号派发。
 */
export function createSalesOrdersApi(client: AxiosInstance) {
  return {
    list: (query: SalesOrderListQuery, signal: AbortSignal) =>
      client.get<SalesOrderPageDto>('sales-orders', {
        errorPresentation: 'local',
        params: query,
        signal,
      }),
    statusCounts: (query: SalesOrderStatusCountsQuery, signal: AbortSignal) =>
      client.get<SalesOrderStatusCountsDto>('sales-orders/status-counts', {
        errorPresentation: 'local',
        params: query,
        signal,
      }),
    issuerOptions: (signal: AbortSignal) =>
      client.get<SalesOrderIssuerOptionsDto>('sales-orders/issuer-options', {
        errorPresentation: 'local',
        signal,
      }),
    productOptions: (
      query: SalesOrderProductOptionsQuery,
      signal: AbortSignal,
    ) => client.get<SalesOrderProductOptionsDto>('sales-orders/product-options', {
      errorPresentation: 'local',
      params: query,
      signal,
    }),
    pendingPurchaseProducts: (salesOrderId: string, signal: AbortSignal) =>
      client.get<SalesOrderPendingPurchaseProductsDto>(
        `sales-orders/${encodeURIComponent(salesOrderId)}/pending-purchase-products`,
        { errorPresentation: 'local', signal },
      ),
    productEditContext: (salesOrderId: string, signal: AbortSignal) =>
      client.get<SalesOrderProductEditContextDto>(
        `sales-orders/${encodeURIComponent(salesOrderId)}/product-edit-context`,
        { errorPresentation: 'local', signal },
      ),
    factoryShipmentContext: (salesOrderId: string, signal: AbortSignal) =>
      client.get<SalesOrderFactoryShipmentContextDto>(
        `sales-orders/${encodeURIComponent(salesOrderId)}/factory-shipment-context`,
        { errorPresentation: 'local', signal },
      ),
    factoryShipment: (
      salesOrderId: string,
      data: SalesOrderFactoryShipmentRequestDto,
      signal: AbortSignal,
    ) => client.post<FactoryShipmentResultDto>(
      `sales-orders/${encodeURIComponent(salesOrderId)}/factory-shipments`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    productEditOptions: (
      salesOrderId: string,
      query: SalesOrderProductEditOptionsQuery,
      signal: AbortSignal,
    ) => client.get<SalesOrderProductOptionsDto>(
      `sales-orders/${encodeURIComponent(salesOrderId)}/product-edit-options`,
      { errorPresentation: 'local', params: query, signal },
    ),
    updateProducts: (
      salesOrderId: string,
      data: SalesOrderProductsUpdateRequestDto,
      signal: AbortSignal,
    ) => client.patch<SalesOrderProductsUpdateResultDto>(
      `sales-orders/${encodeURIComponent(salesOrderId)}/products`,
      data,
      {
        // 产品修改携带版本号但没有幂等操作键；网络结果未知时禁止自动重放。
        errorPresentation: 'local',
        retry: false,
        signal,
      },
    ),
    uploadTemporaryDocument: (
      file: File,
      mediaType: 'IMAGE' | 'DOCUMENT',
      signal: AbortSignal,
      /**
       * 收款凭证与签收单必须声明用途：它们与出单凭证共用本入口，
       * 而对象键在上传瞬间物化且不可改写。缺省＝出单凭证。
       */
      purpose?: 'PAYMENT_VOUCHER' | 'DELIVERY_RECEIPT',
    ) => {
      const body = new FormData()
      // Server 的流式 parser 要求 mediaType field 位于单个 file part 之前。
      body.append('mediaType', mediaType)
      if (purpose !== undefined) {
        body.append('purpose', purpose)
      }
      body.append('file', file, file.name)
      return client.post<SalesOrderTemporaryDocumentDto>(
        'sales-orders/document-uploads',
        body,
        {
          errorPresentation: 'local',
          retry: false,
          signal,
        },
      )
    },
    create: (
      data: CreateSalesOrderRequestDto,
      idempotencyKey: string,
      signal: AbortSignal,
    ) => client.post<SalesOrderDetailDto>('sales-orders', data, {
      errorPresentation: 'local',
      headers: { 'Idempotency-Key': idempotencyKey },
      retry: false,
      signal,
    }),
    getById: (salesOrderId: string, signal: AbortSignal) =>
      client.get<SalesOrderDetailDto>(
        `sales-orders/${encodeURIComponent(salesOrderId)}`,
        { errorPresentation: 'local', signal },
      ),
    recordPayment: (
      salesOrderId: string,
      data: SalesOrderPaymentRequestDto,
      signal: AbortSignal,
    ) => client.post<SalesOrderDetailDto>(
      `sales-orders/${encodeURIComponent(salesOrderId)}/payments`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    voidPayment: (
      salesOrderId: string,
      paymentId: string,
      data: SalesOrderPaymentVoidRequestDto,
      signal: AbortSignal,
    ) => client.post<SalesOrderDetailDto>(
      `sales-orders/${encodeURIComponent(salesOrderId)}/payments/${encodeURIComponent(paymentId)}/void`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    submitDeliveryReceipt: (
      salesOrderId: string,
      data: SalesOrderDeliveryReceiptRequestDto,
      signal: AbortSignal,
    ) => client.post<SalesOrderDetailDto>(
      `sales-orders/${encodeURIComponent(salesOrderId)}/delivery-receipts`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
  }
}

export default createSalesOrdersApi(api)
