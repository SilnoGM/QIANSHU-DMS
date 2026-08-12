import type { AxiosInstance } from 'axios'
import type {
  CreateProductRequestDto,
  ProductListItemDto,
  ProductPageDto,
  ProductsListData,
} from '../generated/types.gen'

import api from '../index'

export type ProductListQuery = NonNullable<ProductsListData['query']>

/**
 * 产品 API 只使用 OpenAPI generated types 作为传输契约。factory 供 Node
 * 契约测试注入 recorder；正式运行复用应用级 Axios client。创建请求
 * 禁止 client 自动重试，结果未知时由页面使用同一 Key/Payload 人工重放。
 */
export function createProductsApi(client: AxiosInstance) {
  return {
    list: (query: ProductListQuery, signal: AbortSignal) =>
      client.get<ProductPageDto>('products', {
        errorPresentation: 'local',
        params: query,
        signal,
      }),
    create: (
      data: CreateProductRequestDto,
      idempotencyKey: string,
      signal: AbortSignal,
    ) => client.post<ProductListItemDto>('products', data, {
      errorPresentation: 'local',
      headers: { 'Idempotency-Key': idempotencyKey },
      retry: false,
      signal,
    }),
  }
}

export default createProductsApi(api)
