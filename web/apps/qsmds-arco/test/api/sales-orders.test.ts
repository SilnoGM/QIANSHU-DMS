import type { AxiosInstance } from 'axios'
import type {
  CreateSalesOrderRequestDto,
  SalesOrderProductsUpdateRequestDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createSalesOrdersApi } from '../../src/api/modules/sales-orders'

interface Call {
  readonly config?: unknown
  readonly data?: unknown
  readonly method: 'get' | 'patch' | 'post'
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
    patch(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'patch', url })
      return response
    },
  } as unknown as AxiosInstance
}

test('销售订单列表、状态计数和产品选项固定使用 query、AbortSignal 与局部呈错', async () => {
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
  const countQuery = { view: 'all' as const, currencyCode: 'TWD' as const }
  await api.statusCounts(countQuery, controller.signal)
  await api.issuerOptions(controller.signal)
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
        params: countQuery,
        signal: controller.signal,
      },
      method: 'get',
      url: 'sales-orders/status-counts',
    },
    {
      config: {
        errorPresentation: 'local',
        signal: controller.signal,
      },
      method: 'get',
      url: 'sales-orders/issuer-options',
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
      actualUnitPriceAmount: '100.00',
      quantity: 1,
    }],
    agreedTotalAmount: '100.0000',
    depositDueAmount: '30.0000',
    balanceDueAmount: '70.0000',
    issuanceVoucher: {
      mediaAssetId: '55555555-5555-4555-8555-555555555555',
    },
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

test('收款、作废和货物签收 mutation 均局部呈错且禁止自动重试', async () => {
  const calls: Call[] = []
  const api = createSalesOrdersApi(createRecorder(calls))
  const controller = new AbortController()
  const payment = {
    paymentType: 'INVOICE_TAX' as const,
    amount: '10.0000',
    receivedAt: '2026-08-20T07:00:00.000Z',
    paymentMethod: 'BANK_TRANSFER',
    remark: null,
    voucher: { mediaAssetId: '55555555-5555-4555-8555-555555555555' },
  }

  await api.recordPayment('order/id', payment, controller.signal)
  await api.voidPayment('order/id', 'payment/id', { reason: '录入错误' }, controller.signal)
  await api.submitDeliveryReceipt('order/id', {
    mediaAssetId: '66666666-6666-4666-8666-666666666666',
    remark: '外箱完好',
  }, controller.signal)

  const config = {
    errorPresentation: 'local',
    retry: false,
    signal: controller.signal,
  }
  assert.deepEqual(calls, [{
    config,
    data: payment,
    method: 'post',
    url: 'sales-orders/order%2Fid/payments',
  }, {
    config,
    data: { reason: '录入错误' },
    method: 'post',
    url: 'sales-orders/order%2Fid/payments/payment%2Fid/void',
  }, {
    config,
    data: {
      mediaAssetId: '66666666-6666-4666-8666-666666666666',
      remark: '外箱完好',
    },
    method: 'post',
    url: 'sales-orders/order%2Fid/delivery-receipts',
  }])
})

test('销售工厂发货读取最新上下文并以单次无重试 mutation 提交完整目标', async () => {
  const calls: Call[] = []
  const api = createSalesOrdersApi(createRecorder(calls))
  const controller = new AbortController()
  const request = {
    mode: 'SELECTED' as const,
    targets: [{
      purchaseOrderId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 4,
    }],
    reason: '华东工厂第一批',
  }

  await api.factoryShipmentContext('sales/order', controller.signal)
  await api.factoryShipment('sales/order', request, controller.signal)

  assert.deepEqual(calls, [{
    config: {
      errorPresentation: 'local',
      signal: controller.signal,
    },
    method: 'get',
    url: 'sales-orders/sales%2Forder/factory-shipment-context',
  }, {
    config: {
      errorPresentation: 'local',
      retry: false,
      signal: controller.signal,
    },
    data: request,
    method: 'post',
    url: 'sales-orders/sales%2Forder/factory-shipments',
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

test('销售产品修改读取不依赖供应商，PATCH 写入局部呈错且绝不自动重试', async () => {
  const calls: Call[] = []
  const api = createSalesOrdersApi(createRecorder(calls))
  const controller = new AbortController()
  const request = {
    expectedVersion: 4,
    reason: '客户调整产品',
    confirmDepositReduction: false,
    existingLines: [{
      lineId: '22222222-2222-4222-8222-222222222222',
      name: '销售产品快照',
      description: null,
      actualUnitPriceAmount: '120.00',
      desiredQuantity: 2,
    }],
    newLines: [{
      lineType: 'CATALOG',
      productId: '11111111-1111-4111-8111-111111111111',
      actualUnitPriceAmount: '120.00',
      quantity: 1,
    }, {
      lineType: 'CUSTOM',
      name: '安装服务',
      description: null,
      actualUnitPriceAmount: '30.00',
      quantity: 2,
    }],
  } satisfies SalesOrderProductsUpdateRequestDto

  await api.productEditContext('sales/order', controller.signal)
  await api.productEditOptions('sales/order', {
    keyword: '组合柜',
    page: 2,
    pageSize: 20,
  }, controller.signal)
  await api.updateProducts('sales/order', request, controller.signal)

  assert.deepEqual(calls, [{
    config: {
      errorPresentation: 'local',
      signal: controller.signal,
    },
    method: 'get',
    url: 'sales-orders/sales%2Forder/product-edit-context',
  }, {
    config: {
      errorPresentation: 'local',
      params: {
        keyword: '组合柜',
        page: 2,
        pageSize: 20,
      },
      signal: controller.signal,
    },
    method: 'get',
    url: 'sales-orders/sales%2Forder/product-edit-options',
  }, {
    config: {
      errorPresentation: 'local',
      retry: false,
      signal: controller.signal,
    },
    data: request,
    method: 'patch',
    url: 'sales-orders/sales%2Forder/products',
  }])
})
