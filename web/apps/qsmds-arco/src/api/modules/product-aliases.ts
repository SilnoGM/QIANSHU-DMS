import type { AxiosInstance } from 'axios'
import type {
  ProductAliasDto,
  ProductAliasListDto,
} from '../generated/types.gen'

import api from '../index'

/**
 * 个人产品别名 API：路径固定为 mine，服务端从登录上下文取用户，
 * 前端不传用户 ID。状态变更失败后由用户重试，不做自动 retry。
 */
export function createProductAliasesApi(client: AxiosInstance) {
  return {
    listMine: (productIds: readonly string[], signal: AbortSignal) =>
      client.get<ProductAliasListDto>('product-aliases/mine', {
        errorPresentation: 'local',
        params: productIds.length === 0 ? {} : { productIds: productIds.join(',') },
        signal,
      }),
    upsert: (productId: string, alias: string, signal: AbortSignal) =>
      client.put<ProductAliasDto>(
        `product-aliases/mine/${encodeURIComponent(productId)}`,
        { alias },
        {
          errorPresentation: 'local',
          retry: false,
          signal,
        },
      ),
    clear: (productId: string, signal: AbortSignal) =>
      client.delete<void>(
        `product-aliases/mine/${encodeURIComponent(productId)}`,
        {
          data: {},
          errorPresentation: 'local',
          retry: false,
          signal,
        },
      ),
  }
}

export default createProductAliasesApi(api)
