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
  await api.getByOrder('order/id', signal)
  const body = { expectedVersion: 3, paymentMethod: 'BANK_TRANSFER', recipientAccountId: 'recipient', recipientProfileVersion: 2, voucher: { mediaAssetId: 'voucher' }, remark: null }
  await api.pay('payable/id', body, 'same-key', signal)
  assert.deepEqual(calls, [
    ['purchase-order-payables', { errorPresentation: 'local', params: query, signal }],
    ['purchase-order-payables/payable%2Fid', { errorPresentation: 'local', signal }],
    ['purchase-order-payables/orders/order%2Fid', { errorPresentation: 'local', signal }],
    ['purchase-order-payables/payable%2Fid/pay', body, { errorPresentation: 'local', headers: { 'Idempotency-Key': 'same-key' }, retry: false, signal }],
  ])
})

test('付款截图使用付款专用上传和认证 Blob 读取路径', async () => {
  const calls: unknown[][] = []
  const invoke = (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  }
  const api = createPurchaseOrderPayablesApi({ get: invoke, post: invoke } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const file = new File(['image'], 'voucher.png', { type: 'image/png' })
  await api.uploadVoucher('payable/id', file, signal)
  await api.voucherContentBlob('payable/id', 'document/id', signal)
  assert.equal(calls[0]?.[0], 'purchase-order-payables/payable%2Fid/voucher-uploads')
  assert.equal((calls[0]?.[1] as FormData).get('mediaType'), 'IMAGE')
  assert.equal((calls[0]?.[1] as FormData).get('file'), file)
  assert.deepEqual(calls[0]?.[2], { errorPresentation: 'local', retry: false, signal })
  assert.deepEqual(calls[1], ['purchase-order-payables/payable%2Fid/vouchers/document%2Fid/content', { errorPresentation: 'local', responseType: 'blob', signal }])
})
