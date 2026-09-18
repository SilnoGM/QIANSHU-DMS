import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 保持现有 API 契约测试入口。
import test from 'node:test'
import { createPaymentRecipientsApi } from '../../src/api/modules/payment-recipients'

test('收款配置使用认证客户端，读图片为Blob，副作用不自动重试且稳定值编码', async () => {
  const calls: unknown[][] = []
  const response = { data: {} }
  const client = Object.fromEntries(['get', 'put', 'post'].map(method => [method, (...args: unknown[]) => {
    calls.push([method, ...args])
    return Promise.resolve(response)
  }])) as unknown as AxiosInstance
  const api = createPaymentRecipientsApi(client)
  const signal = new AbortController().signal
  assert.equal(await api.list({ page: 1, pageSize: 20 }, signal), response)
  await api.save('supplier/a', { expectedVersion: 0, accounts: [] }, signal)
  await api.contentBlob('image/id', signal)
  const file = new File(['image'], 'qr.png', { type: 'image/png' })
  await api.upload(file, signal)
  assert.deepEqual(calls.slice(0, 3), [
    ['get', 'supplier-payment-profiles', { params: { page: 1, pageSize: 20 }, signal, errorPresentation: 'local' }],
    ['put', 'supplier-payment-profiles/supplier%2Fa', { expectedVersion: 0, accounts: [] }, { signal, errorPresentation: 'local', retry: false }],
    ['get', 'payment-recipient-images/image%2Fid/content', { signal, responseType: 'blob', errorPresentation: 'local' }],
  ])
  assert.equal(calls[3]![1], 'payment-recipient-images')
  const body = calls[3]![2] as FormData
  assert.deepEqual([...body.keys()], ['mediaType', 'file'])
  assert.equal(body.get('mediaType'), 'IMAGE')
  assert.deepEqual(calls[3]![3], { signal, errorPresentation: 'local', retry: false })
})

test('包装厂商读取和版本化保存使用独立路径，保存不自动重试', async () => {
  const calls: unknown[][] = []
  const response = { data: {} }
  const client = Object.fromEntries(['get', 'put'].map(method => [method, (...args: unknown[]) => {
    calls.push([method, ...args])
    return Promise.resolve(response)
  }])) as unknown as AxiosInstance
  const api = createPaymentRecipientsApi(client)
  const signal = new AbortController().signal
  assert.equal(await api.getPackagingProfile('CHENGXIN', signal), response)
  assert.equal(await api.savePackagingProfile('CHENGXIN', { expectedVersion: 2, accounts: [] }, signal), response)
  assert.deepEqual(calls, [
    ['get', 'packaging-payment-profiles/CHENGXIN', { signal, errorPresentation: 'local' }],
    ['put', 'packaging-payment-profiles/CHENGXIN', { expectedVersion: 2, accounts: [] }, { signal, errorPresentation: 'local', retry: false }],
  ])
})
