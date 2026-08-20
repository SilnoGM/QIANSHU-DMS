import type { AxiosInstance } from 'axios'
import type {
  CreateSalesOrderRequestDto,
  SalesOrderDetailDto,
  SalesOrderPageDto,
  SalesOrderProductOptionsDto,
  SalesOrdersListData,
  SalesOrderTemporaryDocumentDto,
} from '../generated/types.gen'

import api from '../index'

export type SalesOrderListQuery = NonNullable<SalesOrdersListData['query']>
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
    productOptions: (
      currencyCode: SalesOrderCurrency,
      keyword: string | undefined,
      signal: AbortSignal,
    ) => client.get<SalesOrderProductOptionsDto>('sales-orders/product-options', {
      errorPresentation: 'local',
      params: {
        currencyCode,
        ...(keyword === undefined ? {} : { keyword }),
      },
      signal,
    }),
    uploadTemporaryDocument: (
      file: File,
      mediaType: 'IMAGE' | 'DOCUMENT',
      signal: AbortSignal,
    ) => {
      const body = new FormData()
      // Server 的流式 parser 要求 mediaType field 位于单个 file part 之前。
      body.append('mediaType', mediaType)
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
  }
}

export default createSalesOrdersApi(api)
