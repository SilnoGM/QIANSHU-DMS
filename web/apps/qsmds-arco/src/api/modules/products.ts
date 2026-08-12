import type { AxiosInstance } from 'axios'
import type {
  ProductPageDto,
  ProductsListData,
} from '../generated/types.gen'

import api from '../index'

export type ProductListQuery = NonNullable<ProductsListData['query']>

/**
 * 产品首期 API 只有列表读取。factory 供 Node 契约测试注入 recorder；正式运行
 * 复用应用级 Axios client，并由页面持有 AbortSignal 与局部错误呈现责任。
 */
export function createProductsApi(client: AxiosInstance) {
  return {
    list: (query: ProductListQuery, signal: AbortSignal) =>
      client.get<ProductPageDto>('products', {
        errorPresentation: 'local',
        params: query,
        signal,
      }),
  }
}

export default createProductsApi(api)
