import type { AxiosError } from 'axios'
import type { ApiError } from './api-error'

import { isApiError } from './api-error'
import { parseBlobApiError } from './blob-error'

const HTTP_UNPARSEABLE_MESSAGE = '服务器返回了无法识别的错误响应' as const
const NETWORK_ERROR_MESSAGE = '网络连接失败，请稍后重试' as const

export type ApiClientError
  = | {
    kind: 'http'
    status: number
    body: ApiError
  }
  | {
    kind: 'http-unparseable'
    status: number
    requestId?: string
    message: typeof HTTP_UNPARSEABLE_MESSAGE
  }
  | {
    kind: 'network'
    code: 'NETWORK_ERROR'
    message: typeof NETWORK_ERROR_MESSAGE
  }

function readStringHeader(
  headers: unknown,
  expectedName: string,
): string | undefined {
  try {
    if (typeof headers !== 'object' || headers === null) {
      return undefined
    }

    const headerContainer = headers as {
      get?: (name: string) => unknown
      [key: string]: unknown
    }
    const getHeader = headerContainer.get
    if (typeof getHeader === 'function') {
      const value = getHeader.call(headers, expectedName)
      return typeof value === 'string' ? value : undefined
    }

    const normalizedName = expectedName.toLowerCase()
    let matched = false
    let matchedValue: string | undefined
    for (const [name, value] of Object.entries(headerContainer)) {
      if (name.toLowerCase() !== normalizedName) {
        continue
      }
      // raw object 中出现大小写重复键时无法确定适配器的最终值，统一视为冲突。
      if (matched) {
        return undefined
      }
      matched = true
      matchedValue = typeof value === 'string' ? value : undefined
    }

    return matchedValue
  }
  catch {
    return undefined
  }
}

function readSafely<T>(reader: () => T): T | undefined {
  try {
    return reader()
  }
  catch {
    return undefined
  }
}

/**
 * 将已经排除取消、且重试机会已耗尽的 AxiosError 收敛为安全的领域错误。
 *
 * 返回值绝不复制 Axios message、stack 或不可信 body，保证上层 toast 只能读到契约消息或固定文案。
 */
export async function normalizeAxiosError(
  error: AxiosError<unknown>,
): Promise<ApiClientError> {
  const response = error.response
  if (response === undefined) {
    return {
      code: 'NETWORK_ERROR',
      kind: 'network',
      message: NETWORK_ERROR_MESSAGE,
    }
  }

  const responseData = readSafely(() => response.data)
  const responseHeaders = readSafely(() => response.headers)
  let body: ApiError | undefined
  if (isApiError(responseData)) {
    body = responseData
  }
  else {
    body = await parseBlobApiError(
      responseData,
      readStringHeader(responseHeaders, 'Content-Type'),
    )
  }

  if (body !== undefined) {
    return {
      body,
      kind: 'http',
      status: response.status,
    }
  }

  const requestId = readStringHeader(responseHeaders, 'X-Request-Id')
  return {
    kind: 'http-unparseable',
    message: HTTP_UNPARSEABLE_MESSAGE,
    ...(requestId === undefined ? {} : { requestId }),
    status: response.status,
  }
}

/** 统一提取可展示文案，http 分支的 message 位于 body 而非错误顶层。 */
export function getApiClientErrorMessage(error: ApiClientError): string {
  return error.kind === 'http' ? error.body.message : error.message
}
