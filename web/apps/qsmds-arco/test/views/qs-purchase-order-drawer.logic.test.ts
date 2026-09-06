import type { PurchaseOrderDetailDto, PurchaseOrderDocumentDto, PurchaseOrderStatusHistoryDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 采购抽屉展示映射使用 Node.js 内置 runner。
import test from 'node:test'
import { buildPurchaseOrderTimeline, getPaymentDocuments, getPurchaseProductImages } from '../../src/components/business/QsPurchaseOrderDrawer/logic'

test('付款凭证按 paymentId 关联，保留解除历史，不串到其他付款', () => {
  const documents = [
    { id: 'a', paymentId: 'first', detachedAt: null },
    { id: 'b', paymentId: 'second', detachedAt: null },
    { id: 'c', paymentId: 'first', detachedAt: '2026-09-06' },
  ] as PurchaseOrderDocumentDto[]
  assert.deepEqual(getPaymentDocuments(documents, 'first').map(item => item.id), ['a', 'c'])
  assert.deepEqual(getPaymentDocuments(documents, 'missing'), [])
  assert.equal(documents.length, 3)
})

test('采购变更仅展示服务端状态历史，倒序且不修改原数组', () => {
  const history = [
    { id: 'a', changedAt: '2026-09-04T00:00:00Z' },
    { id: 'b', changedAt: '2026-09-06T00:00:00Z' },
    { id: 'c', changedAt: '2026-09-06T00:00:00Z' },
  ] as PurchaseOrderStatusHistoryDto[]
  assert.deepEqual(buildPurchaseOrderTimeline(history).map(item => item.id), ['b', 'c', 'a'])
  assert.equal(history[0]?.id, 'a')
  assert.deepEqual(buildPurchaseOrderTimeline([]), [])
})

test('主图从最新采购详情按行 ID 匹配，不按产品名混用', () => {
  const detail = {
    lineSummary: { previews: [
      { lineId: 'a', productName: 'same', mainImage: { contentUrl: '/image-a' } },
      { lineId: 'b', productName: 'same', mainImage: null },
    ] },
  } as PurchaseOrderDetailDto
  const images = getPurchaseProductImages(detail)
  assert.equal(images.get('a'), '/image-a')
  assert.equal(images.get('b'), undefined)
  assert.equal(images.get('unknown'), undefined)
})
