import type { PurchaseOrderAmountRevisionDto, PurchaseOrderDetailDto, PurchaseOrderDocumentDto, PurchaseOrderStatusHistoryDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 采购抽屉展示映射使用 Node.js 内置 runner。
import test from 'node:test'
import { buildPurchaseOrderTimeline, getOrderDocuments, getPaymentDocuments, getPurchaseProductImages, revisionAmounts } from '../../src/components/business/QsPurchaseOrderDrawer/logic'

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

test('采购状态与金额历史合并倒序，稳定区分同 ID 且不修改原数组', () => {
  const history = [
    { id: 'a', changedAt: '2026-09-04T00:00:00Z' },
    { id: 'b', changedAt: '2026-09-06T00:00:00Z' },
    { id: 'c', changedAt: '2026-09-06T00:00:00Z' },
  ] as PurchaseOrderStatusHistoryDto[]
  const revisions = [{ id: 'b', changedAt: '2026-09-06T00:00:00Z', reason: '调整定金' }] as PurchaseOrderAmountRevisionDto[]
  assert.deepEqual(buildPurchaseOrderTimeline({ statusHistory: history, amountRevisions: revisions }).map(item => item.key), ['amount-b', 'status-b', 'status-c', 'status-a'])
  assert.equal(history[0]?.id, 'a')
  assert.deepEqual(buildPurchaseOrderTimeline({ statusHistory: [], amountRevisions: [] }), [])
})

test('采购凭证包含有效付款截图，付款记录引用同一份凭证', () => {
  const documents = [
    { id: 'order', documentType: 'ORDER_ISSUANCE_VOUCHER', paymentId: null, detachedAt: null },
    { id: 'receipt', documentType: 'DELIVERY_RECEIPT', paymentId: null, detachedAt: null },
    { id: 'payment', documentType: 'PAYMENT_VOUCHER', paymentId: 'p', detachedAt: null },
    { id: 'detached', documentType: 'DELIVERY_RECEIPT', paymentId: null, detachedAt: '2026-09-06' },
  ] as PurchaseOrderDocumentDto[]
  assert.deepEqual(getOrderDocuments(documents).map(item => item.id), ['order', 'receipt', 'payment'])
  assert.deepEqual(getPaymentDocuments(documents, 'p').map(item => item.id), ['payment'])
})

test('金额变更对照保留四位金额字符串且显示全部约定字段', () => {
  const revision = {
    oldLineSubtotalAmount: '100.0000',
    oldPurchaseTotalAmount: '100.0000',
    oldDepositDueAmount: '30.0000',
    oldBalanceDueAmount: '70.0000',
    newLineSubtotalAmount: '100.0000',
    newPurchaseTotalAmount: '100.0000',
    newDepositDueAmount: '20.0000',
    newBalanceDueAmount: '80.0000',
  } as PurchaseOrderAmountRevisionDto
  assert.deepEqual(revisionAmounts(revision), [
    { label: 'lineSubtotalAmount', before: '100.0000', after: '100.0000' },
    { label: 'purchaseTotalAmount', before: '100.0000', after: '100.0000' },
    { label: 'depositDueAmount', before: '30.0000', after: '20.0000' },
    { label: 'balanceDueAmount', before: '70.0000', after: '80.0000' },
  ])
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
