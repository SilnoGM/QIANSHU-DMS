import type { Ref } from 'vue'
import type { PaymentRecipientProfileDto, PurchasePayableDto, PurchasePayableOrderDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行真实表单、勾选列表和图片脚本，验证交互与付款提交边界。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { sumMoneyValues } from '../../src/components/base/MoneyInput/logic'
import { canPayPurchasePayable } from '../../src/views/workbenches/purchase-payments/purchase-payments.logic'

const ROOT = new URL('../../src/views/workbenches/purchase-payments/', import.meta.url)
const PROFILE: PaymentRecipientProfileDto = {
  id: 'profile-a',
  version: 3,
  accounts: [{ id: 'account-a', paymentMethod: 'ALIPAY', recipientName: '供应商甲', qrMediaAssetId: 'qr-a', qrContentUrl: null, bankName: null, bankAccount: null, bankBranch: null }],
}
const file = (size = 4, type = 'image/png') => new File([new Uint8Array(size)], 'voucher.png', { type })
function installment(id: string, amount: string, status: PurchasePayableDto['status'] = 'PENDING_PAYMENT'): PurchasePayableDto {
  return { id, paymentReceipt: null, paymentType: id.includes('deposit') ? 'DEPOSIT' : 'BALANCE', dueAmount: amount, paidAmount: '0.00', remainingAmount: amount, status, version: 1, paidAt: null, paidBy: null }
}
function order(id: string, items = [installment(`${id}-deposit`, '10.00'), installment(`${id}-balance`, '20.00')]): PurchasePayableOrderDto {
  return { id, orderNo: `PO/${id}`, orderDate: '2026-09-17', purchaseType: 'STOCK', supplierName: '供应商甲', salesOrderNo: null, purchaseTotalAmount: '30.00', currencyCode: 'CNY', accountOwnerType: 'COMPANY', owner: null, paymentRecipientProfile: structuredClone(PROFILE), items }
}

async function execute<T>(name: string, props: object, expose: string[], onEvent?: (name: string, payload: unknown) => void) {
  const source = await readFile(new URL(name, ROOT), 'utf8')
  const script = parse(source).descriptor.scriptSetup!.content.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const events: Array<[string, unknown]> = []
  const revoked: string[] = []
  const scope = effectScope()
  let sequence = 0
  let unmount = () => {}
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}; ({ ${expose.join(', ')} })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    shallowRef,
    watch,
    sumMoneyValues,
    canPayPurchasePayable,
    defineProps: () => props,
    defineEmits: () => (name: string, payload: unknown) => {
      events.push([name, payload])
      onEvent?.(name, payload)
    },
    useI18n: () => ({ t: (key: string) => key }),
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    onBeforeUnmount: (callback: () => void) => unmount = callback,
    URL: { createObjectURL: () => `blob:batch-${++sequence}`, revokeObjectURL: (url: string) => revoked.push(url) },
  })) as T
  return { state, events, revoked, dispose: () => {
    unmount()
    scope.stop()
  } }
}
interface FormState {
  statementGenerating: Ref<boolean>
  selectedIds: Ref<string[]>
  recipientAccountId: Ref<string>
  voucher: Ref<File | null>
  total: Ref<string>
  canSubmit: Ref<boolean>
  changeSupplier: (value: string | null) => void
  selectOrders: (ids: string[]) => void
  submit: () => void
}
async function formFixture(enabled = true) {
  const props = reactive({ supplierValue: null as string | null, orders: [order('a'), order('b')], suppliers: [{ value: 'supplier-a', label: '供应商甲' }], suppliersLoading: false, loading: false, error: '', busy: false, unknown: false, stale: false, enabled })
  const f = await execute<FormState>('purchase-batch-payment-form.vue', props, ['statementGenerating', 'selectedIds', 'recipientAccountId', 'voucher', 'total', 'canSubmit', 'changeSupplier', 'selectOrders', 'submit'], (name, value) => {
    if (name === 'supplierChange') {
      props.supplierValue = value as string | null
    }
  })
  async function fill() {
    f.state.changeSupplier('supplier-a')
    f.state.selectOrders(['a'])
    await nextTick()
    f.state.recipientAccountId.value = 'account-a'
    f.state.voucher.value = file()
  }
  return { ...f, props, fill }
}
const submissions = (events: Array<[string, unknown]>) => events.filter(([name]) => name === 'submit')
function assertCleared(state: FormState) {
  assert.equal(state.selectedIds.value.length, 0)
  assert.equal(state.recipientAccountId.value, '')
  assert.equal(state.voucher.value, null)
  assert.equal(state.canSubmit.value, false)
}

test('生成对账单期间保留选择但锁定付款和改选，生成结束恢复原表单', async (context) => {
  const f = await formFixture()
  context.after(f.dispose)
  await f.fill()
  f.state.statementGenerating.value = true
  f.state.selectOrders([])
  f.state.changeSupplier(null)
  f.state.submit()
  assert.equal(f.state.canSubmit.value, false)
  assert.deepEqual([...f.state.selectedIds.value], ['a'])
  assert.equal(f.props.supplierValue, 'supplier-a')
  assert.equal(submissions(f.events).length, 0)
  f.state.statementGenerating.value = false
  assert.equal(f.state.canSubmit.value, true)
})

test('汇总仅包含所选订单尚未支付阶段，使用两位十进制精确加总', async (context) => {
  const f = await formFixture()
  context.after(f.dispose)
  f.props.orders = [
    order('a', [installment('a-deposit', '0.10'), installment('a-balance', '999.99', 'PAID')]),
    order('b', [installment('b-deposit', '0.20'), installment('b-balance', '0.00')]),
    order('c', [installment('c-deposit', '900719925474.10'), installment('c-balance', '50.00', 'CANCELLED')]),
  ]
  await nextTick()
  f.state.selectOrders(['a', 'b'])
  assert.equal(f.state.total.value, '0.30')
  f.state.selectOrders(['b', 'c'])
  assert.equal(f.state.total.value, '900719925474.30')
  f.state.selectOrders([])
  assert.equal(f.state.total.value, '0.00')
})

test('列表全选、半选、取消勾选只包含可付款订单，锁定时不能改动或展开', async (context) => {
  const props = reactive({ orders: [order('a'), order('b'), order('paid', [installment('paid-deposit', '5.00', 'PAID')]), order('zero', [installment('zero-deposit', '0.00')])], selected: [] as string[], disabled: false })
  const f = await execute<{ selectAll: Ref<boolean | 'indeterminate'>, expanded: Ref<string[]>, select: (id: string, value: boolean) => void, toggleAll: (value: boolean) => void, toggleExpanded: (id: string) => void }>('purchase-batch-payment-orders.vue', props, ['selectAll', 'expanded', 'select', 'toggleAll', 'toggleExpanded'], (name, value) => {
    if (name === 'select') {
      props.selected = value as string[]
    }
  })
  context.after(f.dispose)
  f.state.toggleAll(true)
  assert.deepEqual([...props.selected], ['a', 'b'])
  assert.equal(f.state.selectAll.value, true)
  f.state.select('b', false)
  assert.equal(f.state.selectAll.value, 'indeterminate')
  f.state.select('paid', true)
  f.state.select('zero', true)
  assert.deepEqual([...props.selected], ['a'])
  f.state.select('b', true)
  f.state.select('b', true)
  assert.deepEqual([...props.selected], ['a', 'b'])
  f.state.toggleAll(false)
  assert.equal(f.state.selectAll.value, false)
  f.state.toggleExpanded('a')
  assert.deepEqual([...f.state.expanded.value], ['a'])
  props.disabled = true
  f.state.toggleAll(true)
  f.state.select('a', true)
  f.state.toggleExpanded('a')
  assert.deepEqual([...props.selected], [])
  assert.deepEqual([...f.state.expanded.value], ['a'])
})

test('收款账号和单张截图均必填，完整表单才向父级发送订单、账号版本和原File', async (context) => {
  const f = await formFixture()
  context.after(f.dispose)
  f.state.selectOrders(['a'])
  f.state.submit()
  f.state.recipientAccountId.value = 'account-a'
  f.state.submit()
  assert.equal(submissions(f.events).length, 0)
  const screenshot = file()
  f.state.voucher.value = screenshot
  f.state.recipientAccountId.value = 'foreign-account'
  f.state.submit()
  assert.equal(f.state.canSubmit.value, false)
  f.state.recipientAccountId.value = 'account-a'
  f.state.submit()
  const input = submissions(f.events)[0]?.[1] as { orders: PurchasePayableOrderDto[], recipientAccountId: string, recipientProfileVersion: number, paymentMethod: string, file: File }
  assert.deepEqual([...input.orders].map(item => item.id), ['a'])
  assert.equal(input.recipientAccountId, 'account-a')
  assert.equal(input.recipientProfileVersion, 3)
  assert.equal(input.paymentMethod, 'ALIPAY')
  assert.equal(input.file, screenshot)
})

test('busy和unknown保留原表单，禁止更换供应商、勾选和普通提交', async (context) => {
  for (const flag of ['busy', 'unknown'] as const) {
    const f = await formFixture()
    context.after(f.dispose)
    await f.fill()
    const screenshot = f.state.voucher.value
    f.props[flag] = true
    f.state.changeSupplier('supplier-b')
    f.state.selectOrders(['b'])
    f.state.submit()
    assert.equal(f.props.supplierValue, 'supplier-a')
    assert.deepEqual([...f.state.selectedIds.value], ['a'])
    assert.equal(f.state.voucher.value, screenshot)
    assert.equal(submissions(f.events).length, 0)
  }
})

test('加载和旧状态禁止确认；可恢复上传错误允许修正重试，权限撤销清理未知结果表单', async (context) => {
  const f = await formFixture()
  context.after(f.dispose)
  await f.fill()
  for (const flag of ['loading', 'stale'] as const) {
    f.props[flag] = true
    f.state.submit()
    f.props[flag] = false
  }
  assert.equal(submissions(f.events).length, 0)
  f.props.error = 'upload failed'
  f.state.voucher.value = file()
  f.state.submit()
  assert.equal(submissions(f.events).length, 1)
  f.props.unknown = true
  f.props.enabled = false
  await nextTick()
  assertCleared(f.state)
})

test('无权限初始挂载时不能选择或付款', async (context) => {
  const f = await formFixture(false)
  context.after(f.dispose)
  f.state.changeSupplier('supplier-a')
  f.state.selectOrders(['a'])
  f.state.submit()
  assert.equal(f.props.supplierValue, null)
  assertCleared(f.state)
  assert.equal(f.events.length, 0)
})

test('换供应商及新orders引用均清空选择、账号和截图，同ID新金额仍需重新核对', async (context) => {
  const f = await formFixture()
  context.after(f.dispose)
  await f.fill()
  f.state.changeSupplier('supplier-b')
  assertCleared(f.state)
  assert.deepEqual(f.events.at(-1), ['supplierChange', 'supplier-b'])
  await f.fill()
  f.props.supplierValue = null
  assertCleared(f.state)
  await f.fill()
  f.props.orders = [order('a', [installment('a-deposit', '60.00')])]
  await nextTick()
  assertCleared(f.state)
  assert.equal(f.state.total.value, '0.00')
})

test('不同收款资料或版本、缺失资料以及全部付清的订单均不能付款', async (context) => {
  const f = await formFixture()
  context.after(f.dispose)
  for (const variant of ['profile', 'version', 'missing', 'paid'] as const) {
    const a = order('a')
    const b = order('b')
    if (variant === 'profile') {
      b.paymentRecipientProfile!.id = 'profile-b'
    }
    else if (variant === 'version') {
      b.paymentRecipientProfile!.version++
    }
    else if (variant === 'missing') {
      b.paymentRecipientProfile = null
    }
    else {
      b.items.forEach(item => item.status = 'PAID')
    }
    f.props.orders = [a, b]
    await nextTick()
    f.state.selectOrders(['a', 'b'])
    f.state.recipientAccountId.value = 'account-a'
    f.state.voucher.value = file()
    f.state.submit()
    assert.equal(f.state.canSubmit.value, false, variant)
  }
  assert.equal(submissions(f.events).length, 0)
})

async function voucherFixture() {
  const props = reactive({ modelValue: null as File | null, disabled: false })
  const f = await execute<{ select: (input: { file: File }) => void, remove: () => void, preview: Ref<string>, error: Ref<string> }>('purchase-batch-payment-voucher.vue', props, ['select', 'remove', 'preview', 'error'], (name, value) => {
    if (name === 'update:modelValue') {
      props.modelValue = value as File | null
    }
  })
  return { ...f, props }
}

test('凭证只接受非空JPG、PNG、WebP，最大10MiB；无效文件不能替换当前凭证', async (context) => {
  const f = await voucherFixture()
  context.after(f.dispose)
  const original = file()
  f.state.select({ file: original })
  await nextTick()
  for (const [invalid, key] of [[file(1, 'application/pdf'), 'imageOnly'], [file(0), 'imageEmpty'], [file(10 * 1024 * 1024 + 1), 'imageTooLarge']] as const) {
    f.state.select({ file: invalid })
    await nextTick()
    assert.equal(f.props.modelValue, original)
    assert.equal(f.state.error.value, `purchasePayment.batch.${key}`)
  }
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    const valid = file(10 * 1024 * 1024, type)
    f.state.select({ file: valid })
    await nextTick()
    assert.equal(f.props.modelValue, valid)
    assert.equal(f.state.error.value, '')
  }
})

test('替换、移除和销毁回收本地预览；锁定期间不能改动截图', async (context) => {
  const f = await voucherFixture()
  context.after(f.dispose)
  const first = file()
  f.state.select({ file: first })
  await nextTick()
  assert.equal(f.state.preview.value, 'blob:batch-1')
  f.props.disabled = true
  f.state.select({ file: file() })
  f.state.remove()
  assert.equal(f.props.modelValue, first)
  assert.deepEqual(f.revoked, [])
  f.props.disabled = false
  f.state.select({ file: file() })
  await nextTick()
  assert.deepEqual(f.revoked, ['blob:batch-1'])
  f.state.remove()
  await nextTick()
  assert.equal(f.props.modelValue, null)
  assert.equal(f.state.preview.value, '')
  assert.deepEqual(f.revoked, ['blob:batch-1', 'blob:batch-2'])
  f.state.select({ file: file() })
  await nextTick()
  f.dispose()
  assert.deepEqual(f.revoked, ['blob:batch-1', 'blob:batch-2', 'blob:batch-3'])
})
