import type { PurchaseOrderDetailDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购取消通知必须与实际采购金额和产品明细一致。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, reactive, ref, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import messages from '../../src/locales/lang/purchase-review/zh-cn.json'
import { buildPurchaseCancellationText, purchaseCancellationBlockReason } from '../../src/views/workbenches/purchase-reviews/cancellation.logic'

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

test('取消采购信息严格按模板输出，按采购行排序且金额保留两位', () => {
  const detail = cancellationDetail()
  const original = JSON.stringify(detail)
  assert.equal(buildPurchaseCancellationText(detail, t), `【订单取消：PO/20260918-00018】
供应商：测试供应商
采购日期：2026-09-18

[采购产品明细]
产品名：桌子+椅子

总价：15000.00
已支付：0.00
未支付：15000.00`)
  assert.equal(JSON.stringify(detail), original)
})

async function modalFixture() {
  const source = await readFile(new URL('../../src/views/workbenches/purchase-reviews/cancellation-modal.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const props = reactive({ modelValue: true, orderId: 'order-1' })
  const account = reactive({ authEpoch: 1 })
  const permission = ref(true)
  const order = cancellationDetail()
  const requests: unknown[] = []
  const copied: string[] = []
  const notices: string[] = []
  const events: string[] = []
  const api = {
    getById: async () => ({ data: { ...order } }),
    updateOrderStatus: async (_id: string, body: unknown) => {
      requests.push(body)
      return { data: { ...order, orderStatus: 'CANCELLED' as const } }
    },
  }
  const clipboard = { writeText: async (value: string) => {
    copied.push(value)
  } }
  const state = runInNewContext(ts.transpileModule(`${script}\n;({ loadDetail, submit, copyCancelledInfo, reset, canConfirm, completed, submitting, copying, detail, actionError })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    AbortController,
    computed,
    ref,
    shallowRef,
    navigator: { clipboard },
    defineProps: () => props,
    defineEmits: () => (name: string, value: unknown) => {
      events.push(name)
      if (name === 'update:modelValue') {
        props.modelValue = value as boolean
      }
    },
    useI18n: () => ({ t }),
    useAppAuth: () => ({ auth: () => permission.value }),
    useAppAccountStore: () => account,
    useQsToast: () => ({ success: (text: string) => notices.push(text), warning: (text: string) => notices.push(text) }),
    watch: () => {},
    onBeforeUnmount: () => {},
    onDeactivated: () => {},
    purchaseOrdersApi: api,
    buildPurchaseCancellationText,
    purchaseCancellationBlockReason,
    getPurchaseOrderApiFailure: (error: Error) => ({ message: error.message }),
    isPurchaseOrderAbortError: (error: Error) => error.name === 'AbortError',
  }) as {
    loadDetail: () => Promise<void>
    submit: () => Promise<void>
    copyCancelledInfo: () => Promise<void>
    reset: () => void
    canConfirm: { value: boolean }
    completed: { value: boolean }
    submitting: { value: boolean }
    copying: { value: boolean }
    detail: { value: PurchaseOrderDetailDto | null }
    actionError: { value: string }
  }
  return { source, state, props, account, permission, api, order, clipboard, requests, copied, notices, events }
}

test('二次确认不收集原因，取消成功后才复制，并关闭弹窗刷新列表', async () => {
  const fixture = await modalFixture()
  assert.doesNotMatch(fixture.source, /FaTextarea|actionReason|v-model="reason"/u)
  await fixture.state.loadDetail()
  await fixture.state.submit()
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.requests)), [{ toStatus: 'CANCELLED' }])
  assert.equal(fixture.copied[0], buildPurchaseCancellationText(fixture.order, t))
  assert.deepEqual(fixture.events, ['cancelled', 'update:modelValue'])
  assert.equal(fixture.props.modelValue, false)
  assert.deepEqual(fixture.notices, ['采购单已取消，取消信息已复制'])
})

test('取消失败不复制、不关闭，复制失败后仅重试剪贴板', async () => {
  const rejected = await modalFixture()
  await rejected.state.loadDetail()
  rejected.api.updateOrderStatus = async () => {
    throw new Error('订单已有付款')
  }
  await rejected.state.submit()
  assert.equal(rejected.state.actionError.value, '订单已有付款')
  assert.equal(rejected.props.modelValue, true)
  assert.deepEqual(rejected.copied, [])
  assert.deepEqual(rejected.events, [])

  const fixture = await modalFixture()
  await fixture.state.loadDetail()
  fixture.clipboard.writeText = async () => {
    throw new Error('Permission denied')
  }
  await fixture.state.submit()
  assert.equal(fixture.state.completed.value, true)
  assert.equal(fixture.props.modelValue, true)
  assert.equal(fixture.state.canConfirm.value, false)
  assert.match(fixture.state.actionError.value, /已取消，但复制失败/u)
  await fixture.state.submit()
  fixture.clipboard.writeText = async (text) => {
    fixture.copied.push(text)
  }
  await fixture.state.copyCancelledInfo()
  assert.equal(fixture.requests.length, 1)
  assert.equal(fixture.copied.length, 1)
  assert.equal(fixture.props.modelValue, false)
})

test('重复点击与旧身份的迟到响应不产生重复取消或复制', async () => {
  const fixture = await modalFixture()
  await fixture.state.loadDetail()
  let complete!: () => void
  const update = fixture.api.updateOrderStatus
  fixture.api.updateOrderStatus = (id, body) => new Promise((resolve) => {
    complete = () => {
      void update(id, body).then(resolve)
    }
  })
  const pending = fixture.state.submit()
  await fixture.state.submit()
  fixture.account.authEpoch++
  complete()
  await pending
  assert.equal(fixture.requests.length, 1)
  assert.deepEqual(fixture.copied, [])
  assert.deepEqual(fixture.events, [])
  assert.equal(fixture.state.submitting.value, false)
})

test('无审核权限或已付款订单无法提交，关闭后旧详情响应不回填', async () => {
  const fixture = await modalFixture()
  await fixture.state.loadDetail()
  fixture.permission.value = false
  await fixture.state.submit()
  fixture.permission.value = true
  fixture.order.paidAmount = '5.00'
  await fixture.state.loadDetail()
  assert.equal(fixture.state.canConfirm.value, false)
  await fixture.state.submit()
  assert.deepEqual(fixture.requests, [])
  let complete!: () => void
  fixture.api.getById = () => new Promise((resolve) => {
    complete = () => resolve({ data: { ...fixture.order } })
  })
  const pending = fixture.state.loadDetail()
  fixture.props.modelValue = false
  fixture.state.reset()
  complete()
  await pending
  assert.equal(fixture.state.detail.value, null)
})

test('复制实际已支付和未支付金额，不使用约定定金尾款或浮点数相减', () => {
  const detail = cancellationDetail()
  detail.amounts.purchaseTotalAmount = '9007199254740993.1240'
  detail.amounts.paidAmount = '100.2340'
  detail.amounts.outstandingAmount = '9007199254740892.8900'
  detail.supplier.label = '  自定义\n供应商 '
  assert.match(buildPurchaseCancellationText(detail, t), /供应商：自定义 供应商/u)
  assert.ok(buildPurchaseCancellationText(detail, t).endsWith('总价：9007199254740993.12\n已支付：100.23\n未支付：9007199254740892.89'))
})

test('仅允许审核通过且未发货、未付款的订单确认取消', () => {
  const detail = cancellationDetail()
  assert.equal(purchaseCancellationBlockReason(detail), null)
  assert.equal(purchaseCancellationBlockReason({ ...detail, paidAmount: '0.01' }), 'paid')
  assert.equal(purchaseCancellationBlockReason({ ...detail, fulfillmentStatus: 'PARTIALLY_SHIPPED' }), 'shipped')
  assert.equal(purchaseCancellationBlockReason({ ...detail, orderStatus: 'PENDING_REVIEW' }), 'status')
  assert.equal(purchaseCancellationBlockReason({ ...detail, orderStatus: 'COMPLETED' }), 'status')
  assert.equal(purchaseCancellationBlockReason({ ...detail, orderStatus: 'CANCELLED' }), 'status')
  assert.equal(purchaseCancellationBlockReason({ ...detail, paidAmount: 'invalid' }), 'amount')
})
