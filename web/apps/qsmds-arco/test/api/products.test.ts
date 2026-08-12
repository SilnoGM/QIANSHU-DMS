import type { AxiosInstance } from 'axios'
import type { CreateProductRequestDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createProductsApi } from '../../src/api/modules/products'

interface Call {
  readonly config?: unknown
  readonly data?: unknown
  readonly method: 'get' | 'post'
  readonly url: string
}

test('产品 API 列表读取带精确 query、AbortSignal 与局部呈错', async () => {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    get(url: string, config?: unknown) {
      calls.push({ config, method: 'get', url })
      return response
    },
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'post', url })
      return response
    },
  } as unknown as AxiosInstance
  const products = createProductsApi(client)
  const controller = new AbortController()
  const query = {
    keyword: 'Product-001',
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
  assert.deepEqual(Object.keys(products), ['list', 'create'])
})

test('产品创建使用 generated DTO、内存幂等 Key、AbortSignal 且禁止自动重试', async () => {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    get() {
      return response
    },
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'post', url })
      return response
    },
  } as unknown as AxiosInstance
  const products = createProductsApi(client)
  const controller = new AbortController()
  const idempotencyKey = '3e076569-95f2-4fce-8341-70bad4013da6'
  const data: CreateProductRequestDto = {
    attributes: [{ title: '颜色', value: '黑色' }],
    myrSalePrice: { amount: '12.50', currency: 'MYR' },
    name: '产品',
    purchaseCost: { amount: '10.00', currency: 'CNY' },
    status: 'DRAFT',
    supplierValue: null,
    twdSalePrice: { amount: '88', currency: 'TWD' },
  }

  await products.create(data, idempotencyKey, controller.signal)

  assert.deepEqual(calls, [{
    config: {
      errorPresentation: 'local',
      headers: { 'Idempotency-Key': idempotencyKey },
      retry: false,
      signal: controller.signal,
    },
    data,
    method: 'post',
    url: 'products',
  }])
})
