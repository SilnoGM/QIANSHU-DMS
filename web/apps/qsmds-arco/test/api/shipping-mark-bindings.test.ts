import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 使用现有无浏览器契约测试入口。
import test from 'node:test'
import { createShippingMarkBindingsApi } from '../../src/api/modules/shipping-mark-bindings'

test('绑定 API 使用本地错误、可取消 GET、禁重试 PUT 与 URL 编码', async () => {
  const calls: unknown[] = []
  const response = { data: { items: [], total: 0 } }
  const client = {
    get: (...args: unknown[]) => {
      calls.push(['get', ...args])
      return Promise.resolve(response)
    },
    put: (...args: unknown[]) => {
      calls.push(['put', ...args])
      return Promise.resolve(response)
    },
  } as unknown as AxiosInstance
  const api = createShippingMarkBindingsApi(client)
  const signal = new AbortController().signal
  assert.equal(await api.list({ page: 1, pageSize: 20 }, signal), response)
  await api.options({ page: 2, keyword: 'WGJ' }, signal)
  await api.save('supplier/a', { ruleId: 'rule-id', expectedVersion: 2 })
  assert.deepEqual(calls, [
    ['get', 'purchase-shipping-mark-bindings', { params: { page: 1, pageSize: 20 }, signal, errorPresentation: 'local' }],
    ['get', 'purchase-shipping-mark-bindings/rule-options', { params: { page: 2, keyword: 'WGJ' }, signal, errorPresentation: 'local' }],
    ['put', 'purchase-shipping-mark-bindings/supplier%2Fa', { ruleId: 'rule-id', expectedVersion: 2 }, { errorPresentation: 'local', retry: false }],
  ])
})
