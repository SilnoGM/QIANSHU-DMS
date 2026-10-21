import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行真实提报事件，确保仅成功才关闭且正确检查权限。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, reactive, ref, watch } from 'vue'
import { buildPackagingPaymentRequestText } from '../../src/views/operations/warehouse-arrivals/packaging-cost.logic'

async function fixture() {
  const source = await readFile(new URL('../../src/views/operations/warehouse-arrivals/packaging-cost-action.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const eligible = ref(true)
  const contextLoading = ref(false)
  const contextError = ref('')
  const contextSource = ref({ shipmentNo: 'PKG-1', shippingMarkText: 'MARK-1', purchaseOrderNo: 'PO-1', salesOrderNo: 'SO-1', owner: { name: '销售出单人' }, existingRequests: [] as Array<{ id: string, status: string }> | undefined })
  const permission = ref(true)
  const unavailableReason = ref<string | null>(null)
  const success: string[] = []
  const submitted: unknown[] = []
  const events: string[] = []
  let result: unknown = null
  const account = reactive({ authEpoch: 1 })
  const copies: string[] = []
  const warnings: Array<{ message: string, options: { action: { onClick: () => void } } }> = []
  const routes: unknown[] = []
  let writeText = async (_text: string) => {}
  const record = { id: 'part-1', shipmentNo: 'PKG-1', shippingMarkText: 'MARK-1', purchaseOrder: { orderNo: 'PO-1' }, salesSource: { orderNo: 'SO-1' } }
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ context, submit, visible, submitDisabledHint, formVisible, historyError, confirmContinue })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    watch,
    defineProps: () => ({ shipment: record, enabled: true }),
    defineEmits: () => (name: string) => events.push(name),
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: () => permission.value }),
    useAppAccountStore: () => account,
    useRouter: () => ({ resolve: (location: unknown) => {
      routes.push(location)
      return { href: '/qs-finance/realtime-payments/packaging-payments/request/payment' }
    } }),
    buildPackagingPaymentRequestText,
    window: { location: { href: 'https://dms.example.com/warehouse-arrivals' } },
    navigator: { clipboard: { writeText: (text: string) => {
      copies.push(text)
      return writeText(text)
    } } },
    useQsToast: () => ({ success: (message: string) => success.push(message), warning: (message: string, options: { action: { onClick: () => void } }) => warnings.push({ message, options }) }),
    usePackagingCostContext: () => ({ context: contextSource, loading: contextLoading, error: contextError, eligible, unavailableReason, reload: () => {} }),
    usePackagingCostSubmission: () => ({ submit: async (draft: unknown) => {
      submitted.push(draft)
      return result
    }, busy: ref(false), error: ref(''), pending: ref(false) }),
  })) as { context: { value: Record<string, string> }, submit: (value: unknown) => Promise<void>, visible: { value: boolean }, submitDisabledHint: { value: string }, formVisible: { value: boolean }, historyError: { value: string }, confirmContinue: () => void }
  return {
    state,
    eligible,
    contextSource,
    contextLoading,
    contextError,
    permission,
    unavailableReason,
    account,
    success,
    submitted,
    events,
    copies,
    warnings,
    routes,
    setResult: (value: unknown) => { result = value },
    setWriteText: (value: typeof writeText) => { writeText = value },
    dispose: () => scope.stop(),
  }
}
const savedRequest = { id: 'request', shippingMarkText: 'SAVED-MARK', packagingVendor: 'CHENGXIN', packagingTypeName: '木箱', amount: '20000.0000' }

test('费用表单展示销售归属，失败不复制不关闭，成功复制服务端申请信息并通知列表', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  const { state, eligible, permission, unavailableReason, success, submitted, events } = f
  assert.deepEqual(JSON.parse(JSON.stringify(state.context.value)), { shipmentId: 'part-1', shipmentNo: 'PKG-1', shippingMarkText: 'MARK-1', purchaseOrderNo: 'PO-1', salesOrderNo: 'SO-1', ownerName: '销售出单人', ownerAvatarUrl: null })
  await state.submit({ amount: '10.00' })
  assert.equal(state.visible.value, true)
  assert.equal(success.length, 0)
  assert.equal(f.copies.length, 0)
  eligible.value = false
  unavailableReason.value = 'noSalesSource'
  await state.submit({})
  assert.equal(submitted.length, 1)
  assert.equal(state.submitDisabledHint.value, 'warehousePackagingCost.noSalesSource')
  eligible.value = true
  permission.value = false
  await state.submit({})
  assert.equal(submitted.length, 1)
  permission.value = true
  f.setResult(savedRequest)
  await state.submit({ amount: '10.00' })
  assert.deepEqual(success, ['warehousePackagingCost.submitCopied'])
  assert.equal(f.copies[0], '【打木架/木箱付款申请】\n货件唛头：SAVED-MARK\n包装厂商：沙井·诚信木箱\n本次申请支付 [木箱]费用：20000.00 元。\n付款链接： https://dms.example.com/qs-finance/realtime-payments/packaging-payments/request/payment')
  assert.deepEqual(JSON.parse(JSON.stringify(f.routes)), [{ name: 'qsFinanceRealtimePackagingPayment', params: { requestId: 'request' } }])
  assert.equal(state.visible.value, false)
  assert.deepEqual(events, ['submitted', 'close'])
})

test('复制被拒绝仍保留已提交申请，允许仅重试复制，复制等待期间不能重复提报', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.setResult(savedRequest)
  let reject!: (reason: unknown) => void
  f.setWriteText(() => new Promise((_, no) => reject = no))
  const pending = f.state.submit({ amount: '10.00' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.copies.length, 1)
  await f.state.submit({ amount: '99.00' })
  assert.equal(f.submitted.length, 1)
  reject(new Error('clipboard denied'))
  await pending
  assert.equal(f.state.visible.value, false)
  assert.deepEqual(f.events, ['submitted', 'close'])
  assert.equal(f.success.length, 0)
  assert.equal(f.warnings[0]?.message, 'warehousePackagingCost.submitCopyFailed')
  f.setWriteText(async () => {})
  f.warnings[0]!.options.action.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.copies.length, 2)
  assert.equal(f.copies[1], f.copies[0])
  assert.equal(f.submitted.length, 1)
  assert.deepEqual(f.success, ['warehousePackagingCost.submitCopied'])
})

test('换账号后旧申请的复制重试失效，不能把上一身份的申请复制到剪贴板', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.setResult(savedRequest)
  f.setWriteText(async () => {
    throw new Error('clipboard denied')
  })
  await f.state.submit({})
  assert.equal(f.warnings.length, 1)
  f.account.authEpoch++
  f.warnings[0]!.options.action.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.copies.length, 1)
  assert.equal(f.submitted.length, 1)
})

test('无历史直接显示表单，待付款或已支付记录都必须确认后才允许继续提报', async (context) => {
  for (const status of ['PENDING_PAYMENT', 'PAID']) {
    const f = await fixture()
    context.after(f.dispose)
    assert.equal(f.state.formVisible.value, true)
    f.contextSource.value = { ...f.contextSource.value, existingRequests: [{ id: 'old-request', status }] }
    assert.equal(f.state.formVisible.value, false)
    await f.state.submit({})
    assert.equal(f.submitted.length, 0)
    f.state.confirmContinue()
    assert.equal(f.state.formVisible.value, true)
    await f.state.submit({})
    assert.equal(f.submitted.length, 1)
    f.contextSource.value = { ...f.contextSource.value, existingRequests: [{ id: 'new-request', status }] }
    assert.equal(f.state.formVisible.value, false)
  }
})

test('取消重复提报只关闭；加载、失败、缺少检查结果和无权限均不能绕过确认', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.contextSource.value.existingRequests = [{ id: 'old', status: 'PAID' }]
  for (const flag of [f.contextLoading, f.contextError]) {
    flag.value = typeof flag.value === 'boolean' ? true : 'offline'
    f.state.confirmContinue()
    await f.state.submit({})
    assert.equal(f.state.formVisible.value, false)
    assert.equal(f.submitted.length, 0)
    flag.value = typeof flag.value === 'boolean' ? false : ''
  }
  f.contextSource.value = { ...f.contextSource.value, existingRequests: undefined }
  f.state.confirmContinue()
  assert.equal(f.state.formVisible.value, false)
  assert.equal(f.state.historyError.value, 'warehousePackagingCost.history.checkFailed')
  f.contextSource.value = { ...f.contextSource.value, existingRequests: [{ id: 'old', status: 'PAID' }] }
  f.permission.value = false
  f.state.confirmContinue()
  assert.equal(f.state.formVisible.value, false)
  f.state.visible.value = false
  assert.deepEqual(f.events, ['close'])
  assert.equal(f.submitted.length, 0)
})
