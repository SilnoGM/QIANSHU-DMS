import type {
  PurchaseOrderDetailDto,
  PurchaseOrderStatusRequestDto,
} from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 运营取消流程必须验证真实提交、复制与旧身份保护。
import test from 'node:test'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import messages from '../../src/locales/lang/purchase-review/zh-cn.json'
import { createPurchaseOrderCancelFlow } from '../../src/views/operations/purchase-orders/purchase-order-cancel-flow'
import { buildPurchaseCancellationText } from '../../src/views/operations/purchase-orders/purchase-order-cancel.logic'

const i18n = createI18n({ legacy: false, locale: 'zh-cn', messages: { 'zh-cn': messages } })
const t = (key: string, values: Record<string, string | number> = {}) => i18n.global.t(key, values)

function cancellationDetail(): PurchaseOrderDetailDto {
  return {
    id: 'order-1',
    orderNo: 'PO/20260918-00018',
    orderDate: '2026-09-18',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paidAmount: '0.00',
    supplier: { label: '测试供应商' },
    amounts: { purchaseTotalAmount: '15000.0000', paidAmount: '0.0000', outstandingAmount: '15000.0000' },
    lines: [{ lineNumber: 2, productName: '椅子' }, { lineNumber: 1, productName: '桌子' }],
  } as PurchaseOrderDetailDto
}

function createFixture() {
  const visible = ref(true)
  const orderId = ref<string | null>('order-1')
  const authEpoch = ref(1)
  const canCancel = ref(true)
  const order = cancellationDetail()
  const requests: PurchaseOrderStatusRequestDto[] = []
  const copied: string[] = []
  const notices: string[] = []
  const events: string[] = []
  const api = {
    getById: async (_id: string, _signal: AbortSignal) => ({ data: { ...order } }),
    updateOrderStatus: async (_id: string, body: PurchaseOrderStatusRequestDto, _signal: AbortSignal) => {
      requests.push(body)
      return { data: { ...order, orderStatus: 'CANCELLED' as const } }
    },
  }
  const clipboard = {
    writeText: async (text: string) => {
      copied.push(text)
    },
  }
  const flow = createPurchaseOrderCancelFlow({
    visible,
    orderId,
    authEpoch,
    canCancel,
    translate: t,
    api,
    clipboard,
    toast: {
      success: (text: string) => notices.push(text),
      warning: (text: string) => notices.push(text),
    },
    failure: (error: unknown) => ({ message: error instanceof Error ? error.message : '请求失败' }),
    isAbortError: (error: unknown) => error instanceof Error && error.name === 'AbortError',
    onCancelled: detail => events.push(`cancelled:${detail.id}`),
    onClose: () => {
      visible.value = false
      events.push('close')
    },
  })
  return { flow, visible, orderId, authEpoch, canCancel, api, clipboard, requests, copied, notices, events, order }
}

test('取消原因必填，确认后携带原因取消并复制通知后关闭', async () => {
  const fixture = createFixture()
  await fixture.flow.loadDetail()
  assert.equal(fixture.flow.detail.value?.orderNo, 'PO/20260918-00018')
  await fixture.flow.submit()
  assert.deepEqual(fixture.requests, [])
  assert.equal(fixture.flow.reasonError.value, '请填写取消原因')
  fixture.flow.reason.value = '  客户取消 '
  await fixture.flow.submit()
  assert.deepEqual(fixture.requests, [{ toStatus: 'CANCELLED', reason: '客户取消' }])
  assert.equal(fixture.copied[0], buildPurchaseCancellationText(fixture.order, t))
  assert.deepEqual(fixture.events, ['cancelled:order-1', 'close'])
  assert.equal(fixture.visible.value, false)
  assert.deepEqual(fixture.notices, ['采购单已取消，取消信息已复制'])
})

test('取消失败不复制、不关闭，复制失败后仅重试剪贴板', async () => {
  const rejected = createFixture()
  await rejected.flow.loadDetail()
  rejected.flow.reason.value = '客户取消'
  rejected.api.updateOrderStatus = async () => {
    throw new Error('采购单已有有效付款')
  }
  await rejected.flow.submit()
  assert.equal(rejected.flow.actionError.value, '采购单已有有效付款')
  assert.equal(rejected.visible.value, true)
  assert.deepEqual(rejected.copied, [])
  assert.deepEqual(rejected.events, [])

  const fixture = createFixture()
  await fixture.flow.loadDetail()
  fixture.flow.reason.value = '客户取消'
  fixture.clipboard.writeText = async () => {
    throw new Error('Permission denied')
  }
  await fixture.flow.submit()
  assert.equal(fixture.flow.completed.value, true)
  assert.equal(fixture.visible.value, true)
  assert.equal(fixture.flow.canConfirm.value, false)
  assert.match(fixture.flow.actionError.value, /已取消，但复制失败/u)
  await fixture.flow.submit()
  assert.equal(fixture.requests.length, 1)
  fixture.clipboard.writeText = async (text) => {
    fixture.copied.push(text)
  }
  await fixture.flow.copyCancelledInfo()
  assert.equal(fixture.requests.length, 1)
  assert.equal(fixture.copied.length, 1)
  assert.equal(fixture.visible.value, false)
})

test('重复点击与旧身份的迟到响应不产生重复取消或复制', async () => {
  const fixture = createFixture()
  await fixture.flow.loadDetail()
  fixture.flow.reason.value = '客户取消'
  let complete!: () => void
  const update = fixture.api.updateOrderStatus
  fixture.api.updateOrderStatus = (_id, body) => new Promise((resolve) => {
    complete = () => {
      void update(_id, body, new AbortController().signal).then(resolve)
    }
  })
  const pending = fixture.flow.submit()
  await fixture.flow.submit()
  fixture.authEpoch.value++
  complete()
  await pending
  assert.equal(fixture.requests.length, 1)
  assert.deepEqual(fixture.copied, [])
  assert.deepEqual(fixture.events, [])
  assert.equal(fixture.flow.submitting.value, false)
})

test('无权限或已付款订单无法提交，关闭后旧详情响应不回填', async () => {
  const fixture = createFixture()
  await fixture.flow.loadDetail()
  fixture.canCancel.value = false
  fixture.flow.reason.value = '客户取消'
  await fixture.flow.submit()
  fixture.canCancel.value = true
  fixture.order.paidAmount = '5.00'
  await fixture.flow.loadDetail()
  assert.equal(fixture.flow.canConfirm.value, false)
  assert.equal(fixture.flow.blockedMessage.value, '采购单已有有效付款，请先作废付款后再取消')
  await fixture.flow.submit()
  assert.deepEqual(fixture.requests, [])

  const revoked = createFixture()
  revoked.canCancel.value = false
  await revoked.flow.loadDetail()
  assert.deepEqual(revoked.events, ['close'])
  assert.equal(revoked.flow.detail.value, null)

  const stale = createFixture()
  let complete!: () => void
  stale.api.getById = () => new Promise((resolve) => {
    complete = () => resolve({ data: { ...stale.order } })
  })
  const pending = stale.flow.loadDetail()
  stale.visible.value = false
  stale.flow.reset()
  complete()
  await pending
  assert.equal(stale.flow.detail.value, null)
})
