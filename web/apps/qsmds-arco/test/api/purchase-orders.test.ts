import type { AxiosInstance } from 'axios'
import type {
  CreatePurchaseOrderRequestDto,
  PurchaseOrderDetailDto,
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

function createRecorder(calls: Call[], responseData: unknown = {}): AxiosInstance {
  const response = Promise.resolve({ data: responseData })
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

test('独立凭证归档使用专属接口，不自动重试且不提交付款 ID 或履约状态', async () => {
  const calls: Call[] = []
  const api = createPurchaseOrdersApi(createRecorder(calls))
  const signal = new AbortController().signal
  const data = { documentType: 'DELIVERY_RECEIPT' as const, mediaAssetId: 'media-id', remark: '归档' }
  await api.attachDocument('purchase/order', data, signal)
  assert.deepEqual(calls, [{
    method: 'post',
    url: 'purchase-orders/purchase%2Forder/documents',
    data,
    config: { errorPresentation: 'local', retry: false, signal },
  }])
})

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
  ] as const) {
    await api.sourceSalesOrders({
      view,
      keyword: 'SO-001',
      page: 1,
      pageSize: 20,
      productMode: 'CATALOG',
      supplierValue: 'SUPPLIER_CN_01',
    }, controller.signal)
  }
  await api.sourceSalesOrderLines('sales/order', {
    productMode: 'CUSTOM',
  }, controller.signal)
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
        productMode: 'CATALOG',
        supplierValue: 'SUPPLIER_CN_01',
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
        productMode: 'CATALOG',
        supplierValue: 'SUPPLIER_CN_01',
      },
      signal: controller.signal,
    },
    method: 'get',
    url: 'purchase-orders/source-sales-orders',
  }, {
    config: {
      errorPresentation: 'local',
      params: { productMode: 'CUSTOM' },
      signal: controller.signal,
    },
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
    expectedShippingMarkResolution: 'a'.repeat(64),
    customSupplierName: '临时供应商',
    productMode: 'CUSTOM',
    purchaseType: 'STOCK',
    orderDate: '2026-08-28',
    lines: [{
      lineType: 'CUSTOM',
      name: '备货包装',
      referencePurchaseUnitPriceAmount: '10.00',
      actualPurchaseUnitPriceAmount: '10.00',
      quantity: 1,
    }],
    parts: [{ key: '1752fcb7-0d41-4e90-98b6-54b046b71622', items: [{ lineNumber: 1, quantity: 1 }] }],
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
  await api.review('purchase/id', { expectedVersion: 3, reason: '核对无误' }, controller.signal)
  await api.updateOrderStatus('purchase/id', { toStatus: 'CANCELLED', reason: '终止采购' }, controller.signal)
  await api.updateFulfillmentStatus('purchase/id', { toStatus: 'ORDERED' }, controller.signal)
  await api.factoryShipment('purchase/id', {
    expectedVersion: 3,
    reason: '第一批出厂',
  }, controller.signal)
  await api.recordPayment('purchase/id', payment, controller.signal)
  await api.voidPayment('purchase/id', 'payment/id', { reason: '录入错误' }, controller.signal)
  await api.detachDocument('purchase/id', 'document/id', controller.signal)

  assert.deepEqual(calls.map(call => [call.method, call.url]), [
    ['post', 'purchase-orders'],
    ['post', 'purchase-orders/purchase%2Fid/review'],
    ['patch', 'purchase-orders/purchase%2Fid/order-status'],
    ['patch', 'purchase-orders/purchase%2Fid/fulfillment-status'],
    ['post', 'purchase-orders/purchase%2Fid/factory-shipments'],
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
  assert.deepEqual(calls[1]?.data, { expectedVersion: 3, reason: '核对无误' })
  for (const call of calls.slice(1)) {
    assert.deepEqual(call.config, {
      errorPresentation: 'local',
      retry: false,
      signal: controller.signal,
    })
  }
})

test('详情与审核响应保留基础码、可空货件码和服务端货件顺序，不在适配层派生唛头', async () => {
  const signal = new AbortController().signal
  const pending = {
    orderStatus: 'PENDING_REVIEW',
    shippingMarkText: null,
    shippingMarks: [],
    parts: [{ id: 'part-1', partNumber: 1, status: 'PENDING_REVIEW', shippingMarkText: null, items: [] }],
  } satisfies Pick<PurchaseOrderDetailDto, 'orderStatus' | 'shippingMarkText' | 'shippingMarks' | 'parts'>
  const api = createPurchaseOrdersApi(createRecorder([], pending))
  assert.deepEqual((await api.getById('pending', signal)).data, pending)
  const reviewed = {
    ...pending,
    orderStatus: 'CONFIRMED',
    shippingMarkText: 'BASE',
    shippingMarks: ['BASE/货件-01', 'BASE/货件-100'],
    parts: [
      { id: 'part-1', partNumber: 1, status: 'ACTIVE', shippingMarkText: 'BASE/货件-01', items: [] },
      { id: 'part-100', partNumber: 100, status: 'ACTIVE', shippingMarkText: 'BASE/货件-100', items: [] },
    ],
  } satisfies Pick<PurchaseOrderDetailDto, 'orderStatus' | 'shippingMarkText' | 'shippingMarks' | 'parts'>
  const calls: Call[] = []
  const reviewedApi = createPurchaseOrdersApi(createRecorder(calls, reviewed))
  assert.deepEqual((await reviewedApi.review('pending', { expectedVersion: 1 }, signal)).data, reviewed)
  assert.deepEqual(calls[0]?.data, { expectedVersion: 1 })
  assert.equal(Object.hasOwn(calls[0]?.data ?? {}, 'shippingMarkText'), false)
})

test('唛头匹配只读且仅传当前场景，不创建幂等键', async () => {
  const calls: Call[] = []
  const api = createPurchaseOrdersApi(createRecorder(calls))
  const signal = new AbortController().signal
  for (const query of [
    { productMode: 'CATALOG' as const, supplierValue: 'SUPPLIER_CN_01' },
    { productMode: 'CUSTOM' as const },
  ]) {
    await api.shippingMarkResolution(query, signal)
    assert.deepEqual(calls.at(-1), {
      method: 'get',
      url: 'purchase-orders/shipping-mark-resolution',
      config: { errorPresentation: 'local', params: query, signal },
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
