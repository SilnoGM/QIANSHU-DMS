import { applyDecorators } from '@nestjs/common'
import {
  ApiExtension,
  ApiOperation,
} from '@nestjs/swagger'

import { ApiError } from '../infrastructure/http/api-error.dto'
import {
  type ApiApplicationContractOptions,
  type QianshuContractMetadata,
} from './contract-metadata'
import { ApiContractResponse } from './contract-response.decorator'
import { QIANSHU_CONTRACT_EXTENSION } from './openapi.constants'

export function ApiContract(
  metadata: QianshuContractMetadata,
): MethodDecorator {
  return ApiExtension(QIANSHU_CONTRACT_EXTENSION, metadata)
}

/**
 * 将应用操作的稳定 operationId、契约判定元数据和必要错误矩阵绑定在一起。
 * authorization 必须建立在 authentication 之上；在 decorator 创建时失败可阻止
 * 不自洽的契约进入文档与后续生成链路。
 */
export function ApiApplicationContract(
  options: ApiApplicationContractOptions,
): MethodDecorator {
  if (options.authorization && options.authentication !== true) {
    throw new Error('OpenAPI authorization requires authentication')
  }

  const metadata: QianshuContractMetadata = {
    kind: 'application',
    authentication: options.authentication ?? false,
    authorization: options.authorization ?? false,
    resourceLocator: options.resourceLocator ?? false,
    conflict: options.conflict ?? false,
    validation: options.validation ?? false,
  }
  const decorators: MethodDecorator[] = [
    ApiOperation({ operationId: options.operationId }),
    ApiContract(metadata),
  ]

  if (options.badRequest) {
    decorators.push(ApiContractResponse({ status: 400, type: ApiError }))
  }

  if (options.authentication) {
    decorators.push(ApiContractResponse({ status: 401, type: ApiError }))
  }

  if (options.authorization) {
    decorators.push(ApiContractResponse({ status: 403, type: ApiError }))
  }

  if (options.resourceLocator) {
    decorators.push(ApiContractResponse({ status: 404, type: ApiError }))
  }

  if (options.conflict) {
    decorators.push(ApiContractResponse({ status: 409, type: ApiError }))
  }

  if (options.validation) {
    decorators.push(ApiContractResponse({ status: 422, type: ApiError }))
  }

  // 应用操作始终保留未预期失败契约，不允许由调用者选择性省略 500。
  decorators.push(ApiContractResponse({ status: 500, type: ApiError }))

  return applyDecorators(...decorators)
}
