import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 使用真实弹窗脚本验证异步恢复边界。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, reactive, ref, shallowRef } from 'vue'
import { buildPurchaseOrderReviewRequest } from '../../src/views/operations/purchase-orders/purchase-order-detail.logic'

async function createFixture() {
  const source = await readFile(new URL('../../src/views/operations/purchase-orders/purchase-order-review-modal.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const props = reactive({ orderId: 'order-1', modelValue: true, currencies: [] })
  const account = reactive({ authEpoch: 1 })
  const current = { id: 'order-1', version: 1, orderStatus: 'PENDING_REVIEW', reviewSummary: null }
  const events: Array<{ name: string, value: unknown }> = []
  const success: string[] = []
  let contextCalls = 0
  let reviewCalls = 0
  const api = {
    getById: async () => ({ data: { ...current } }),
    reviewContext: async () => {
      contextCalls += 1
      return { data: { available: true, message: null as string | null } }
    },
    review: async (_id: string, _data: unknown, _signal: AbortSignal): Promise<{ data: typeof current }> => {
      reviewCalls += 1
      throw new Error('响应超时')
    },
  }
  const state = runInNewContext(ts.transpileModule(`${script}\n;({ loadDetail, submit, reset, canConfirm, detail, error, reason, loading, submitting, visible })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    AbortController,
    computed,
    ref,
    shallowRef,
    defineProps: () => props,
    defineEmits: () => (name: string, value: unknown) => {
      events.push({ name, value })
      if (name === 'update:modelValue') {
        props.modelValue = value as boolean
      }
    },
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: () => true }),
    useAppAccountStore: () => account,
    useQsToast: () => ({ success: (message: string) => success.push(message) }),
    watch: () => {},
    onBeforeUnmount: () => {},
    purchaseOrdersApi: api,
    buildPurchaseOrderReviewRequest,
    getPurchaseOrderApiFailure: (failure: Error) => ({ message: failure.message }),
    isPurchaseOrderAbortError: () => false,
  }) as {
    loadDetail: (previousFailure?: string) => Promise<void>
    submit: () => Promise<void>
    reset: () => void
    canConfirm: { value: boolean }
    detail: { value: typeof current | null }
    error: { value: string }
    reason: { value: string }
    loading: { value: boolean }
    submitting: { value: boolean }
    visible: { value: boolean }
  }
  return { state, current, api, props, account, events, success, calls: () => ({ contextCalls, reviewCalls }) }
}

test('审核条件不可用或查询失败时禁止提交，明确显示原因；恢复后可重新核对', async () => {
  const fixture = await createFixture()
  fixture.api.reviewContext = async () => ({ data: { available: false, message: '供应商唛头规则未启用，请联系管理员配置' } })
  await fixture.state.loadDetail()
  assert.equal(fixture.state.canConfirm.value, false)
  assert.match(fixture.state.error.value, /供应商唛头规则未启用/u)
  await fixture.state.submit()
  assert.equal(fixture.calls().reviewCalls, 0)
  fixture.api.reviewContext = async () => {
    throw new Error('检查失败')
  }
  await fixture.state.loadDetail()
  assert.equal(fixture.state.canConfirm.value, false)
  assert.match(fixture.state.error.value, /检查失败/u)
  fixture.api.reviewContext = async () => ({ data: { available: true, message: null } })
  await fixture.state.loadDetail()
  assert.equal(fixture.state.canConfirm.value, true)
})

test('未知提交结果重查已通过或已取消，显示真实状态而非失败，不重复提交', async () => {
  for (const terminal of ['CONFIRMED', 'COMPLETED', 'CANCELLED']) {
    const fixture = await createFixture()
    await fixture.state.loadDetail()
    fixture.current.orderStatus = terminal
    await fixture.state.submit()
    assert.equal(fixture.state.detail.value?.orderStatus, terminal)
    assert.equal(fixture.state.error.value, '')
    assert.equal(fixture.state.canConfirm.value, false)
    assert.equal(fixture.state.submitting.value, false)
    assert.equal(fixture.calls().reviewCalls, 1)
    assert.equal(fixture.calls().contextCalls, 1)
    assert.equal(fixture.events.some(event => event.name === 'detailUpdated'), true)
    assert.deepEqual(fixture.success, [], '未知结果不能宣称本次提交成功')
    await fixture.state.submit()
    assert.equal(fixture.calls().reviewCalls, 1)
  }
})

test('失败后仍待审核则保留说明和失败原因，更新版本并重新检查资格，不自动重试', async () => {
  const fixture = await createFixture()
  await fixture.state.loadDetail()
  fixture.state.reason.value = '核对采购明细'
  fixture.current.version = 2
  await fixture.state.submit()
  assert.equal(fixture.state.reason.value, '核对采购明细')
  assert.equal(fixture.state.detail.value?.version, 2)
  assert.match(fixture.state.error.value, /响应超时/u)
  assert.match(fixture.state.error.value, /purchaseReview.recovery.pending/u)
  assert.equal(fixture.calls().reviewCalls, 1)
  assert.equal(fixture.calls().contextCalls, 2)
  assert.equal(fixture.state.canConfirm.value, true)
})

test('审核明确成功时解除提交守卫并关闭弹窗，迟到结果不影响新订单', async () => {
  const fixture = await createFixture()
  await fixture.state.loadDetail()
  fixture.api.review = async () => ({ data: { ...fixture.current, orderStatus: 'CONFIRMED' } })
  await fixture.state.submit()
  assert.equal(fixture.props.modelValue, false)
  assert.equal(fixture.state.submitting.value, false)
  assert.equal(fixture.success.length, 1)

  for (const result of ['success', 'failure']) {
    const stale = await createFixture()
    await stale.state.loadDetail()
    let finish!: () => void
    stale.api.review = () => new Promise((resolve, reject) => {
      finish = () => result === 'success' ? resolve({ data: { ...stale.current, orderStatus: 'CONFIRMED' } }) : reject(new Error('迟到响应'))
    })
    const pending = stale.state.submit()
    stale.props.orderId = 'order-2'
    finish()
    await pending
    assert.equal(stale.props.modelValue, true)
    assert.equal(stale.state.error.value, '')
    assert.equal(stale.calls().contextCalls, 1)
    assert.deepEqual(stale.events, [])
    assert.deepEqual(stale.success, [])
  }
})

test('条件检查迟到时不得回写已切换订单或身份，提交资格保持关闭', async () => {
  for (const change of ['order', 'identity']) {
    const fixture = await createFixture()
    let resolveContext!: (value: { data: { available: boolean, message: null } }) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    fixture.api.reviewContext = () => new Promise((resolve) => {
      resolveContext = resolve
      entered()
    })
    const pending = fixture.state.loadDetail()
    await started
    if (change === 'order') {
      fixture.props.orderId = 'order-2'
    }
    else {
      fixture.account.authEpoch += 1
    }
    resolveContext({ data: { available: true, message: null } })
    await pending
    assert.equal(fixture.state.canConfirm.value, false)
  }
})
