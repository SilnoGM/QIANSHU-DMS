import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 跨页来源定位和取消行为使用 Node.js 内置 runner 验证。
import test from 'node:test'
import { findReceiptSourcePage } from '../../src/views/workbenches/sales-receipts/order-receipt-summary.logic'

test('来源申请按正式收款 ID 跨页定位，包括已作废收款', async () => {
  const pages: number[] = []
  const result = await findReceiptSourcePage('payment-target', async (page) => {
    pages.push(page)
    return {
      items: page === 1
        ? [{ id: 'request-other', approvedPayment: { id: 'payment-other' } }]
        : [{ id: 'request-target', approvedPayment: { id: 'payment-target' } }],
      total: 21,
    }
  }, new AbortController().signal)
  assert.deepEqual(result, { page: 2, requestId: 'request-target' })
  assert.deepEqual(pages, [1, 2])
})

test('来源不存在时按总页数结束，不将空关联匹配为来源', async () => {
  const pages: number[] = []
  assert.equal(await findReceiptSourcePage('missing', async (page) => {
    pages.push(page)
    return { items: [{ id: 'request', approvedPayment: null }], total: 40 }
  }, new AbortController().signal), null)
  assert.deepEqual(pages, [1, 2])
})

test('空页立即停止，避免列表变化后无意义继续翻页', async () => {
  let calls = 0
  assert.equal(await findReceiptSourcePage('missing', async () => {
    calls += 1
    return { items: [], total: 40 }
  }, new AbortController().signal), null)
  assert.equal(calls, 1)
})

test('取消前不发请求，请求返回后已取消也不提交结果或继续翻页', async () => {
  const cancelled = new AbortController()
  cancelled.abort()
  let calls = 0
  await assert.rejects(findReceiptSourcePage('target', async () => {
    calls += 1
    return { items: [], total: 0 }
  }, cancelled.signal), { name: 'AbortError' })
  assert.equal(calls, 0)

  const inFlight = new AbortController()
  await assert.rejects(findReceiptSourcePage('target', async () => {
    calls += 1
    await Promise.resolve()
    inFlight.abort()
    return { items: [{ id: 'request', approvedPayment: { id: 'target' } }], total: 40 }
  }, inFlight.signal), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('查询失败向调用方传播，不伪装成来源不存在', async () => {
  const failure = new Error('source request failed')
  await assert.rejects(findReceiptSourcePage('target', async () => {
    throw failure
  }, new AbortController().signal), failure)
})
