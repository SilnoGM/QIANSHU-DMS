import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行页面脚本核实直达链接、离页保护与审批提交。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, reactive, ref } from 'vue'

const PAGE = new URL(
  '../../src/views/admin/fund-account-management/withdrawal-approvals/approval-page.vue',
  import.meta.url,
)

async function fixture() {
  const source = await readFile(PAGE, 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const account = reactive({ authEpoch: 1, authState: 'authenticated' })
  const route = reactive({ name: 'qsFinanceFundWithdrawalApproval', params: { id: 'withdrawal-1' } })
  const canReview = ref(true)
  const uploads: File[] = []
  let approveResult = true
  let rejectResult = true
  const review = {
    detail: ref({ id: 'withdrawal-1', status: 'PENDING', version: 1 }),
    loading: ref(false),
    busy: ref(false),
    uploading: ref(false),
    stale: ref(false),
    invalid: ref(false),
    loadError: ref(''),
    actionError: ref(''),
    proofUrl: ref<string | null>(null),
    proofLoading: ref(false),
    proofError: ref(''),
    previewUrl: ref<string | null>(null),
    previewFileName: ref(''),
    upload: ref<{ mediaAssetId: string } | null>(null),
    rejectReason: ref(''),
    fieldError: ref<string | null>(null),
    pending: ref(true),
    locked: ref(false),
    load() {},
    loadProof() {},
    uploadProof: async (file: File) => {
      uploads.push(file)
      return true
    },
    approve: async () => approveResult,
    reject: async () => rejectResult,
    reset() {},
  }
  const toasts: Array<{ kind: string, message: string }> = []
  const pushes: unknown[] = []
  const lifecycle: Record<string, (...args: any[]) => any> = {}
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ enabled, requestId, canSubmit, approveDisabled, canLeave, approveWithdrawal, rejectWithdrawal, openList, handleFile })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: () => canReview.value }),
    useAppAccountStore: () => account,
    useRoute: () => route,
    useRouter: () => ({ push: (value: unknown) => pushes.push(value) }),
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    useQsToast: () => ({
      success: (message: string) => toasts.push({ kind: 'success', message }),
      warning: (message: string) => toasts.push({ kind: 'warning', message }),
    }),
    useWithdrawalReview: () => review,
    useFileDrop: () => ({ handlers: {}, isDragging: ref(false) }),
    IMAGE_ONLY_ACCEPT: 'image/*',
    defineOptions() {},
    onMounted: (callback: () => void) => lifecycle.mount = callback,
    onActivated: (callback: () => void) => lifecycle.activate = callback,
    onDeactivated: (callback: () => void) => lifecycle.deactivate = callback,
    onBeforeUnmount: (callback: () => void) => lifecycle.unmount = callback,
    onBeforeRouteLeave: (callback: () => boolean) => lifecycle.leave = callback,
    onBeforeRouteUpdate: (callback: () => boolean) => lifecycle.update = callback,
    window: {
      addEventListener: (name: string, callback: (...args: any[]) => void) => lifecycle[name] = callback,
      removeEventListener() {},
    },
  }))!
  lifecycle.mount!()
  return {
    state,
    route,
    canReview,
    review,
    uploads,
    toasts,
    pushes,
    lifecycle,
    setApproveResult: (value: boolean) => approveResult = value,
    setRejectResult: (value: boolean) => rejectResult = value,
    dispose: () => {
      lifecycle.unmount!()
      scope.stop()
    },
  }
}

test('审批页使用页头、三栏布局与业务组件，不再借用弹窗', async () => {
  const source = await readFile(PAGE, 'utf8')
  assert.match(source, /defineOptions\(\{ name: 'FinanceFundWithdrawalApproval' \}\)/u)
  assert.match(source, /<FaPageHeader/u)
  assert.match(source, /<FaPageMain/u)
  assert.match(source, /useWithdrawalReview/u)
  assert.match(source, /qsFinanceFundWithdrawalApprovals/u)
  assert.match(source, /fundWithdrawal\.approvalDetailTitle/u)
  assert.doesNotMatch(source, /QsGenericModal/u)
})

test('直达链接决定单号，路由名不符或登录态失效时整页不启用', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.equal(f.state.requestId.value, 'withdrawal-1')
  assert.equal(f.state.enabled.value, true)
  f.route.name = 'qsFinanceFundWithdrawalApprovals'
  assert.equal(f.state.enabled.value, false)
  f.route.name = 'qsFinanceFundWithdrawalApproval'
  f.route.params.id = ''
  assert.equal(f.state.requestId.value, null)
})

test('审批能力由权限与状态共同约束：无截图不能通过，已处理不能提交', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.equal(f.state.canSubmit.value, true)
  assert.equal(f.state.approveDisabled.value, true)
  f.review.upload.value = { mediaAssetId: 'asset-1' }
  assert.equal(f.state.approveDisabled.value, false)
  f.review.stale.value = true
  assert.equal(f.state.canSubmit.value, false)
  f.review.stale.value = false
  f.review.pending.value = false
  assert.equal(f.state.canSubmit.value, false)
  f.review.pending.value = true
  f.canReview.value = false
  assert.equal(f.state.canSubmit.value, false)
})

test('提交中离开页面会被拦截，空闲时放行', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.equal(f.state.canLeave(), true)
  f.review.locked.value = true
  assert.equal(f.state.canLeave(), false)
  assert.deepEqual(f.toasts.at(-1), {
    kind: 'warning',
    message: 'fundWithdrawal.approvalDetail.leaveBlocked',
  })
})

test('通过和驳回成功后各弹一次成功提示，失败时不提示', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  await f.state.approveWithdrawal()
  assert.equal(f.toasts.at(-1)?.message, 'fundWithdrawal.approve.success')
  f.setApproveResult(false)
  f.setRejectResult(false)
  await f.state.approveWithdrawal()
  await f.state.rejectWithdrawal()
  assert.equal(f.toasts.filter(item => item.message === 'fundWithdrawal.approve.success').length, 1)
  assert.equal(f.toasts.filter(item => item.message === 'fundWithdrawal.reject.success').length, 0)
  f.setRejectResult(true)
  await f.state.rejectWithdrawal()
  assert.equal(f.toasts.at(-1)?.message, 'fundWithdrawal.reject.success')
})

test('选择文件后交给上传入参并清空 input，返回列表走列表路由名', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  const file = new File(['png'], 'proof.png', { type: 'image/png' })
  const target = { files: [file] as File[], value: 'chosen' }
  f.state.handleFile({ target })
  assert.equal(f.uploads.length, 1)
  assert.equal(target.value, '')
  f.state.openList()
  // 跨 vm 上下文的对象原型不同，只比较路由名。
  assert.equal((f.pushes.at(-1) as { name?: string } | undefined)?.name, 'qsFinanceFundWithdrawalApprovals')
})
