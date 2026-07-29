import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createCurrenciesApi } from '../../src/api/modules/currencies'

interface Call {
  method: 'get' | 'patch' | 'post'
  url: string
  data?: unknown
  config?: unknown
}

function createClientRecorder(): { calls: Call[], client: AxiosInstance } {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    get(url: string, config?: unknown) {
      calls.push({ method: 'get', url, config })
      return response
    },
    patch(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'patch', url, data, config })
      return response
    },
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'post', url, data, config })
      return response
    },
  } as unknown as AxiosInstance

  return { calls, client }
}

test('货币目录与管理只读 API 固定查询参数、signal 和本地错误展示', async () => {
  const fixture = createClientRecorder()
  const api = createCurrenciesApi(fixture.client)
  const catalogController = new AbortController()
  const listController = new AbortController()
  const detailController = new AbortController()

  await api.catalog.list(catalogController.signal)
  await api.currencies.list({
    page: 2,
    pageSize: 20,
    query: '美元',
    status: 'DISABLED',
  }, listController.signal)
  await api.currencies.get(
    'currency/id with spaces',
    detailController.signal,
  )

  assert.deepEqual(fixture.calls, [
    {
      method: 'get',
      url: 'currency-catalog',
      config: {
        errorPresentation: 'local',
        signal: catalogController.signal,
      },
    },
    {
      method: 'get',
      url: 'currencies',
      config: {
        errorPresentation: 'local',
        params: {
          page: 2,
          pageSize: 20,
          query: '美元',
          status: 'DISABLED',
        },
        signal: listController.signal,
      },
    },
    {
      method: 'get',
      url: 'currencies/currency%2Fid%20with%20spaces',
      config: {
        errorPresentation: 'local',
        signal: detailController.signal,
      },
    },
  ])
})

test('货币管理 mutation 携带 expectedVersion 并显式禁止自动重试', async () => {
  const fixture = createClientRecorder()
  const api = createCurrenciesApi(fixture.client)
  const createPayload = {
    code: 'JPY',
    englishName: 'Japanese Yen',
    minorUnit: 0,
    name: '日元',
    sortOrder: 50,
    symbol: '¥',
  }
  const updatePayload = {
    englishName: null,
    expectedVersion: 7,
    name: '日圆',
    sortOrder: 60,
    symbol: null,
  }
  const statusPayload = { expectedVersion: 8 }

  await api.currencies.create(createPayload)
  await api.currencies.update('currency/id', updatePayload)
  await api.currencies.enable('currency/id', statusPayload)
  await api.currencies.disable('currency/id', statusPayload)

  assert.deepEqual(fixture.calls, [
    {
      method: 'post',
      url: 'currencies',
      data: createPayload,
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
    {
      method: 'patch',
      url: 'currencies/currency%2Fid',
      data: updatePayload,
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
    {
      method: 'post',
      url: 'currencies/currency%2Fid/enable',
      data: statusPayload,
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
    {
      method: 'post',
      url: 'currencies/currency%2Fid/disable',
      data: statusPayload,
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
  ])
})

test('汇率管理 API 保持 DECIMAL 字符串并禁止写请求自动重试', async () => {
  const fixture = createClientRecorder()
  const api = createCurrenciesApi(fixture.client)
  const listController = new AbortController()
  const detailController = new AbortController()
  const createPayload = {
    currencyId: 'currency-id',
    foreignUnitsPerCny: '4.800000000000',
  }
  const updatePayload = {
    expectedVersion: 3,
    foreignUnitsPerCny: '4.900000000000',
  }

  await api.exchangeRates.list({
    page: 1,
    pageSize: 50,
    query: 'TWD',
    status: 'CONFIGURED',
  }, listController.signal)
  await api.exchangeRates.get(
    'rate/id with spaces',
    detailController.signal,
  )
  await api.exchangeRates.create(createPayload)
  await api.exchangeRates.update('rate/id', updatePayload)

  assert.deepEqual(fixture.calls, [
    {
      method: 'get',
      url: 'exchange-rates',
      config: {
        errorPresentation: 'local',
        params: {
          page: 1,
          pageSize: 50,
          query: 'TWD',
          status: 'CONFIGURED',
        },
        signal: listController.signal,
      },
    },
    {
      method: 'get',
      url: 'exchange-rates/rate%2Fid%20with%20spaces',
      config: {
        errorPresentation: 'local',
        signal: detailController.signal,
      },
    },
    {
      method: 'post',
      url: 'exchange-rates',
      data: createPayload,
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
    {
      method: 'patch',
      url: 'exchange-rates/rate%2Fid',
      data: updatePayload,
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
  ])
})
