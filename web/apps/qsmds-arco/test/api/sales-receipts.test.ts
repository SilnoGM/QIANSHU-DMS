import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证收款写请求的幂等与版本传输契约。
import test from 'node:test'
import { createSalesReceiptsApi } from '../../src/api/modules/sales-receipts'

test('申请提交保留原幂等键与快照，审批携带已确认上下文且不自动重试', async () => {
  const calls: unknown[] = []
  const client = { post: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance
  const api = createSalesReceiptsApi(client)
  const signal = new AbortController().signal
  const payload = { amount: '10000.0000', paymentType: 'DEPOSIT' as const, paymentMethod: 'BANK_TRANSFER', receivedAt: '2026-09-08T00:00:00.000Z', voucher: { mediaAssetId: 'voucher' } }
  await api.submit('order/id', payload, 'stable-key', signal)
  await api.submit('order/id', payload, 'stable-key', signal)
  assert.deepEqual(calls[0], calls[1])
  assert.deepEqual(calls[0], ['sales-orders/order%2Fid/receipt-requests', payload, { errorPresentation: 'local', headers: { 'Idempotency-Key': 'stable-key' }, retry: false, signal }])
  const approval = { expectedVersion: 1, expectedContext: { orderVersion: 3, exchangeRateId: 'rate', exchangeRateVersion: 2, ruleVersionId: 'rule', userShareRate: '30.00' } }
  await api.approve('request/id', approval, signal)
  assert.deepEqual(calls[2], ['sales-receipt-requests/request%2Fid/approve', approval, { errorPresentation: 'local', retry: false, signal }])
})

test('未知提交冻结凭证及原始字段，网络与服务端错误保留重放，明确拒绝允许修改', async () => {
  const { freezeReceiptSubmission, isReceiptResultUnknown } = await import('../../src/views/workbenches/sales-receipts/submission.logic')
  const payload = { amount: '10.0000', paymentType: 'DEPOSIT' as const, paymentMethod: 'BANK', receivedAt: '2026-09-08T00:00:00.000Z', voucher: { mediaAssetId: 'original' } }
  const frozen = freezeReceiptSubmission(payload, 'same-key')
  payload.amount = '20.0000'
  payload.voucher.mediaAssetId = 'replacement'
  assert.equal(frozen.payload.amount, '10.0000')
  assert.equal(frozen.payload.voucher.mediaAssetId, 'original')
  assert.equal(isReceiptResultUnknown({ kind: 'network' }), true)
  assert.equal(isReceiptResultUnknown({ status: 503 }), true)
  assert.equal(isReceiptResultUnknown({ status: 409 }), false)
})
