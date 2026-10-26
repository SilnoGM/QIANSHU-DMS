import type { PurchasePaymentRecordDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 验证采购付款记录逻辑与页面契约。
import test from 'node:test'
import {
  canVoidPurchasePaymentRecord,
  purchasePaymentRecordStatusFilterItems,
} from '../../src/views/workbenches/purchase-payments/payment-records.logic'

function record(voidedAt: string | null): PurchasePaymentRecordDto {
  return { voidedAt } as unknown as PurchasePaymentRecordDto
}

test('只有未作废的采购付款记录可以作废', () => {
  assert.equal(canVoidPurchasePaymentRecord(record(null)), true)
  assert.equal(canVoidPurchasePaymentRecord(record('2026-10-26T00:00:00.000Z')), false)
})

test('付款记录状态筛选固定为全部、有效、已作废', () => {
  const items = purchasePaymentRecordStatusFilterItems(key => key)
  assert.deepEqual(items, [
    { label: 'purchasePayment.records.statusAll', value: 'ALL' },
    { label: 'purchasePayment.records.statusActive', value: 'ACTIVE' },
    { label: 'purchasePayment.records.statusVoided', value: 'VOIDED' },
  ])
})

test('财务采购付款页头提供记录入口，记录页使用平铺表格和作废弹窗', async () => {
  const read = (path: string) => readFile(
    new URL(`../../src/views/workbenches/purchase-payments/${path}`, import.meta.url),
    'utf8',
  )
  const [payments, records, voidModal] = await Promise.all([
    read('index.vue'),
    read('payment-records-page.vue'),
    read('payment-void-modal.vue'),
  ])
  assert.match(payments, /qsFinanceRealtimePurchasePaymentRecords/u)
  assert.match(payments, /purchasePayment\.records\.title/u)
  assert.match(records, /row-key="id"/u)
  assert.match(records, /:data="items"/u)
  assert.doesNotMatch(records, /:grouping=/u)
  assert.match(records, /QsStatusSwitchToolbar/u)
  assert.match(records, /purchasePayment\.records\.voidAction/u)
  assert.match(records, /PurchasePaymentVoidModal/u)
  assert.match(voidModal, /purchaseOrdersApi\.voidPayment/u)
  assert.match(voidModal, /purchasePayment\.records\.unknownNotice/u)
})
