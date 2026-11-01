import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createShipmentStorageApi } from '../../src/api/modules/shipment-storage'

interface Call {
  readonly data?: unknown
  readonly method: 'get' | 'post'
  readonly url: string
}

function createRecorder(calls: Call[]): AxiosInstance {
  const response = Promise.resolve({ data: {} })
  return {
    get(url: string) {
      calls.push({ method: 'get', url })
      return response
    },
    post(url: string, data?: unknown) {
      calls.push({ data, method: 'post', url })
      return response
    },
  } as unknown as AxiosInstance
}

test('调货申请撤回与同意使用 JSON 请求体，避免 CSRF 来源校验拒绝', async () => {
  const calls: Call[] = []
  const api = createShipmentStorageApi(createRecorder(calls))
  const controller = new AbortController()

  await api.withdrawClaimRequest('storage-1', 'request-1', controller.signal)
  await api.approveClaimRequest('storage-1', 'request-1', controller.signal)

  assert.deepEqual(calls, [
    {
      data: {},
      method: 'post',
      url: 'shipment-storage/storage-1/claim-requests/request-1/withdraw',
    },
    {
      data: {},
      method: 'post',
      url: 'shipment-storage/storage-1/claim-requests/request-1/approve',
    },
  ])
})
