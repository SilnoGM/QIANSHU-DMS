import type {
  SalesOrderWarehouseReceiptContextDto,
  SalesOrderWarehouseReceiptResultDto,
} from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证销售入仓异步生命周期与写入重试边界。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useSalesWarehouseReceipt } from '../../src/views/operations/sales-orders/use-sales-warehouse-receipt'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (value: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PART_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const context = {
  salesOrder: { id: ORDER_ID, orderNo: 'SO/20261026-00001', customerName: '客户甲', fulfillmentStatus: 'LAND_TRANSIT', version: 1 },
  purchaseOrders: [{
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    orderNo: 'PO/20261020-00001',
    orderDate: '2026-10-20',
    supplier: { source: 'DICTIONARY', value: null, label: '供应商 A', tone: null, known: true, effectiveEnabled: true },
    fulfillmentStatus: 'SHIPPED',
    version: 2,
    shippingMarkText: null,
    receivedPartCount: 0,
    lineSummary: { lineCount: 1, totalQuantity: 1, previews: [] },
    parts: [{
      id: PART_ID,
      shipmentNo: 'SHIP-1',
      partNumber: 1,
      status: 'ACTIVE',
      shippingMarkText: null,
      shippedAt: '2026-10-20T02:00:00.000Z',
      shippedById: null,
      shippedBy: null,
      shipmentRecordedAt: null,
      shipmentRemark: null,
      trackingNo: null,
      destinationWarehouseValue: null,
      warehouseReceivedAt: null,
      warehouseReceivedById: null,
      warehouseRecordedAt: null,
      warehouseRemark: null,
      warehouseReceivedBy: null,
      items: [{ purchaseOrderLineId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', lineNumber: 1, quantity: 1 }],
    }],
  }],
  pendingReceiptPartCount: 1,
} as unknown as SalesOrderWarehouseReceiptContextDto
const result = {
  purchaseOrders: [],
  receivedPartCount: 1,
  changedPurchaseOrderCount: 1,
  remainingPendingReceiptCount: 0,
  salesOrder: { id: ORDER_ID, orderNo: 'SO/20261026-00001', fulfillmentStatus: 'WAREHOUSE_ARRIVED', advancedToWarehouseArrived: true },
} as SalesOrderWarehouseReceiptResultDto
const intent = {
  targets: [{ purchaseOrderId: context.purchaseOrders[0]!.id, expectedVersion: 2, partIds: [PART_ID] }],
  receivedAt: '2026-10-26T09:00:00.000Z',
}

function setup(api: Parameters<typeof useSalesWarehouseReceipt>[3]) {
  const enabled = ref(true)
  const epoch = ref(1)
  const saved: SalesOrderWarehouseReceiptResultDto[] = []
  const scope = effectScope()
  const action = scope.run(() => useSalesWarehouseReceipt(enabled, epoch, value => saved.push(value), api))!
  return { action, enabled, epoch, saved, stop: () => scope.stop() }
}

test('打开时读取上下文，成功先解锁再关闭且只回调一次', async () => {
  const request = deferred<{ data: SalesOrderWarehouseReceiptResultDto }>()
  let reads = 0
  let writes = 0
  const state = setup({
    warehouseReceiptContext: async () => {
      reads++
      return { data: context }
    },
    warehouseReceipt: async () => {
      writes++
      return request.promise
    },
  })
  await state.action.open(ORDER_ID)
  assert.equal(reads, 1)
  assert.equal(state.action.visible.value, true)
  assert.equal(state.action.context.value?.salesOrder.id, ORDER_ID)
  const pending = state.action.submit(intent)
  await state.action.submit(intent)
  assert.equal(writes, 1)
  assert.equal(state.action.submitting.value, true)
  request.resolve({ data: result })
  await pending
  assert.equal(state.action.submitting.value, false)
  assert.equal(state.action.visible.value, false)
  assert.equal(state.saved.length, 1)
  state.stop()
})

test('写入失败后禁止直接重发，必须重新读取上下文', async () => {
  let writes = 0
  let reads = 0
  const state = setup({
    warehouseReceiptContext: async () => {
      reads++
      return { data: context }
    },
    warehouseReceipt: async () => {
      writes++
      throw new Error('网络中断')
    },
  })
  await state.action.open(ORDER_ID)
  await state.action.submit(intent)
  assert.equal(state.action.needsReload.value, true)
  assert.equal(state.action.visible.value, true)
  assert.match(state.action.error.value ?? '', /网络中断/u)
  await state.action.submit(intent)
  assert.equal(writes, 1)
  await state.action.reload()
  assert.equal(reads, 2)
  assert.equal(state.action.needsReload.value, false)
  assert.equal(state.action.error.value, null)
  state.stop()
})

test('无权限不读取；关闭与身份变更取消请求并丢弃迟到结果', async () => {
  const request = deferred<{ data: SalesOrderWarehouseReceiptContextDto }>()
  let reads = 0
  let signal: AbortSignal | undefined
  const state = setup({
    warehouseReceiptContext: async (_id, value) => {
      reads++
      signal = value
      return request.promise
    },
    warehouseReceipt: async () => ({ data: result }),
  })
  state.enabled.value = false
  await nextTick()
  await state.action.open(ORDER_ID)
  assert.equal(reads, 0)
  state.enabled.value = true
  await nextTick()
  void state.action.open(ORDER_ID)
  assert.equal(reads, 1)
  state.action.setVisible(false)
  assert.equal(signal?.aborted, true)
  request.resolve({ data: context })
  await nextTick()
  assert.equal(state.action.context.value, null)
  state.stop()
})

test('身份世代变化会重置弹窗并取消在途请求', async () => {
  const request = deferred<{ data: SalesOrderWarehouseReceiptContextDto }>()
  let signal: AbortSignal | undefined
  const state = setup({
    warehouseReceiptContext: async (_id, value) => {
      signal = value
      return request.promise
    },
    warehouseReceipt: async () => ({ data: result }),
  })
  void state.action.open(ORDER_ID)
  state.epoch.value = 2
  await nextTick()
  assert.equal(signal?.aborted, true)
  assert.equal(state.action.visible.value, false)
  request.resolve({ data: context })
  await nextTick()
  assert.equal(state.action.context.value, null)
  state.stop()
})
