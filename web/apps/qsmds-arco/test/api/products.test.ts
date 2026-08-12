import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createProductsApi } from '../../src/api/modules/products'

interface Call {
  readonly config?: unknown
  readonly method: 'get'
  readonly url: string
}

test('产品 API 只暴露一个带精确 query、AbortSignal 与局部呈错的 GET', async () => {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    get(url: string, config?: unknown) {
      calls.push({ config, method: 'get', url })
      return response
    },
  } as unknown as AxiosInstance
  const products = createProductsApi(client)
  const controller = new AbortController()
  const query = {
    page: 2,
    pageSize: 50,
    supplierValue: ' raw-supplier ',
  }

  await products.list(query, controller.signal)

  assert.deepEqual(calls, [{
    config: {
      errorPresentation: 'local',
      params: query,
      signal: controller.signal,
    },
    method: 'get',
    url: 'products',
  }])
  assert.deepEqual(Object.keys(products), ['list'])
})
