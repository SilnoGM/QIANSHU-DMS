import { applyDecorators } from '@nestjs/common'
import {
  ApiExtension,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
} from '@nestjs/swagger'

import { ApiError } from '../infrastructure/http/api-error.dto'
import {
  API_CONTRACT_ERROR_STATUSES,
  type ApiContractErrorMetadata,
  type ApiContractErrorStatus,
  type ApiApplicationContractOptions,
  type ApiSessionRequirement,
  type QianshuContractMetadata,
} from './contract-metadata'
import { ApiContractResponse } from './contract-response.decorator'
import {
  CSRF_HEADER_NAME,
  QIANSHU_CONTRACT_EXTENSION,
  SESSION_COOKIE_SECURITY_SCHEME,
} from './openapi.constants'

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/
const supportedErrorStatuses = new Set<number>(
  API_CONTRACT_ERROR_STATUSES,
)

function compareStableStrings(left: string, right: string): number {
  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

/**
 * 合并同一状态的多组错误码，并固定按 status、code 升序输出。
 * 这样 Controller 的声明顺序不会造成 OpenAPI snapshot 无意义漂移。
 */
function normalizeErrors(
  errors: ApiApplicationContractOptions['errors'],
): ApiContractErrorMetadata[] | undefined {
  if (errors === undefined) {
    return undefined
  }

  const codesByStatus = new Map<ApiContractErrorStatus, Set<string>>()

  for (const error of errors) {
    if (!supportedErrorStatuses.has(error.status)) {
      throw new Error(
        `OpenAPI contract error status is unsupported: ${String(error.status)}`,
      )
    }

    if (error.codes.length === 0) {
      throw new Error(
        `OpenAPI contract error codes cannot be empty for status ${String(error.status)}`,
      )
    }

    const codes = codesByStatus.get(error.status) ?? new Set<string>()

    for (const code of error.codes) {
      if (!ERROR_CODE_PATTERN.test(code)) {
        throw new Error(`OpenAPI contract error code is invalid: ${code}`)
      }

      codes.add(code)
    }

    codesByStatus.set(error.status, codes)
  }

  return [...codesByStatus.entries()]
    .sort(([left], [right]) => left - right)
    .map(([status, codes]) => ({
      status,
      codes: [...codes].sort(compareStableStrings),
    }))
}

function resolveSessionRequirement(
  options: ApiApplicationContractOptions,
): ApiSessionRequirement | undefined {
  if (
    options.session !== undefined &&
    options.authentication !== undefined &&
    options.authentication !== (options.session === 'required')
  ) {
    throw new Error(
      'OpenAPI authentication conflicts with Session requirement',
    )
  }

  return options.session ??
    (options.authentication === true ? 'required' : undefined)
}

function appendSessionSecurity(
  decorators: MethodDecorator[],
  session: ApiSessionRequirement | undefined,
): void {
  if (session === 'required') {
    decorators.push(ApiSecurity(SESSION_COOKIE_SECURITY_SCHEME))
    return
  }

  if (session === 'optional') {
    // OpenAPI 用空 security requirement 表示匿名分支，第二个分支接受 Session Cookie。
    decorators.push(
      ApiSecurity({}),
      ApiSecurity(SESSION_COOKIE_SECURITY_SCHEME),
    )
    return
  }

  if (session === 'none') {
    // Swagger decorator 先产生匿名 requirement；文档收口阶段再规范为显式 security: []。
    decorators.push(ApiSecurity({}))
  }
}

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
  const session = resolveSessionRequirement(options)

  if (
    options.authorization &&
    options.session === undefined &&
    options.authentication !== true
  ) {
    throw new Error('OpenAPI authorization requires authentication')
  }

  if (options.authorization && session !== 'required') {
    throw new Error(
      'OpenAPI authorization requires a required Session',
    )
  }

  const errors = normalizeErrors(options.errors)

  const metadata: QianshuContractMetadata = {
    kind: 'application',
    authentication: session === 'required',
    authorization: options.authorization ?? false,
    resourceLocator: options.resourceLocator ?? false,
    conflict: options.conflict ?? false,
    validation: options.validation ?? false,
  }

  if (options.session !== undefined) {
    metadata.session = options.session
  }

  if (options.csrf !== undefined) {
    metadata.csrf = options.csrf
  }

  if (options.privateNoStore !== undefined) {
    metadata.privateNoStore = options.privateNoStore
  }

  if (options.retry !== undefined) {
    metadata.retry = options.retry
  }

  if (errors !== undefined) {
    metadata.errors = errors
  }

  const decorators: MethodDecorator[] = [
    ApiOperation({ operationId: options.operationId }),
    ApiContract(metadata),
  ]

  appendSessionSecurity(decorators, session)

  if (options.csrf) {
    decorators.push(
      ApiHeader({
        name: CSRF_HEADER_NAME,
        required: true,
        schema: { type: 'string', enum: ['1'] },
      }),
    )
  }

  const errorStatuses = new Set<ApiContractErrorStatus>(
    errors?.map(({ status }) => status),
  )

  if (options.badRequest) {
    errorStatuses.add(400)
  }

  if (session === 'required') {
    errorStatuses.add(401)
  }

  if (options.authorization) {
    errorStatuses.add(403)
  }

  if (options.resourceLocator) {
    errorStatuses.add(404)
  }

  if (options.conflict) {
    errorStatuses.add(409)
  }

  if (options.validation) {
    errorStatuses.add(422)
  }

  // 应用操作始终保留未预期失败契约，不允许由调用者选择性省略 500。
  errorStatuses.add(500)

  for (const status of [...errorStatuses].sort((left, right) => left - right)) {
    decorators.push(ApiContractResponse({ status, type: ApiError }))
  }

  return applyDecorators(...decorators)
}
