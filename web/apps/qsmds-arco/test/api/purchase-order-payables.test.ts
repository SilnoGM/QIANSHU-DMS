import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证按采购单分页及付款请求不携带可修改金额，写入禁止自动重试。
import test from 'node:test'
import { createPurchaseOrderPayablesApi } from '../../src/api/modules/purchase-order-payables'

test('列表按采购单分页，付款保留幂等键与版本且不自动重试', async () => {
  const calls: unknown[][] = []
  const invoke = (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  }
  const client = { get: invoke, post: invoke }
  const api = createPurchaseOrderPayablesApi(client as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const query = { page: 2, pageSize: 20, keyword: 'PO/20260916-00016' }
  await api.list(query, signal)
  await api.get('payable/id', signal)
  const body = { expectedVersion: 3, paymentMethod: 'CASH', remark: null }
  await api.pay('payable/id', body, 'same-key', signal)
  assert.deepEqual(calls, [
    ['purchase-order-payables', { errorPresentation: 'local', params: query, signal }],
    ['purchase-order-payables/payable%2Fid', { errorPresentation: 'local', signal }],
    ['purchase-order-payables/payable%2Fid/pay', body, { errorPresentation: 'local', headers: { 'Idempotency-Key': 'same-key' }, retry: false, signal }],
  ])
})
