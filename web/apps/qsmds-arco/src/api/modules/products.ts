import type { AxiosInstance } from 'axios'
import type {
  CreateProductRequestDto,
  ProductListItemDto,
  ProductPageDto,
  ProductsListData,
  ProductTaxonomyOptionsDto,
  UpdateProductRequestDto,
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
    getById: (productId: string, signal: AbortSignal) =>
      client.get<ProductListItemDto>(
        `products/${encodeURIComponent(productId)}`,
        {
          errorPresentation: 'local',
          signal,
        },
      ),
    taxonomyOptions: (signal: AbortSignal) =>
      client.get<ProductTaxonomyOptionsDto>('products/taxonomy-options', {
        errorPresentation: 'local',
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
    update: (
      productId: string,
      data: UpdateProductRequestDto,
      signal: AbortSignal,
    ) => client.patch<ProductListItemDto>(
      `products/${encodeURIComponent(productId)}`,
      data,
      {
        errorPresentation: 'local',
        // PATCH 没有幂等键；网络/5xx 后只能 GET 对账，绝不自动重放写请求。
        retry: false,
        signal,
      },
    ),
  }
}

export default createProductsApi(api)
