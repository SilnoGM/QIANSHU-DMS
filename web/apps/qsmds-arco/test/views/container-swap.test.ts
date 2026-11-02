import type { ContainerSwapContextDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 业务纯函数由现有 node:test 执行。
import test from 'node:test'
import { buildSwapRequest, containerMarkDisplay, containerMarkTitle, isValidSwapCod, loadingMarkSummary, swapCodDrafts, swapCodTotal } from '../../src/views/workbenches/containers/container-swap.logic'

function line(id: string, cod: string | null) {
  return {
    id,
    containerBatchId: 'batch-1',
    lineNumber: 1,
    version: 3,
    goodsName: '货物',
    oceanShippingMarkText: null,
    recipientName: '收件人',
    recipientPhone: '0911000000',
    recipientAddress: '地址',
    codAmountTwd: cod,
    remark: '备注',
    afterRecipientName: '对方',
    afterRecipientPhone: '0922000000',
    afterRecipientAddress: '对方地址',
    afterRemark: '对方备注',
  }
}

function context(): ContainerSwapContextDto {
  return {
    left: {
      id: 'left',
      shipmentNo: 'A',
      shippingMark: 'A',
      purchaseOrderId: 'p1',
      purchaseOrderNo: 'PO1',
      salesOrderId: 's1',
      salesOrderNo: 'SO1',
      customerName: '客户 A',
      containerBatchId: 'b1',
      containerBatchNo: 'B1',
      containerBatchName: '柜 1',
      items: [{ lineType: 'CATALOG', productId: 'product-1', productName: '产品', quantity: 10 }],
      containerLoadingItems: [line('line-left', '100.00')],
    },
    right: {
      id: 'right',
      shipmentNo: 'B',
      shippingMark: 'B',
      purchaseOrderId: 'p2',
      purchaseOrderNo: 'PO2',
      salesOrderId: 's2',
      salesOrderNo: 'SO2',
      customerName: '客户 B',
      containerBatchId: 'b2',
      containerBatchNo: 'B2',
      containerBatchName: '柜 2',
      items: [{ lineType: 'CATALOG', productId: 'product-1', productName: '产品', quantity: 10 }],
      containerLoadingItems: [line('line-right', '200.00')],
    },
    errors: [],
    canSwap: true,
  }
}

test('validates nullable manual COD with at most two decimals', () => {
  for (const value of ['', '0', '100', '100.5', '100.50', '9'.repeat(28)]) {
    assert.equal(isValidSwapCod(value), true, value)
  }
  for (const value of ['-1', '1.001', 'abc', '.5', '9'.repeat(29)]) {
    assert.equal(isValidSwapCod(value), false, value)
  }
})

test('initializes COD drafts from current target values and keeps empty as null', () => {
  const value = context()
  assert.deepEqual(swapCodDrafts(value), { 'line-left': '100.00', 'line-right': '200.00' })
  const payload = buildSwapRequest({
    leftShipmentId: 'left',
    rightShipmentId: 'right',
    context: value,
    codDrafts: { 'line-left': '', 'line-right': ' 250.5 ' },
    note: ' 通知已发 ',
  })
  assert.deepEqual(payload.leftLines, [{ loadingItemId: 'line-left', expectedVersion: 3, codAmountTwd: null }])
  assert.deepEqual(payload.rightLines, [{ loadingItemId: 'line-right', expectedVersion: 3, codAmountTwd: '250.5' }])
  assert.equal(payload.note, '通知已发')
  assert.equal(swapCodTotal(value.left.containerLoadingItems), '100.00')
})

test('folds multiple container loading marks into first + N items while keeping the full list in the title', () => {
  const source = {
    shippingMarkText: 'FSL/20261026-0183',
    containerLoadingMarks: ['L-052630-01', 'L-052630-02', 'L-052630-03'],
  }
  assert.equal(loadingMarkSummary(source.containerLoadingMarks), 'L-052630-01 + 2项')
  assert.equal(containerMarkDisplay(source), 'L-052630-01 + 2项 · FSL/20261026-0183')
  assert.equal(containerMarkTitle(source), 'L-052630-01、L-052630-02、L-052630-03 · FSL/20261026-0183')
  assert.equal(containerMarkDisplay({ shippingMarkText: 'L-052630-01', containerLoadingMarks: ['L-052630-01'] }), 'L-052630-01')
  assert.equal(containerMarkDisplay({ shippingMarkText: null, containerLoadingMarks: [] }), '—')
})
