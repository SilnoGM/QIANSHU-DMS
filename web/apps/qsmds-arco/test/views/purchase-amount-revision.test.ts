import type { PurchaseOrderDetailDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 验证采购金额修订逻辑与页面契约。
import test from 'node:test'
import {
  buildPurchaseAmountRevisionRequest,
  calculatePurchaseAmountRevisionPreview,
} from '../../src/views/workbenches/purchase-reviews/amount-revision.logic'

function detail(): PurchaseOrderDetailDto {
  return {
    id: 'order-1',
    orderNo: 'PO/20261026-00001',
    version: 3,
    fulfillmentStatus: 'SIGNED',
    amounts: {
      lineSubtotalAmount: '100.00',
      purchaseTotalAmount: '100.00',
      depositDueAmount: '30.00',
      balanceDueAmount: '70.00',
      paidAmount: '0.00',
      outstandingAmount: '100.00',
    },
    lines: [
      {
        id: 'line-a',
        lineType: 'CATALOG',
        productName: '产品甲',
        productNo: 'P-1',
        quantity: 1,
        actualPurchaseUnitPriceAmount: '30.00',
        lineTotalAmount: '30.00',
      },
      {
        id: 'line-b',
        lineType: 'CUSTOM',
        productName: '产品乙',
        productNo: null,
        quantity: 2,
        actualPurchaseUnitPriceAmount: '35.00',
        lineTotalAmount: '70.00',
      },
    ],
    payments: [],
  } as unknown as PurchaseOrderDetailDto
}

test('金额修订预览按新单价重算行小计、总价和尾款', () => {
  const preview = calculatePurchaseAmountRevisionPreview(
    detail(),
    { 'line-a': '30.00', 'line-b': '60.00' },
    '20.00',
  )
  assert.equal(preview.lineTotals['line-a'], '30.00')
  assert.equal(preview.lineTotals['line-b'], '120.00')
  assert.equal(preview.lineSubtotalAmount, '150.00')
  assert.equal(preview.purchaseTotalAmount, '150.00')
  assert.equal(preview.depositDueAmount, '20.00')
  assert.equal(preview.balanceDueAmount, '130.00')
  assert.equal(preview.changed, true)
})

test('金额修订请求包含版本、全部行和规范化定金', () => {
  const result = buildPurchaseAmountRevisionRequest(
    detail(),
    { 'line-a': '30.00', 'line-b': '60.00' },
    '20.00',
    '  价格录入错误  ',
  )
  assert.equal(result.valid, true)
  assert.deepEqual(result.request, {
    expectedVersion: 3,
    reason: '价格录入错误',
    depositDueAmount: '20.00',
    lines: [
      { lineId: 'line-a', actualUnitPriceAmount: '30.00' },
      { lineId: 'line-b', actualUnitPriceAmount: '60.00' },
    ],
  })
})

test('没有变化时提示无需提交', () => {
  const preview = calculatePurchaseAmountRevisionPreview(
    detail(),
    { 'line-a': '30.00', 'line-b': '35.00' },
    '30.00',
  )
  assert.equal(preview.changed, false)
  const result = buildPurchaseAmountRevisionRequest(
    detail(),
    { 'line-a': '30.00', 'line-b': '35.00' },
    '30.00',
    '价格复核',
  )
  assert.equal(result.valid, false)
  assert.equal(result.fieldError, '采购金额没有变化，无需提交')
})

test('行间调价但订单四个金额都不变时拒绝', () => {
  assert.throws(
    () => calculatePurchaseAmountRevisionPreview(
      detail(),
      { 'line-a': '50.00', 'line-b': '25.00' },
      '30.00',
    ),
    /行间调价但订单总额、定金和尾款未变化/u,
  )
})

test('定金不能超过重算后的采购总价', () => {
  assert.throws(
    () => calculatePurchaseAmountRevisionPreview(
      detail(),
      { 'line-a': '30.00', 'line-b': '60.00' },
      '151.00',
    ),
    /定金不能超过采购总价/u,
  )
})

test('金额修订原因必填且最多 500 字', () => {
  const missing = buildPurchaseAmountRevisionRequest(
    detail(),
    { 'line-a': '30.00', 'line-b': '60.00' },
    '20.00',
    '   ',
  )
  assert.equal(missing.valid, false)
  assert.equal(missing.fieldError, '请填写金额修订原因')

  const tooLong = buildPurchaseAmountRevisionRequest(
    detail(),
    { 'line-a': '30.00', 'line-b': '60.00' },
    '20.00',
    '字'.repeat(501),
  )
  assert.equal(tooLong.valid, false)
  assert.equal(tooLong.fieldError, '金额修订原因最多 500 个字符')
})

test('采购审核已通过详情接入了金额修订抽屉动作和弹窗', async () => {
  const read = (path: string) => readFile(
    new URL(`../../src/${path}`, import.meta.url),
    'utf8',
  )
  const [page, drawer, modal, api] = await Promise.all([
    read('views/workbenches/purchase-reviews/index.vue'),
    read('components/business/QsPurchaseOrderDrawer/index.vue'),
    read('views/workbenches/purchase-reviews/amount-revision-modal.vue'),
    read('api/modules/purchase-orders.ts'),
  ])
  assert.match(page, /:can-revise-amount="canReviseAmount"/u)
  assert.match(page, /@revise-amount="openAmountRevision"/u)
  assert.match(page, /<PurchaseAmountRevisionModal/u)
  assert.match(drawer, /canReviseAmount/u)
  assert.match(drawer, /emit\('reviseAmount'\)/u)
  assert.match(modal, /purchaseOrdersApi\.reviseAmount/u)
  assert.match(modal, /hasActivePayments/u)
  assert.match(api, /amount-revisions/u)
})
