import type { AxiosInstance } from 'axios'
import type {
  CreatePurchaseOrderRequestDto,
  PurchaseOrderPaymentRequestDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createPurchaseOrdersApi } from '../../src/api/modules/purchase-orders'

interface Call {
  readonly config?: unknown
  readonly data?: unknown
  readonly method: 'delete' | 'get' | 'head' | 'patch' | 'post'
  readonly url: string
}

function createRecorder(calls: Call[]): AxiosInstance {
  const response = Promise.resolve({ data: {} })
  return {
    delete(url: string, config?: unknown) {
      calls.push({ config, method: 'delete', url })
      return response
    },
    get(url: string, config?: unknown) {
      calls.push({ config, method: 'get', url })
      return response
    },
    head(url: string, config?: unknown) {
      calls.push({ config, method: 'head', url })
      return response
    },
    patch(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'patch', url })
      return response
    },
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'post', url })
      return response
    },
  } as unknown as AxiosInstance
}

test('采购查询与来源 loader 使用局部呈错、AbortSignal 和编码后的资源路径', async () => {
  const calls: Call[] = []
  const api = createPurchaseOrdersApi(createRecorder(calls))
  const controller = new AbortController()
  const listQuery = { view: 'pending' as const, page: 2, pageSize: 50 }

  await api.list(listQuery, controller.signal)
  const countQuery = { view: 'pending' as const, supplierValue: 'SUPPLIER_CN_01' }
  await api.statusCounts(countQuery, controller.signal)
  await api.productOptions({ supplierValue: 'SUPPLIER_CN_01', page: 1, pageSize: 20 }, controller.signal)
  for (const view of [
    'UNPURCHASED',
    'PARTIALLY_PURCHASED',
    'COMPLETED_PURCHASE_ADD_ON',
  ] as const) {
    await api.sourceSalesOrders({
      view,
      keyword: 'SO-001',
      page: 1,
      pageSize: 20,
    }, controller.signal)
  }
  await api.sourceSalesOrderLines('sales/order', controller.signal)
  await api.getById('purchase/order', controller.signal)

  assert.deepEqual(calls, [{
    config: { errorPresentation: 'local', params: listQuery, signal: controller.signal },
    method: 'get',
    url: 'purchase-orders',
  }, {
    config: {
      errorPresentation: 'local',
      params: countQuery,
      signal: controller.signal,
    },
    method: 'get',
    url: 'purchase-orders/status-counts',
  }, {
    config: {
      errorPresentation: 'local',
      params: { supplierValue: 'SUPPLIER_CN_01', page: 1, pageSize: 20 },
      signal: controller.signal,
    },
    method: 'get',
    url: 'purchase-orders/product-options',
  }, {
    config: {
      errorPresentation: 'local',
      params: {
        view: 'UNPURCHASED',
        keyword: 'SO-001',
        page: 1,
        pageSize: 20,
      },
      signal: controller.signal,
    },
    method: 'get',
    url: 'purchase-orders/source-sales-orders',
  }, {
    config: {
      errorPresentation: 'local',
      params: {
        view: 'PARTIALLY_PURCHASED',
        keyword: 'SO-001',
        page: 1,
        pageSize: 20,
      },
      signal: controller.signal,
    },
    method: 'get',
    url: 'purchase-orders/source-sales-orders',
  }, {
    config: {
      errorPresentation: 'local',
      params: {
        view: 'COMPLETED_PURCHASE_ADD_ON',
        keyword: 'SO-001',
        page: 1,
        pageSize: 20,
      },
      signal: controller.signal,
    },
    method: 'get',
    url: 'purchase-orders/source-sales-orders',
  }, {
    config: { errorPresentation: 'local', signal: controller.signal },
    method: 'get',
    url: 'purchase-orders/source-sales-orders/sales%2Forder/lines',
  }, {
    config: { errorPresentation: 'local', signal: controller.signal },
    method: 'get',
    url: 'purchase-orders/purchase%2Forder',
  }])
})

test('采购创建与所有 mutation 禁止自动重试并保持幂等 Key 生命周期', async () => {
  const calls: Call[] = []
  const api = createPurchaseOrdersApi(createRecorder(calls))
  const controller = new AbortController()
  const request = {
    purchaseType: 'STOCK',
    supplierValue: 'SUPPLIER_CN_01',
    orderDate: '2026-08-28',
    lines: [{
      lineType: 'CUSTOM',
      name: '备货包装',
      referencePurchaseUnitPriceAmount: '10.00',
      actualPurchaseUnitPriceAmount: '10.00',
      quantity: 1,
    }],
    purchaseTotalAmount: '10.00',
    depositDueAmount: '0.00',
    balanceDueAmount: '10.00',
  } satisfies CreatePurchaseOrderRequestDto
  const payment = {
    paymentType: 'BALANCE',
    amount: '10.00',
    paidAt: '2026-08-28T08:00:00.000Z',
    paymentMethod: 'BANK_TRANSFER',
  } satisfies PurchaseOrderPaymentRequestDto

  await api.create(request, '3e076569-95f2-4fce-8341-70bad4013da6', controller.signal)
  await api.updateOrderStatus('purchase/id', { toStatus: 'CANCELLED', reason: '终止采购' }, controller.signal)
  await api.updateFulfillmentStatus('purchase/id', { toStatus: 'ORDERED' }, controller.signal)
  await api.recordPayment('purchase/id', payment, controller.signal)
  await api.voidPayment('purchase/id', 'payment/id', { reason: '录入错误' }, controller.signal)
  await api.detachDocument('purchase/id', 'document/id', controller.signal)

  assert.deepEqual(calls.map(call => [call.method, call.url]), [
    ['post', 'purchase-orders'],
    ['patch', 'purchase-orders/purchase%2Fid/order-status'],
    ['patch', 'purchase-orders/purchase%2Fid/fulfillment-status'],
    ['post', 'purchase-orders/purchase%2Fid/payments'],
    ['post', 'purchase-orders/purchase%2Fid/payments/payment%2Fid/void'],
    ['delete', 'purchase-orders/purchase%2Fid/documents/document%2Fid'],
  ])
  assert.deepEqual(calls[0]?.config, {
    errorPresentation: 'local',
    headers: { 'Idempotency-Key': '3e076569-95f2-4fce-8341-70bad4013da6' },
    retry: false,
    signal: controller.signal,
  })
  for (const call of calls.slice(1)) {
    assert.deepEqual(call.config, {
      errorPresentation: 'local',
      retry: false,
      signal: controller.signal,
    })
  }
})

test('采购凭证上传和私有内容读取覆盖剩余公共操作', async () => {
  const calls: Call[] = []
  const api = createPurchaseOrdersApi(createRecorder(calls))
  const controller = new AbortController()
  const file = new File(['proof'], 'payment.png', { type: 'image/png' })

  await api.uploadTemporaryDocument(file, 'IMAGE', controller.signal)
  await api.headDocumentContent('purchase/id', 'document/id', controller.signal)
  await api.getDocumentContent('purchase/id', 'document/id', controller.signal)

  assert.equal(calls[0]?.method, 'post')
  assert.equal(calls[0]?.url, 'purchase-orders/document-uploads')
  assert.ok(calls[0]?.data instanceof FormData)
  assert.equal((calls[0]?.data as FormData).get('mediaType'), 'IMAGE')
  assert.equal(((calls[0]?.data as FormData).get('file') as File).name, 'payment.png')
  assert.deepEqual(calls[0]?.config, {
    errorPresentation: 'local',
    retry: false,
    signal: controller.signal,
  })
  assert.deepEqual(calls.slice(1), [{
    config: { errorPresentation: 'local', signal: controller.signal },
    method: 'head',
    url: 'purchase-orders/purchase%2Fid/documents/document%2Fid/content',
  }, {
    config: { errorPresentation: 'local', responseType: 'blob', signal: controller.signal },
    method: 'get',
    url: 'purchase-orders/purchase%2Fid/documents/document%2Fid/content',
  }])
})
