import type { PurchasePayableDto, PurchasePayableOrderDto, PurchasePayablePayDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 挂载真实付款 SFC 和状态机，以内存接口验证交互，不执行资金写入。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import * as paymentLogic from '../../src/views/workbenches/purchase-payments/purchase-payments.logic'
import { usePurchasePayablePayment } from '../../src/views/workbenches/purchase-payments/use-purchase-payable-payment'

interface HostNode { tag: string, parent: HostNode | null, children: HostNode[], props: Record<string, any>, text: string }
interface PaymentCall { id: string, body: PurchasePayablePayDto, key: string, signal?: AbortSignal }

const { createRenderer, defineComponent, h, nextTick, reactive, ref } = Vue
const node = (tag = '', text = ''): HostNode => ({ tag, text, parent: null, children: [], props: {} })
const flatten = (current: HostNode): HostNode[] => [current, ...current.children.flatMap(flatten)]
const textOf = (current: HostNode): string => current.text + current.children.map(textOf).join('')
const source = new URL('../../src/views/workbenches/purchase-payments/payment-form.vue', import.meta.url)

function order(status: PurchasePayableDto['status'] = 'PENDING_PAYMENT'): PurchasePayableOrderDto {
  const item = (id: string, paymentType: PurchasePayableDto['paymentType'], amount: string): PurchasePayableDto => ({
    id,
    paymentType,
    dueAmount: status === 'NO_PAYMENT' ? '0.00' : amount,
    paidAmount: status === 'PAID' ? amount : '0.00',
    remainingAmount: status === 'PENDING_PAYMENT' ? amount : '0.00',
    status,
    version: 1,
    paidAt: null,
    paidBy: null,
    paymentReceipt: null,
  })
  return {
    id: 'order',
    orderNo: 'PO/20260917-00001',
    orderDate: '2026-09-17',
    purchaseType: 'SALES_LINKED',
    supplierName: '供应商',
    salesOrderNo: 'SO/20260917-00001',
    purchaseTotalAmount: '100.00',
    currencyCode: 'CNY',
    accountOwnerType: 'USER',
    owner: { id: 'owner', name: '销售出单人' },
    paymentRecipientProfile: { id: 'profile', version: 2, accounts: [{ id: 'bank', paymentMethod: 'BANK_TRANSFER', recipientName: '供应商', bankName: '银行', bankAccount: '123', bankBranch: null, qrMediaAssetId: null, qrContentUrl: null }] },
    items: [item('deposit', 'DEPOSIT', '30.00'), item('balance', 'BALANCE', '70.00')],
  }
}

// 基础控件只提供插槽和事件宿主；条件分支、disabled、v-model 和事件绑定来自实际 SFC 编译结果。
function element(tag: string) {
  return defineComponent({
    inheritAttrs: false,
    setup: (_, { attrs, slots }) => () => h(tag, attrs, Object.values(slots).flatMap(slot => slot?.() ?? [])),
  })
}

function fixture(status: PurchasePayableDto['status'] = 'PENDING_PAYMENT') {
  const initial = order(status)
  const props = reactive({ selection: { order: initial, item: initial.items[0]! }, enabled: true, selectable: true })
  const account = reactive({ authEpoch: 1 })
  const permission = ref(true)
  const calls: PaymentCall[] = []
  const changed: PurchasePayableOrderDto[] = []
  const selected: string[] = []
  const locks: boolean[] = []
  const messages: string[] = []
  const refreshes: boolean[] = []
  let key = 0
  let execute = async (): Promise<{ data: PurchasePayableOrderDto }> => ({ data: order('PAID') })
  const compiled = compileScript(parse(readFileSync(source, 'utf8')).descriptor, { id: 'purchase-payment-form-test', inlineTemplate: true })
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = { exports: {} as Record<string, any> }
  runInNewContext(code, {
    ...Vue,
    exports: component.exports,
    module: component,
    useI18n: () => ({ t: (key: string, values: Record<string, unknown> = {}) => [key, ...Object.values(values)].join(' ') }),
    useAppAuth: () => ({ auth: () => permission.value }),
    useAppAccountStore: () => account,
    require: (specifier: string) => {
      if (specifier === 'vue') {
        return Vue
      }
      if (specifier === './purchase-payments.logic') {
        return paymentLogic
      }
      if (specifier === './use-purchase-payable-payment') {
        return { usePurchasePayablePayment: (...args: Parameters<typeof usePurchasePayablePayment>) => usePurchasePayablePayment(args[0], args[1], args[2], {
          pay: (id, body, idempotencyKey, signal) => {
            calls.push({ id, body: { ...body }, key: idempotencyKey, signal })
            return execute() as never
          },
        }, () => `payment-key-${++key}`) }
      }
      if (specifier.includes('useQsToast')) {
        return { useQsToast: () => ({ success: (message: string) => messages.push(message) }) }
      }
      if (specifier.includes('use-currency-catalog')) {
        return { useCurrencyCatalog: () => ({ currencies: ref([]) }) }
      }
      if (specifier.endsWith('.vue')) {
        return { __esModule: true, default: element(specifier.includes('payment-voucher-upload') ? 'voucher-upload' : 'span') }
      }
      throw new Error(`Unexpected payment form dependency: ${specifier}`)
    },
  })
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: tag => node(tag),
    createText: text => node('', text),
    createComment: () => node(),
    insert: (child, parent, anchor) => {
      if (child.parent) {
        child.parent.children.splice(child.parent.children.indexOf(child), 1)
      }
      child.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    },
    remove: (child) => { child.parent?.children.splice(child.parent.children.indexOf(child), 1) },
    parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
    patchProp: (target, name, _previous, value) => { target.props[name] = value },
    setText: (target, text) => { target.text = text },
    setElementText: (target, text) => {
      target.text = text
      target.children = []
    },
  })
  const root = node('root')
  const app = renderer.createApp(defineComponent({ setup: () => () => h(component.exports.default, {
    ...props,
    onChanged: (updated: PurchasePayableOrderDto) => {
      changed.push(updated)
      props.selection = { order: updated, item: updated.items.find(item => item.id === props.selection.item.id)! }
    },
    onSelect: (id: string) => {
      selected.push(id)
      props.selection = { order: props.selection.order, item: props.selection.order.items.find(item => item.id === id)! }
    },
    onLockChange: (locked: boolean) => locks.push(locked),
    onRefresh: () => refreshes.push(true),
  }) }))
  for (const [name, tag] of Object.entries({ FaButton: 'button', FaIcon: 'span', FaTag: 'span', FaAlert: 'aside', FaCard: 'section', FaForm: 'fieldset', FaFormItem: 'label', FaTextarea: 'textarea', FaSelect: 'select' })) {
    app.component(name, element(tag))
  }
  app.mount(root)
  const nodes = () => flatten(root)
  const buttons = () => nodes().filter(item => item.tag === 'button')
  const findButton = (key: string) => buttons().find(item => `${textOf(item)} ${item.props['aria-label'] ?? ''}`.includes(key))
  const button = (key: string) => {
    const found = findButton(key)
    assert.ok(found, `应显示按钮 ${key}`)
    return found
  }
  const fields = () => nodes().filter(item => ['select', 'textarea', 'voucher-upload'].includes(item.tag))
  const update = (tag: string, value: string) => {
    const field = nodes().find(item => item.tag === tag)
    assert.ok(field, `应显示 ${tag} 输入控件`)
    field.props['onUpdate:modelValue'](value)
  }
  const installments = () => buttons().filter(item => item.props['aria-pressed'] !== undefined)
  return { props, account, permission, calls, changed, selected, locks, messages, refreshes, nodes, button, findButton, fields, update, installments, setExecute: (handler: typeof execute) => execute = handler, dispose: () => app.unmount() }
}

test('订单款项选择只通知父页，具体款项与停用页面不能切换，不会直接付款', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  assert.equal(f.calls.length, 0)
  assert.equal(f.installments().length, 2)
  f.button('purchasePayment.types.BALANCE').props.onClick()
  await nextTick()
  assert.deepEqual(f.selected, ['balance'])
  assert.equal(f.props.selection.item.id, 'balance')
  assert.equal(f.calls.length, 0)
  f.props.selectable = false
  await nextTick()
  assert.equal(f.installments().length, 0)
  f.props.selectable = true
  f.props.enabled = false
  await nextTick()
  const deposit = f.button('purchasePayment.types.DEPOSIT')
  assert.equal(deposit.props.disabled, true)
  deposit.props.onClick()
  assert.deepEqual(f.selected, ['balance'])
  assert.equal(f.calls.length, 0)
})

test('提交中锁住字段和款项切换，重复点击只发一笔，成功通知父页并变为只读', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.update('select', 'bank')
  f.update('voucher-upload', 'voucher')
  f.update('textarea', '  采购定金  ')
  let finish!: (value: { data: PurchasePayableOrderDto }) => void
  f.setExecute(() => new Promise(resolve => finish = resolve))
  const pending = f.button('purchasePayment.confirmPay').props.onClick()
  await nextTick()
  assert.equal(f.locks.at(-1), true)
  assert.equal(f.fields().length, 3)
  assert.ok(f.fields().every(item => item.props.disabled === true))
  assert.ok(f.installments().every(item => item.props.disabled === true))
  assert.equal(f.button('purchasePayment.confirmPay').props.disabled, true)
  f.button('purchasePayment.types.BALANCE').props.onClick()
  await f.button('purchasePayment.confirmPay').props.onClick()
  assert.deepEqual(f.selected, [])
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0]?.body, { expectedVersion: 1, paymentMethod: 'BANK_TRANSFER', recipientAccountId: 'bank', recipientProfileVersion: 2, voucher: { mediaAssetId: 'voucher' }, remark: '采购定金' })
  finish({ data: order('PAID') })
  await pending
  await nextTick()
  assert.equal(f.changed.length, 1)
  assert.equal(f.changed[0]?.items[0]?.status, 'PAID')
  assert.deepEqual(f.messages, ['purchasePayment.paySuccess'])
  assert.equal(f.locks.at(-1), false)
  assert.equal(f.fields().length, 0)
  assert.equal(f.findButton('purchasePayment.confirmPay'), undefined)
})

test('未知结果锁住字段与切换，仅重试原输入和幂等键，重试成功只通知一次', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.update('select', 'bank')
  f.update('voucher-upload', 'voucher')
  f.update('textarea', '原始备注')
  f.setExecute(async () => {
    throw Object.assign(new Error('连接中断'), { kind: 'network' })
  })
  await f.button('purchasePayment.confirmPay').props.onClick()
  await nextTick()
  assert.equal(f.locks.at(-1), true)
  assert.ok(f.fields().every(item => item.props.disabled === true))
  assert.ok(f.installments().every(item => item.props.disabled === true))
  assert.equal(f.button('purchasePayment.retryPay').props.disabled, false)
  f.button('purchasePayment.types.BALANCE').props.onClick()
  assert.deepEqual(f.selected, [])
  // 即使已有控件事件迟到，重试也不能读取变化后的输入或创建第二个请求键。
  f.update('select', 'bank')
  f.update('voucher-upload', 'voucher')
  f.update('textarea', '迟到的输入')
  f.setExecute(async () => ({ data: order('PAID') }))
  await f.button('purchasePayment.retryPay').props.onClick()
  await nextTick()
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0]?.key, f.calls[1]?.key)
  assert.deepEqual(f.calls[1]?.body, f.calls[0]?.body)
  assert.equal(f.calls[1]?.id, 'deposit')
  assert.equal(f.changed.length, 1)
  assert.equal(f.locks.at(-1), false)
})

test('已付清、取消与零应付仅显示状态，不渲染付款表单及确认或重试按钮', (context) => {
  for (const status of ['PAID', 'CANCELLED', 'NO_PAYMENT'] as const) {
    const f = fixture(status)
    context.after(f.dispose)
    assert.equal(f.nodes().some(item => item.tag === 'fieldset'), false)
    assert.equal(f.fields().length, 0)
    assert.equal(f.findButton('purchasePayment.confirmPay'), undefined)
    assert.equal(f.findButton('purchasePayment.retryPay'), undefined)
    assert.equal(f.calls.length, 0)
  }
})

test('404 或版本冲突后禁用输入，只提供重新核对且不会再次付款', async (context) => {
  for (const status of [404, 409]) {
    const f = fixture()
    context.after(f.dispose)
    f.update('select', 'bank')
    f.update('voucher-upload', 'voucher')
    f.setExecute(async () => {
      throw Object.assign(new Error('状态已更新'), { status })
    })
    await f.button('purchasePayment.confirmPay').props.onClick()
    await nextTick()
    assert.ok(f.fields().every(item => item.props.disabled === true))
    assert.equal(f.findButton('purchasePayment.confirmPay'), undefined)
    f.button('purchasePayment.recheck').props.onClick()
    assert.equal(f.refreshes.length, 1)
    assert.equal(f.calls.length, 1)
  }
})
