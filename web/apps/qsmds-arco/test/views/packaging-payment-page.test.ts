import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行页面脚本核实深链接访问、已付快照和离页保护。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, reactive, ref } from 'vue'

async function fixture() {
  const source = await readFile(new URL('../../src/views/workbenches/packaging-payments/payment-page.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const account = reactive({ authEpoch: 1, authState: 'authenticated' })
  const route = reactive({ name: 'qsFinanceRealtimePackagingPayment', params: { requestId: 'cost-1' } })
  const read = ref(true)
  const pay = ref(true)
  const recipient = { id: 'current', paymentMethod: 'ALIPAY', qrMediaAssetId: 'qr' }
  const snapshot = { id: 'snapshot', paymentMethod: 'WECHAT', qrMediaAssetId: 'old' }
  const payment = {
    detail: ref({ id: 'cost-1', status: 'PENDING_PAYMENT', paymentRecipientProfile: { accounts: [recipient, { id: 'bank', paymentMethod: 'BANK_TRANSFER' }, { id: 'missing-qr', paymentMethod: 'WECHAT' }] }, paymentReceipt: { recipient: snapshot } }),
    loading: ref(false),
    busy: ref(false),
    unknown: ref(false),
    stale: ref(false),
    loadError: ref(''),
    actionError: ref(''),
    recipientAccountId: ref('current'),
    recipient: ref(recipient),
    voucherFile: ref(null),
    remark: ref(''),
    fieldError: ref(null),
    payable: ref(true),
    load() {},
    confirm: async () => true,
  }
  const lifecycle: Record<string, (...args: any[]) => any> = {}
  const warnings: unknown[] = []
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ enabled, canPay, requestId, recipients, displayedRecipient, fieldsLocked, canLeave })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: (permission: string) => permission === 'packaging-costs:read' ? read.value : pay.value }),
    useAppAccountStore: () => account,
    useRoute: () => route,
    useRouter: () => ({ push() {} }),
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    useQsToast: () => ({ warning: (value: unknown) => warnings.push(value), success() {} }),
    usePackagingPayment: () => payment,
    defineOptions() {},
    onMounted: (callback: () => void) => lifecycle.mount = callback,
    onActivated: (callback: () => void) => lifecycle.activate = callback,
    onDeactivated: (callback: () => void) => lifecycle.deactivate = callback,
    onBeforeUnmount: (callback: () => void) => lifecycle.unmount = callback,
    onBeforeRouteLeave: (callback: () => boolean) => lifecycle.leave = callback,
    onBeforeRouteUpdate: (callback: () => boolean) => lifecycle.update = callback,
    window: { addEventListener: (name: string, callback: (...args: any[]) => void) => lifecycle[name] = callback, removeEventListener() {} },
  }))!
  lifecycle.mount!()
  return { state, account, route, read, pay, payment, lifecycle, warnings, dispose: () => {
    lifecycle.unmount!()
    scope.stop()
  } }
}

test('独立页深链接只在登录、读权限和正确路由同时成立时启用；付款另校验写权限', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.equal(f.state.enabled.value, true)
  f.pay.value = false
  assert.equal(f.state.enabled.value, true)
  assert.equal(f.state.canPay.value, false)
  f.read.value = false
  assert.equal(f.state.enabled.value, false)
  f.read.value = true
  f.account.authState = 'anonymous'
  assert.equal(f.state.enabled.value, false)
  f.account.authState = 'authenticated'
  f.route.name = 'other'
  assert.equal(f.state.enabled.value, false)
})

test('已付款显示实际收款快照；待付仅提供有二维码的支付宝和微信', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.deepEqual(Array.from(f.state.recipients.value, (item: { value: string }) => item.value), ['current'])
  assert.equal(f.state.displayedRecipient.value.id, 'current')
  f.payment.detail.value.status = 'PAID'
  assert.equal(f.state.displayedRecipient.value.id, 'snapshot')
})

test('提交中和结果未知时阻止离页、切换提报与刷新窗口，撤权后允许认证流程跳转', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.equal(f.lifecycle.leave!(), true)
  f.payment.busy.value = true
  assert.equal(f.lifecycle.leave!(), false)
  assert.equal(f.lifecycle.update!(), false)
  f.payment.busy.value = false
  f.payment.unknown.value = true
  assert.equal(f.state.fieldsLocked.value, true)
  assert.equal(f.lifecycle.leave!(), false)
  const event = {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    returnValue: null,
  }
  f.lifecycle.beforeunload!(event)
  assert.equal(event.defaultPrevented, true)
  f.pay.value = false
  assert.equal(f.lifecycle.leave!(), true)
})
