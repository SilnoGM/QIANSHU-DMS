import type { ProductMediaContentResponse } from './product-media-content.service'

export interface ProductMediaContentHttpResponse {
  setHeader(name: string, value: string): unknown
  status(statusCode: number): unknown
}

/**
 * 产品域和销售录单域共享同一响应头应用边界，避免两个 Controller 对 Range、
 * ETag 或 internal redirect 产生不同解释。undefined 头必须跳过，不能写入响应。
 */
export function applyProductMediaContentResponse(
  response: ProductMediaContentHttpResponse,
  result: ProductMediaContentResponse,
): void {
  response.status(result.status)
  for (const [name, value] of Object.entries(result.headers)) {
    if (value !== undefined) response.setHeader(name, value)
  }
}
