import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 核对提报幂等、图片 multipart 和付款版本的 HTTP 契约。
import test from 'node:test'
import { createPackagingCostsApi } from '../../src/api/modules/packaging-costs'
import { permissionResourceLabel } from '../../src/views/system/permissions/catalog'

test('提报和付款写入禁自动重试，原样保留幂等键及确认版本', async () => {
  const calls: unknown[][] = []
  const api = createPackagingCostsApi({ post: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const payload = { shipmentId: 'shipment', packagingType: 'WOODEN_BOX', packagingVendor: 'OTHER' as const, amount: '12.30', packagingImageMediaAssetId: 'packaging', quotationImageMediaAssetId: 'quotation' }
  await api.submit(payload, 'same-key', signal)
  await api.submit(payload, 'same-key', signal)
  assert.deepEqual(calls[0], calls[1])
  assert.deepEqual(calls[0], ['packaging-cost-requests', payload, { errorPresentation: 'local', headers: { 'Idempotency-Key': 'same-key' }, retry: false, signal }])
  await api.pay('request/id', { expectedVersion: 3 }, signal)
  assert.deepEqual(calls[2], ['packaging-cost-requests/request%2Fid/pay', { expectedVersion: 3 }, { errorPresentation: 'local', retry: false, signal }])
  const file = new File(['image'], 'proof.png', { type: 'image/png' })
  await api.uploadImage(file, signal)
  const body = calls[3]?.[1] as FormData
  assert.equal(body.get('mediaType'), 'IMAGE')
  assert.equal(body.get('file'), file)
  assert.deepEqual(calls[3]?.[2], { errorPresentation: 'local', retry: false, signal })
})

test('列表与最小货件上下文走费用权限域，权限目录使用中文资源名', async () => {
  const calls: unknown[] = []
  const api = createPackagingCostsApi({ get: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const query = { page: 2, pageSize: 20, status: 'PAID' as const, keyword: 'PKG' }
  await api.list(query, signal)
  await api.shipmentContext('part/id', signal)
  assert.deepEqual(calls, [
    ['packaging-cost-requests', { errorPresentation: 'local', params: query, signal }],
    ['packaging-cost-requests/shipment-context/part%2Fid', { errorPresentation: 'local', signal }],
  ])
  assert.equal(permissionResourceLabel('packaging-costs'), '打木架费用')
})
