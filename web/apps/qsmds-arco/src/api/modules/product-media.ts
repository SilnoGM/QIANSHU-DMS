import type {
  AxiosInstance,
  AxiosProgressEvent,
  AxiosResponse,
} from 'axios'
import type {
  ProductListItemDto,
  ProductMediaDetachRequestDto,
  ProductMediaItemDto,
  ProductMediaLayoutRequestDto,
  ProductMediaUploadRequestDto,
  ProductMediaUploadResponseDto,
} from '../generated/types.gen'

import api from '../index'

export interface ProductMediaUploadOptions {
  readonly onUploadProgress: (event: AxiosProgressEvent) => void
  readonly signal: AbortSignal
}

type ProductMediaContentIdentity = Pick<
  ProductMediaItemDto,
  'contentUrl' | 'id'
>

/**
 * ProductMedia 的 contentUrl 是受保护的同源领域路由，不是任意外部 URL。
 * 调用方必须同时持有当前 Product 与 ProductMedia stable ID；服务端值若与
 * 唯一合法路径不一致，Web 失败关闭，不把不可信地址交给 DOM。
 */
export function resolveProductMediaContentUrl(
  productId: string,
  media: ProductMediaContentIdentity,
): string | null {
  const expected = `/api/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(media.id)}/content`
  return media.contentUrl === expected ? expected : null
}

/**
 * 产品媒体 API 只使用 generated DTO 作为传输合同。所有 mutation 都没有
 * 幂等键，网络或 5xx 后必须 GET 对账，因此这里固定 `retry:false`。
 */
export function createProductMediaApi(client: AxiosInstance) {
  return {
    upload: (
      productId: string,
      data: ProductMediaUploadRequestDto,
      options: ProductMediaUploadOptions,
    ): Promise<AxiosResponse<ProductMediaUploadResponseDto>> => {
      const formData = new FormData()
      // Server 的 streaming parser 要求两个小字段先于 file part，顺序不可交换。
      formData.append('kind', data.kind)
      formData.append('expectedVersion', data.expectedVersion)
      formData.append('file', data.file)
      return client.post<ProductMediaUploadResponseDto>(
        `products/${encodeURIComponent(productId)}/media`,
        formData,
        {
          errorPresentation: 'local',
          onUploadProgress: options.onUploadProgress,
          retry: false,
          signal: options.signal,
        },
      )
    },
    updateLayout: (
      productId: string,
      data: ProductMediaLayoutRequestDto,
      signal: AbortSignal,
    ): Promise<AxiosResponse<ProductListItemDto>> =>
      client.put<ProductListItemDto>(
        `products/${encodeURIComponent(productId)}/media/layout`,
        data,
        {
          errorPresentation: 'local',
          retry: false,
          signal,
        },
      ),
    detach: (
      productId: string,
      productMediaId: string,
      data: ProductMediaDetachRequestDto,
      signal: AbortSignal,
    ): Promise<AxiosResponse<ProductListItemDto>> =>
      client.delete<ProductListItemDto>(
        `products/${encodeURIComponent(productId)}/media/${encodeURIComponent(productMediaId)}`,
        {
          data,
          errorPresentation: 'local',
          retry: false,
          signal,
        },
      ),
  }
}

export default createProductMediaApi(api)
