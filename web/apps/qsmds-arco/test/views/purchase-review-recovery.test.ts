import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 使用真实弹窗脚本验证异步恢复边界。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, reactive, ref, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import messages from '../../src/locales/lang/purchase-review/zh-cn.json'
import { buildPurchaseOrderCopyText } from '../../src/views/operations/purchase-orders/purchase-order-copy.logic'
import { buildPurchaseOrderReviewRequest } from '../../src/views/operations/purchase-orders/purchase-order-detail.logic'

const i18n = createI18n({ legacy: false, locale: 'zh-cn', messages: { 'zh-cn': messages } })

async function createFixture() {
  const source = await readFile(new URL('../../src/views/operations/purchase-orders/purchase-order-review-modal.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const props = reactive({ orderId: 'order-1', modelValue: true, currencies: [] })
  const account = reactive({ authEpoch: 1 })
  const current = {
    id: 'order-1',
    version: 1,
    orderStatus: 'PENDING_REVIEW',
    reviewSummary: null,
    orderNo: 'PO/20260916-00016',
    orderDate: '2026-09-16',
    supplier: { label: '示例供应商' },
    amounts: { purchaseTotalAmount: '20.0000', depositDueAmount: '5.0000', balanceDueAmount: '15.0000' },
    lines: [{ id: 'line-1', lineNumber: 1, productName: '木桌', quantity: 2, actualPurchaseUnitPriceAmount: '10.0000', lineTotalAmount: '20.0000' }],
    parts: [{ partNumber: 1, status: 'PENDING_REVIEW', shipmentNo: 'PKG/01', shippingMarkText: 'TEST/货件-01', items: [{ lineNumber: 1, purchaseOrderLineId: 'line-1' }] }],
  }
  const events: Array<{ name: string, value: unknown }> = []
  const success: string[] = []
  const failures: string[] = []
  const copied: string[] = []
  const permission = ref(true)
  const clipboard = {
    writeText: async (text: string) => {
      copied.push(text)
    },
  }
  let contextCalls = 0
  let reviewCalls = 0
  const draft = { id: 'draft-1', purchaseOrderId: 'order-1', orderVersion: 1, isCurrent: true }
  const api = {
    orderImageDraft: async () => ({ data: { draft: { ...draft } } }),
    getOrderImageDraftContent: async () => ({ data: new Blob(['png'], { type: 'image/png' }) }),
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
  const imageSource = (await readFile(new URL('../../src/views/operations/purchase-orders/use-purchase-order-image-generation.ts', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
    .replace('export function', 'function')
  const usePurchaseOrderImageGeneration = runInNewContext(ts.transpileModule(`${imageSource}\n;usePurchaseOrderImageGeneration`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    shallowRef,
    AbortController,
    DOMException,
    Blob,
    URL: { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} },
    onScopeDispose: () => {},
    purchaseOrdersApi: api,
    isPurchaseOrderAbortError: (failure: Error) => failure.name === 'AbortError',
  })
  const state = runInNewContext(ts.transpileModule(`${script}\n;({ loadDetail, submit, reset, canConfirm, canCopy, copying, copyPurchaseInfo, detail, error, reason, loading, submitting, visible, image })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    AbortController,
    computed,
    ref,
    shallowRef,
    navigator: { clipboard },
    defineProps: () => props,
    defineEmits: () => (name: string, value: unknown) => {
      events.push({ name, value })
      if (name === 'update:modelValue') {
        props.modelValue = value as boolean
      }
    },
    useI18n: () => ({ t: (key: string, values: Record<string, string | number> = {}) => key.startsWith('purchaseReview.copy.') ? i18n.global.t(key, values) : key }),
    useAppAuth: () => ({ auth: () => permission.value }),
    useAppAccountStore: () => account,
    useQsToast: () => ({ success: (message: string) => success.push(message), error: (message: string) => failures.push(message) }),
    watch: () => {},
    onBeforeUnmount: () => {},
    purchaseOrdersApi: api,
    buildPurchaseOrderReviewRequest,
    buildPurchaseOrderCopyText,
    usePurchaseOrderImageGeneration,
    getPurchaseOrderApiFailure: (failure: Error) => ({ message: failure.message }),
    isPurchaseOrderAbortError: () => false,
  }) as {
    loadDetail: (previousFailure?: string) => Promise<void>
    submit: () => Promise<void>
    reset: () => void
    canConfirm: { value: boolean }
    canCopy: { value: boolean }
    copying: { value: boolean }
    copyPurchaseInfo: () => Promise<void>
    detail: { value: typeof current | null }
    error: { value: string }
    reason: { value: string }
    loading: { value: boolean }
    submitting: { value: boolean }
    visible: { value: boolean }
    image: { previewUrl: { value: string | null }, markLoaded: (url: string) => void }
  }
  const loadDetail = async (failure = '') => {
    await state.loadDetail(failure)
    if (state.image.previewUrl.value) {
      state.image.markLoaded(state.image.previewUrl.value)
    }
  }
  return { state: { ...state, loadDetail }, current, api, props, account, events, success, failures, copied, clipboard, permission, calls: () => ({ contextCalls, reviewCalls }) }
}

test('点击复制使用已加载的采购详情，不提交审核、不派号，重复点击受保护', async () => {
  const fixture = await createFixture()
  assert.equal(fixture.state.canCopy.value, false)
  await fixture.state.loadDetail()
  let finish!: () => void
  fixture.clipboard.writeText = text => new Promise((resolve) => {
    fixture.copied.push(text)
    finish = resolve
  })
  const pending = fixture.state.copyPurchaseInfo()
  assert.equal(fixture.state.copying.value, true)
  await fixture.state.copyPurchaseInfo()
  assert.equal(fixture.copied.length, 1)
  assert.match(fixture.copied[0]!, /【PO\/20260916-00016】\n供应商：示例供应商/u)
  assert.match(fixture.copied[0]!, /金额小计：10\.00\*2=20\.00/u)
  assert.match(fixture.copied[0]!, /PKG\/01：木桌\n此货件唛头：TEST\/货件-01/u)
  finish()
  await pending
  assert.equal(fixture.state.copying.value, false)
  assert.deepEqual(fixture.success, ['采购信息已复制'])
  assert.deepEqual(fixture.calls(), { contextCalls: 1, reviewCalls: 0 })
  assert.deepEqual(fixture.events, [])
})

test('复制失败有错误提示且可重试，加载中、提交中、无权、关闭或订单不匹配时不复制', async () => {
  const fixture = await createFixture()
  await fixture.state.loadDetail()
  fixture.clipboard.writeText = async () => {
    throw new Error('Permission denied')
  }
  await fixture.state.copyPurchaseInfo()
  assert.deepEqual(fixture.failures, ['复制失败，请重试'])
  assert.deepEqual(fixture.success, [])
  assert.equal(fixture.state.canCopy.value, true)
  fixture.clipboard.writeText = async (text) => {
    fixture.copied.push(text)
  }
  for (const flag of [fixture.state.loading, fixture.state.submitting]) {
    flag.value = true
    await fixture.state.copyPurchaseInfo()
    flag.value = false
  }
  fixture.permission.value = false
  await fixture.state.copyPurchaseInfo()
  fixture.permission.value = true
  fixture.props.modelValue = false
  await fixture.state.copyPurchaseInfo()
  fixture.props.modelValue = true
  fixture.props.orderId = 'order-2'
  await fixture.state.copyPurchaseInfo()
  assert.deepEqual(fixture.copied, [])
  fixture.props.orderId = 'order-1'
  await fixture.state.copyPurchaseInfo()
  assert.equal(fixture.copied.length, 1)
})

test('切换订单、身份或关闭后，迟到的剪贴板成功和失败不会显示提示', async () => {
  for (const change of ['order', 'identity', 'close']) {
    for (const result of ['success', 'failure']) {
      const fixture = await createFixture()
      await fixture.state.loadDetail()
      let finish!: () => void
      fixture.clipboard.writeText = () => new Promise((resolve, reject) => {
        finish = () => result === 'success' ? resolve() : reject(new Error('Permission denied'))
      })
      const pending = fixture.state.copyPurchaseInfo()
      if (change === 'order') {
        fixture.props.orderId = 'order-2'
      }
      else if (change === 'identity') {
        fixture.account.authEpoch += 1
      }
      else {
        fixture.state.reset()
        fixture.props.modelValue = false
      }
      finish()
      await pending
      assert.deepEqual(fixture.success, [])
      assert.deepEqual(fixture.failures, [])
      assert.equal(fixture.state.copying.value, false)
    }
  }
})

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
  assert.equal(fixture.state.canConfirm.value, false, '版本更新后旧图片不得继续审核，必须重新生成')
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
