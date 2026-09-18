import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 验证生成草稿的真实异步生命周期，避免关闭及换单后发生迟到写入。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, ref, shallowRef } from 'vue'

async function fixture() {
  const source = await readFile(new URL('../../src/views/operations/purchase-orders/use-purchase-order-image-generation.ts', import.meta.url), 'utf8')
  const script = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '').replace('export function', 'function')
  const detail = shallowRef({ id: 'order-1', version: 3, orderStatus: 'PENDING_REVIEW' })
  const orderId = ref('order-1')
  const enabled = ref(true)
  const epoch = ref(1)
  const draft = { id: 'draft-1', purchaseOrderId: 'order-1', orderVersion: 3, isCurrent: true, generatedAt: '2026-09-15T08:00:00Z', generatedBy: { id: 'user-1', displayName: '审核人' } }
  const calls: Array<{ name: string, body?: unknown }> = []
  const revoked: string[] = []
  let nextUrl = 0
  const api = {
    getById: async () => {
      calls.push({ name: 'detail' })
      return { data: { ...detail.value } }
    },
    prepareReviewShippingMarks: async (_id: string, body: unknown) => {
      calls.push({ name: 'marks', body })
      return { data: { ...detail.value, version: 4 } }
    },
    orderImageDraft: async () => {
      calls.push({ name: 'draft' })
      return { data: { draft: { ...draft } as typeof draft | null } }
    },
    generateOrderImageDraft: async (_id: string, body: unknown) => {
      calls.push({ name: 'generate', body })
      return { data: { ...draft, orderVersion: 4 } }
    },
    getOrderImageDraftContent: async () => {
      calls.push({ name: 'content' })
      return { data: new Blob(['png'], { type: 'image/png' }) }
    },
  }
  const useGeneration = runInNewContext(ts.transpileModule(`${script}\n;usePurchaseOrderImageGeneration`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    AbortController,
    Blob,
    DOMException,
    computed,
    ref,
    shallowRef,
    onScopeDispose: () => {},
    URL: { createObjectURL: () => `blob:preview-${++nextUrl}`, revokeObjectURL: (url: string) => revoked.push(url) },
    purchaseOrdersApi: api,
    isPurchaseOrderAbortError: (error: Error) => error.name === 'AbortError',
  }) as (options: unknown, apiClient: typeof api) => {
    draft: { value: typeof draft | null }
    previewUrl: { value: string | null }
    imageLoaded: { value: boolean }
    ready: { value: boolean }
    generating: { value: boolean }
    steps: { value: Array<{ text: string, action: () => Promise<void> }> }
    restore: (current: typeof detail.value, signal: AbortSignal) => Promise<void>
    start: (regenerate: boolean, labels: string[]) => void
    complete: () => void
    fail: (failure: unknown) => boolean
    reset: () => void
    markLoaded: (url: string) => void
    markFailed: (url: string) => void
  }
  const state = useGeneration({ detail, orderId, enabled, epoch }, api)
  return { state, api, calls, detail, orderId, enabled, epoch, draft, revoked }
}

test('恢复草稿只读图片，真实图片加载成功且版本匹配后才允许审核；关闭清理本地URL', async () => {
  const f = await fixture()
  await f.state.restore(f.detail.value, new AbortController().signal)
  assert.equal(f.state.ready.value, false)
  assert.equal(f.state.previewUrl.value, 'blob:preview-1')
  f.state.markLoaded('blob:preview-1')
  assert.equal(f.state.ready.value, true)
  f.state.reset()
  assert.equal(f.state.ready.value, false)
  assert.deepEqual(f.revoked, ['blob:preview-1'])
  assert.deepEqual(f.calls.map(call => call.name), ['draft', 'content'], '关闭不能删除服务端草稿或回收唛头')
})

test('没有草稿或草稿已过期时不能确认审核，加载失败也不能放行', async () => {
  const f = await fixture()
  f.api.orderImageDraft = async () => ({ data: { draft: null } })
  await f.state.restore(f.detail.value, new AbortController().signal)
  assert.equal(f.state.previewUrl.value, null)
  assert.equal(f.state.ready.value, false)
  f.api.orderImageDraft = async () => ({ data: { draft: { ...f.draft, isCurrent: false } } })
  await f.state.restore(f.detail.value, new AbortController().signal)
  f.state.markLoaded('blob:preview-1')
  assert.equal(f.state.ready.value, false)
  f.state.markFailed('blob:preview-1')
  assert.equal(f.state.imageLoaded.value, false)
})

test('加载器执行真实三步，派号返回新版本用于生成；仅明确重新生成才传regenerate', async () => {
  const f = await fixture()
  f.state.start(true, ['加载采购单详情', '申请与派发唛头', '生成采购单图片'])
  assert.equal(f.state.generating.value, true)
  assert.deepEqual(f.calls, [], '不能在加载器步骤执行前提前跑后台流程')
  assert.equal(f.state.steps.value.length, 3)
  for (const step of f.state.steps.value) {
    await step.action()
  }
  assert.deepEqual(f.calls.map(call => call.name), ['detail', 'marks', 'generate', 'content'])
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1]?.body)), { expectedVersion: 3 })
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[2]?.body)), { expectedVersion: 4, regenerate: true })
  assert.equal(f.detail.value.version, 4)
  f.state.complete()
  assert.equal(f.state.generating.value, false)
  assert.equal(f.state.ready.value, false)
  f.state.markLoaded('blob:preview-1')
  assert.equal(f.state.ready.value, true)
})

test('图片生成失败后保留已派号的新版本，停止加载且不自动再次生成', async () => {
  const f = await fixture()
  f.api.generateOrderImageDraft = async () => {
    throw new Error('生成失败')
  }
  f.state.start(false, ['详情', '唛头', '图片'])
  await f.state.steps.value[0]!.action()
  await f.state.steps.value[1]!.action()
  await assert.rejects(f.state.steps.value[2]!.action(), /生成失败/u)
  assert.equal(f.state.fail(new Error('生成失败')), true)
  assert.equal(f.state.generating.value, false)
  assert.equal(f.detail.value.version, 4)
  assert.equal(f.state.ready.value, false)
  assert.deepEqual(f.calls.map(call => call.name), ['detail', 'marks'])
})

test('关闭、换单或身份变化后，迟到详情不能继续派号，也不能回写当前详情', async () => {
  for (const change of ['close', 'order', 'identity']) {
    const f = await fixture()
    let resolve!: (value: { data: typeof f.detail.value }) => void
    f.api.getById = () => new Promise((done) => {
      resolve = done
    })
    f.state.start(false, ['详情', '唛头', '图片'])
    const steps = [...f.state.steps.value]
    const pending = steps[0]!.action()
    if (change === 'close') {
      f.state.reset()
    }
    else if (change === 'order') {
      f.orderId.value = 'order-2'
    }
    else {
      f.epoch.value += 1
    }
    resolve({ data: { ...f.detail.value, version: 9 } })
    await assert.rejects(pending, { name: 'AbortError' })
    await assert.rejects(steps[1]!.action(), { name: 'AbortError' })
    assert.equal(f.detail.value.version, 3)
    assert.deepEqual(f.calls, [])
  }
})

test('旧图片响应不创建ObjectURL，旧图片load事件不得使新图片通过校验', async () => {
  const f = await fixture()
  let resolve!: (value: { data: Blob }) => void
  f.api.getOrderImageDraftContent = () => new Promise((done) => {
    resolve = done
  })
  const pending = f.state.restore(f.detail.value, new AbortController().signal)
  await new Promise<void>(done => setImmediate(done))
  f.state.reset()
  resolve({ data: new Blob(['png'], { type: 'image/png' }) })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(f.state.previewUrl.value, null)
  assert.deepEqual(f.revoked, [])
  f.state.markLoaded('blob:preview-previous')
  assert.equal(f.state.ready.value, false)
})
