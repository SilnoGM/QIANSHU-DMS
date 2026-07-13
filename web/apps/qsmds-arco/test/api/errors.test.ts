import type {
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API 纯函数单元测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'

import { AxiosError, AxiosHeaders } from 'axios'

import {
  getApiClientErrorMessage,
  normalizeAxiosError,
} from '../../src/api/errors'

const validApiError = {
  code: 'VALIDATION_FAILED',
  fieldErrors: {
    email: ['邮箱格式不正确'],
  },
  message: '请检查输入内容',
  requestId: 'req_12345678-1234-4234-9234-123456789abc',
}

function createAxiosError(
  status: number,
  data: unknown,
  headers: AxiosResponse<unknown>['headers'] = {},
): AxiosError<unknown> {
  const config = {
    headers: new AxiosHeaders(),
  } as InternalAxiosRequestConfig
  const response: AxiosResponse<unknown> = {
    config,
    data,
    headers,
    status,
    statusText: 'Request failed',
  }

  return new AxiosError(
    'raw axios secret',
    AxiosError.ERR_BAD_RESPONSE,
    config,
    undefined,
    response,
  )
}

test('normalizeAxiosError 将可识别 JSON ApiError 转换为 http', async () => {
  const normalized = await normalizeAxiosError(
    createAxiosError(422, validApiError),
  )

  assert.deepEqual(normalized, {
    body: validApiError,
    kind: 'http',
    status: 422,
  })
  assert.equal(getApiClientErrorMessage(normalized), validApiError.message)
})

test('normalizeAxiosError 将可识别 JSON Blob ApiError 转换为 http', async () => {
  const normalized = await normalizeAxiosError(createAxiosError(
    500,
    new Blob([JSON.stringify(validApiError)], { type: 'text/plain' }),
    { 'Content-Type': 'application/problem+json; charset=utf-8' },
  ))

  assert.deepEqual(normalized, {
    body: validApiError,
    kind: 'http',
    status: 500,
  })
  assert.equal(getApiClientErrorMessage(normalized), validApiError.message)
})

test('normalizeAxiosError 将有 response 的不可信 body 转换为 http-unparseable', async () => {
  const normalized = await normalizeAxiosError(createAxiosError(
    500,
    '<html>raw server secret</html>',
    { 'x-request-id': 'req_from_response_header' },
  ))

  assert.deepEqual(normalized, {
    kind: 'http-unparseable',
    message: '服务器返回了无法识别的错误响应',
    requestId: 'req_from_response_header',
    status: 500,
  })
  assert.equal(
    getApiClientErrorMessage(normalized),
    '服务器返回了无法识别的错误响应',
  )
  assert.equal(JSON.stringify(normalized).includes('raw server secret'), false)
  assert.equal(JSON.stringify(normalized).includes('raw axios secret'), false)
})

test('normalizeAxiosError 在 Blob Content-Type 不可信时优先保留响应头 Request ID', async () => {
  const normalized = await normalizeAxiosError(createAxiosError(
    422,
    new Blob([JSON.stringify(validApiError)], { type: 'application/json' }),
    {
      'content-type': 'application/octet-stream',
      'X-Request-Id': 'req_header_wins',
    },
  ))

  assert.deepEqual(normalized, {
    kind: 'http-unparseable',
    message: '服务器返回了无法识别的错误响应',
    requestId: 'req_header_wins',
    status: 422,
  })
})

test('normalizeAxiosError 大小写不敏感读取 AxiosHeaders，但不将非 string Header 强制转换', async () => {
  const blobNormalized = await normalizeAxiosError(createAxiosError(
    500,
    new Blob([JSON.stringify(validApiError)]),
    new AxiosHeaders({ 'cOnTeNt-TyPe': 'application/json' }),
  ))
  assert.equal(blobNormalized.kind, 'http')

  const invalidRequestId = await normalizeAxiosError(createAxiosError(
    500,
    '<html>error</html>',
    { 'X-Request-Id': 123 },
  ))
  assert.deepEqual(invalidRequestId, {
    kind: 'http-unparseable',
    message: '服务器返回了无法识别的错误响应',
    status: 500,
  })
})

test('normalizeAxiosError 将抛错的 ApiError getter 与 headers.get 收敛为固定 http-unparseable', async () => {
  const throwingBody = Object.defineProperty({}, 'code', {
    enumerable: true,
    get: () => {
      throw new Error('raw ApiError getter secret')
    },
  })
  const throwingHeaders = {
    get: () => {
      throw new Error('raw headers.get secret')
    },
  } as unknown as AxiosResponse<unknown>['headers']

  for (const error of [
    createAxiosError(500, throwingBody),
    createAxiosError(
      500,
      new Blob([JSON.stringify(validApiError)]),
      throwingHeaders,
    ),
  ]) {
    const normalized = await normalizeAxiosError(error)
    assert.deepEqual(normalized, {
      kind: 'http-unparseable',
      message: '服务器返回了无法识别的错误响应',
      status: 500,
    })
    assert.equal(JSON.stringify(normalized).includes('raw'), false)
  }
})

test('normalizeAxiosError 将 response.data 或 headers getter 抛错收敛为固定 http-unparseable', async () => {
  const dataGetterError = createAxiosError(500, undefined)
  Object.defineProperty(dataGetterError.response, 'data', {
    get: () => {
      throw new Error('raw response.data secret')
    },
  })
  const headersGetterError = createAxiosError(500, '<html>error</html>')
  Object.defineProperty(headersGetterError.response, 'headers', {
    get: () => {
      throw new Error('raw response.headers secret')
    },
  })

  for (const error of [dataGetterError, headersGetterError]) {
    const normalized = await normalizeAxiosError(error)
    assert.deepEqual(normalized, {
      kind: 'http-unparseable',
      message: '服务器返回了无法识别的错误响应',
      status: 500,
    })
    assert.equal(JSON.stringify(normalized).includes('raw'), false)
  }
})

test('normalizeAxiosError 将大小写重复的 raw Content-Type 视为冲突', async () => {
  const normalized = await normalizeAxiosError(createAxiosError(
    500,
    new Blob([JSON.stringify(validApiError)]),
    {
      'Content-Type': 'application/json',
      'content-type': 'application/json',
    },
  ))

  assert.deepEqual(normalized, {
    kind: 'http-unparseable',
    message: '服务器返回了无法识别的错误响应',
    status: 500,
  })
})

test('normalizeAxiosError 仅在没有 response 时转换为 network', async () => {
  const rawError = new AxiosError(
    'raw network secret',
    AxiosError.ERR_NETWORK,
  )
  rawError.stack = 'raw stack secret'

  const normalized = await normalizeAxiosError(rawError)

  assert.deepEqual(normalized, {
    code: 'NETWORK_ERROR',
    kind: 'network',
    message: '网络连接失败，请稍后重试',
  })
  assert.equal(
    getApiClientErrorMessage(normalized),
    '网络连接失败，请稍后重试',
  )
  assert.equal(JSON.stringify(normalized).includes('raw network secret'), false)
  assert.equal(JSON.stringify(normalized).includes('raw stack secret'), false)
  assert.equal('status' in normalized, false)
})
