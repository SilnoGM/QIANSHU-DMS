import {
  ApiResponse,
  type ApiResponseOptions,
} from '@nestjs/swagger'

import { REQUEST_ID_HEADER } from '../app.constants'

const HTTP_NO_CONTENT = 204

function hasOwnProperty(
  value: object,
  property: PropertyKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, property)
}

/**
 * 为已声明响应统一补充 Request ID Header，同时在定义阶段拒绝带 body 的 204。
 * 该约束靠 decorator 集中执行，避免不同 Controller 各自复制 Header 或误写空响应。
 */
export function ApiContractResponse(
  options: ApiResponseOptions,
): MethodDecorator {
  if (
    options.status === HTTP_NO_CONTENT &&
    (hasOwnProperty(options, 'type') ||
      hasOwnProperty(options, 'schema') ||
      hasOwnProperty(options, 'content'))
  ) {
    throw new Error('OpenAPI 204 response cannot declare a body')
  }

  return ApiResponse({
    ...options,
    headers: {
      ...options.headers,
      [REQUEST_ID_HEADER]: { schema: { type: 'string' } },
    },
  })
}
