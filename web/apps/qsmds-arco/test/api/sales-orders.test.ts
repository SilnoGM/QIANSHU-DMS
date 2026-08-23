import type { AxiosInstance } from 'axios'
import type { CreateSalesOrderRequestDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createSalesOrdersApi } from '../../src/api/modules/sales-orders'

interface Call {
  readonly config?: unknown
  readonly data?: unknown
  readonly method: 'get' | 'post'
  readonly url: string
}

function createRecorder(calls: Call[]): AxiosInstance {
  const response = Promise.resolve({ data: {} })
  return {
    get(url: string, config?: unknown) {
      calls.push({ config, method: 'get', url })
      return response
    },
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'post', url })
      return response
    },
  } as unknown as AxiosInstance
}

test('销售订单列表和产品选项固定使用 query、AbortSignal 与局部呈错', async () => {
  const calls: Call[] = []
  const api = createSalesOrdersApi(createRecorder(calls))
  const controller = new AbortController()
  const query = {
    currencyCode: 'TWD' as const,
    keyword: 'SO-001',
    page: 2,
    pageSize: 50,
  }

  await api.list(query, controller.signal)
  const productQuery = {
    currencyCode: 'MYR' as const,
    keyword: '包',
    supplierValue: 'SUPPLIER_MY_01',
    page: 3,
    pageSize: 20,
  }
  await api.productOptions(productQuery, controller.signal)

  assert.deepEqual(calls, [
    {
      config: {
        errorPresentation: 'local',
        params: query,
        signal: controller.signal,
      },
      method: 'get',
      url: 'sales-orders',
    },
    {
      config: {
        errorPresentation: 'local',
        params: productQuery,
        signal: controller.signal,
      },
      method: 'get',
      url: 'sales-orders/product-options',
    },
  ])
})

test('正式保存才携带幂等 Key，禁止自动重试且保留 frozen DTO', async () => {
  const calls: Call[] = []
  const api = createSalesOrdersApi(createRecorder(calls))
  const controller = new AbortController()
  const request = {
    orderDate: '2026-08-20',
    currencyCode: 'TWD',
    customer: {
      name: '王小明',
      phone: '0912345678',
      countryRegionId: '11111111-1111-4111-8111-111111111111',
      provinceStateId: '22222222-2222-4222-8222-222222222222',
      cityId: '33333333-3333-4333-8333-333333333333',
      addressDetail: '苓雅区中正一路100号3楼',
    },
    lines: [{
      lineType: 'CUSTOM',
      name: '临时产品',
      description: null,
      actualUnitPriceAmount: '100.0000',
      quantity: 1,
    }],
    agreedTotalAmount: '100.0000',
    depositDueAmount: '30.0000',
    balanceDueAmount: '70.0000',
    documents: [],
    remark: null,
  } satisfies CreateSalesOrderRequestDto

  await api.create(
    request,
    '3e076569-95f2-4fce-8341-70bad4013da6',
    controller.signal,
  )

  assert.deepEqual(calls, [{
    config: {
      errorPresentation: 'local',
      headers: { 'Idempotency-Key': '3e076569-95f2-4fce-8341-70bad4013da6' },
      retry: false,
      signal: controller.signal,
    },
    data: request,
    method: 'post',
    url: 'sales-orders',
  }])
})

test('临时凭证上传只发送 multipart，不携带订单编号或幂等 Key', async () => {
  const calls: Call[] = []
  const api = createSalesOrdersApi(createRecorder(calls))
  const controller = new AbortController()
  const file = new File(['proof'], 'deposit.png', { type: 'image/png' })

  await api.uploadTemporaryDocument(file, 'IMAGE', controller.signal)

  assert.equal(calls.length, 1)
  const call = calls[0]!
  assert.equal(call.method, 'post')
  assert.equal(call.url, 'sales-orders/document-uploads')
  assert.deepEqual(call.config, {
    errorPresentation: 'local',
    retry: false,
    signal: controller.signal,
  })
  assert.ok(call.data instanceof FormData)
  assert.equal(call.data.get('mediaType'), 'IMAGE')
  assert.equal((call.data.get('file') as File).name, 'deposit.png')
})
