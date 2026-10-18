import type { AxiosInstance } from 'axios'
import type {
  CreateProductRequestDto,
  UpdateProductRequestDto,
  UpdateProductStatusRequestDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createProductsApi } from '../../src/api/modules/products'

interface Call {
  readonly config?: unknown
  readonly data?: unknown
  readonly method: 'get' | 'patch' | 'post'
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
    patch(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'patch', url })
      return response
    },
  } as unknown as AxiosInstance
  const products = createProductsApi(client)
  const controller = new AbortController()
  const query = {
    keyword: 'Product-001',
    categoryName: '微耕机',
    productHeadName: '旱地履带',
    page: 2,
    pageSize: 50,
    status: 'ACTIVE' as const,
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
  assert.deepEqual(Object.keys(products), [
    'list',
    'getById',
    'taxonomyOptions',
    'create',
    'update',
    'updateStatus',
  ])

  await products.taxonomyOptions(controller.signal)
  assert.deepEqual(calls[1], {
    config: {
      errorPresentation: 'local',
      signal: controller.signal,
    },
    method: 'get',
    url: 'products/taxonomy-options',
  })
})

test('产品详情与编辑使用资源路径、AbortSignal、局部呈错且 PATCH 禁止自动重试', async () => {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    get(url: string, config?: unknown) {
      calls.push({ config, method: 'get', url })
      return response
    },
    patch(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'patch', url })
      return response
    },
    post() {
      return response
    },
  } as unknown as AxiosInstance
  const products = createProductsApi(client)
  const controller = new AbortController()
  const productId = '11111111-1111-4111-8111-111111111111'
  const update: UpdateProductRequestDto = {
    expectedVersion: 1,
    name: '新产品',
  }
  const updateStatus: UpdateProductStatusRequestDto = {
    expectedVersion: 2,
    status: 'INACTIVE',
  }

  await products.getById(productId, controller.signal)
  await products.update(productId, update, controller.signal)
  await products.updateStatus(productId, updateStatus, controller.signal)

  assert.deepEqual(calls, [
    {
      config: {
        errorPresentation: 'local',
        signal: controller.signal,
      },
      method: 'get',
      url: `products/${productId}`,
    },
    {
      config: {
        errorPresentation: 'local',
        retry: false,
        signal: controller.signal,
      },
      data: update,
      method: 'patch',
      url: `products/${productId}`,
    },
    {
      config: {
        errorPresentation: 'local',
        retry: false,
        signal: controller.signal,
      },
      data: updateStatus,
      method: 'patch',
      url: `products/${productId}/status`,
    },
  ])
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
