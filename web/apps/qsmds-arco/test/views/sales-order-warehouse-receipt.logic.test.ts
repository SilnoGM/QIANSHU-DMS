import type {
  SalesOrderWarehouseReceiptContextDto,
  SalesOrderWarehouseReceiptResultDto,
} from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售入仓弹窗逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import {
  buildSalesWarehouseReceiptIntent,
  countWarehouseReceiptParts,
  createWarehouseReceiptOrders,
  defaultWarehouseReceiptSelection,
  formatSalesWarehouseReceiptSuccess,
  toWarehouseReceiptRequest,
  warehouseReceiptMinimumReceivedAt,
} from '../../src/views/operations/sales-orders/sales-order-warehouse-receipt.logic'

const FIRST_ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECOND_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FIRST_PART_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SECOND_PART_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const THIRD_PART_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const LINE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const SECOND_LINE_ID = '11111111-1111-4111-8111-111111111111'

function part(id: string, partNumber: number, shippedAt: string, lineId = LINE_ID) {
  return {
    id,
    shipmentNo: `SHIP-${partNumber}`,
    partNumber,
    status: 'ACTIVE' as const,
    shippingMarkText: `MARK-${partNumber}`,
    shippedAt,
    shippedById: null,
    shippedBy: null,
    shipmentRecordedAt: shippedAt,
    shipmentRemark: null,
    trackingNo: 'SF123',
    destinationWarehouseValue: null,
    warehouseReceivedAt: null,
    warehouseReceivedById: null,
    warehouseRecordedAt: null,
    warehouseRemark: null,
    warehouseReceivedBy: null,
    items: [{ purchaseOrderLineId: lineId, lineNumber: 1, quantity: 2 }],
  }
}

const context = {
  salesOrder: {
    id: '22222222-2222-4222-8222-222222222222',
    orderNo: 'SO/20261026-00001',
    customerName: '客户甲',
    fulfillmentStatus: 'LAND_TRANSIT',
    version: 4,
  },
  pendingReceiptPartCount: 3,
  purchaseOrders: [{
    id: FIRST_ORDER_ID,
    orderNo: 'PO/20261020-00001',
    orderDate: '2026-10-20',
    supplier: { source: 'DICTIONARY', value: 'SUPPLIER_A', label: '供应商 A', tone: null, known: true, effectiveEnabled: true },
    fulfillmentStatus: 'SHIPPED',
    version: 3,
    shippingMarkText: 'BASE-MARK',
    receivedPartCount: 1,
    lineSummary: {
      lineCount: 2,
      totalQuantity: 4,
      previews: [
        {
          lineId: LINE_ID,
          productName: '产品甲',
          productNo: 'P-001',
          description: '备注甲',
          quantity: 2,
          mainImage: { id: '33333333-3333-4333-8333-333333333333', contentUrl: '/api/line-a' },
        },
        {
          lineId: SECOND_LINE_ID,
          productName: '产品乙',
          productNo: null,
          description: null,
          quantity: 2,
          mainImage: null,
        },
      ],
    },
    parts: [
      part(SECOND_PART_ID, 2, '2026-10-21T02:00:00.000Z', SECOND_LINE_ID),
      part(FIRST_PART_ID, 1, '2026-10-20T02:00:00.000Z'),
    ],
  }, {
    id: SECOND_ORDER_ID,
    orderNo: 'PO/20261022-00002',
    orderDate: '2026-10-22',
    supplier: { source: 'CUSTOM_TEXT', value: null, label: '临时加工厂', tone: null, known: null, effectiveEnabled: null },
    fulfillmentStatus: 'SHIPPED',
    version: 5,
    shippingMarkText: 'BASE-MARK-2',
    receivedPartCount: 0,
    lineSummary: {
      lineCount: 1,
      totalQuantity: 2,
      previews: [{
        lineId: LINE_ID,
        productName: '产品甲',
        productNo: 'P-001',
        description: '备注甲',
        quantity: 2,
        mainImage: null,
      }],
    },
    parts: [part(THIRD_PART_ID, 1, '2026-10-23T02:00:00.000Z')],
  }],
} as unknown as SalesOrderWarehouseReceiptContextDto

test('按采购单分组、按货件序号排序，并用产品预览回填图片与编号', () => {
  const orders = createWarehouseReceiptOrders(context)
  assert.deepEqual(orders.map(order => order.id), [FIRST_ORDER_ID, SECOND_ORDER_ID])
  assert.deepEqual(orders[0]!.parts.map(item => item.partNumber), [1, 2])
  assert.deepEqual(orders[0]!.parts[0]!.products[0], {
    purchaseOrderLineId: LINE_ID,
    lineNumber: 1,
    quantity: 2,
    productName: '产品甲',
    productNo: 'P-001',
    description: '备注甲',
    imageSrc: '/api/line-a',
  })
  assert.equal(orders[0]!.parts[1]!.products[0]!.productName, '产品乙')
  assert.equal(orders[0]!.parts[1]!.products[0]!.imageSrc, null)
  assert.equal(countWarehouseReceiptParts(orders), 3)
  assert.deepEqual(defaultWarehouseReceiptSelection(orders), [])
  assert.deepEqual(defaultWarehouseReceiptSelection([orders[1]!]), [THIRD_PART_ID])
})

test('入仓时间下限取所选货件发货时间的最大值', () => {
  const orders = createWarehouseReceiptOrders(context)
  assert.equal(
    warehouseReceiptMinimumReceivedAt(orders, [FIRST_PART_ID, SECOND_PART_ID]),
    '2026-10-21T02:00:00.000Z',
  )
  assert.equal(
    warehouseReceiptMinimumReceivedAt(orders, [FIRST_PART_ID]),
    '2026-10-20T02:00:00.000Z',
  )
  assert.equal(warehouseReceiptMinimumReceivedAt(orders, []), undefined)
})

test('按采购单构造目标，排序货件并保留每个采购单的版本', () => {
  const orders = createWarehouseReceiptOrders(context)
  const result = buildSalesWarehouseReceiptIntent({
    orders,
    context,
    selectedIds: [THIRD_PART_ID, SECOND_PART_ID, FIRST_PART_ID],
    receivedAt: '2026-10-26T09:00:00.000Z',
    remark: '  外箱完好  ',
    now: new Date('2026-10-26T10:00:00.000Z'),
  })
  assert.equal(result.valid, true)
  if (!result.valid) {
    return
  }
  assert.deepEqual(result.request.targets, [
    { purchaseOrderId: FIRST_ORDER_ID, expectedVersion: 3, partIds: [FIRST_PART_ID, SECOND_PART_ID].sort() },
    { purchaseOrderId: SECOND_ORDER_ID, expectedVersion: 5, partIds: [THIRD_PART_ID] },
  ])
  assert.equal(result.request.receivedAt, '2026-10-26T09:00:00.000Z')
  assert.equal(result.request.remark, '外箱完好')
  assert.deepEqual(toWarehouseReceiptRequest(result.request).targets, result.request.targets)
})

test('拒绝空选、未知货件、无效或越界时间以及超长说明', () => {
  const orders = createWarehouseReceiptOrders(context)
  const base = {
    orders,
    context,
    selectedIds: [FIRST_PART_ID],
    receivedAt: '2026-10-26T09:00:00.000Z',
    remark: '',
    now: new Date('2026-10-26T10:00:00.000Z'),
  }
  const errors = [
    { ...base, selectedIds: [] },
    { ...base, selectedIds: [FIRST_PART_ID, '99999999-9999-4999-8999-999999999999'] },
    { ...base, receivedAt: '2026-10-26 09:00:00' },
    { ...base, receivedAt: '2026-10-26T11:00:00.000Z' },
    { ...base, selectedIds: [SECOND_PART_ID], receivedAt: '2026-10-20T02:00:00.000Z' },
    { ...base, remark: '文'.repeat(501) },
  ].map(input => buildSalesWarehouseReceiptIntent(input))
  assert.deepEqual(errors.map(result => result.valid ? null : result.error), [
    'selection',
    'selection',
    'time',
    'timeRange',
    'timeRange',
    'remark',
  ])
})

test('成功文案区分幂等重放、销售推进与剩余待入仓', () => {
  const result = {
    purchaseOrders: [],
    receivedPartCount: 3,
    changedPurchaseOrderCount: 2,
    remainingPendingReceiptCount: 1,
    salesOrder: {
      id: context.salesOrder.id,
      orderNo: context.salesOrder.orderNo,
      fulfillmentStatus: 'LAND_TRANSIT',
      advancedToWarehouseArrived: false,
    },
  } as SalesOrderWarehouseReceiptResultDto
  assert.equal(
    formatSalesWarehouseReceiptSuccess({ ...result, changedPurchaseOrderCount: 0 }),
    '所选货件已入仓，未重复处理',
  )
  assert.equal(
    formatSalesWarehouseReceiptSuccess(result),
    '已完成 2 张采购单共 3 件货件入仓，仍有 1 件待入仓',
  )
  assert.equal(
    formatSalesWarehouseReceiptSuccess({
      ...result,
      remainingPendingReceiptCount: 0,
      salesOrder: { ...result.salesOrder, fulfillmentStatus: 'WAREHOUSE_ARRIVED', advancedToWarehouseArrived: true },
    }),
    '已完成 2 张采购单共 3 件货件入仓，销售订单已进入待装柜',
  )
})
