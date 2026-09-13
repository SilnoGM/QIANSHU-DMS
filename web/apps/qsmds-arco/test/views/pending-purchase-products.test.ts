import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 执行真实组件 watcher，验证取消请求和空图展示分组。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/components/business/QsPurchaseStartModal/pending-purchase-products.vue', import.meta.url), 'utf8')
const ast = ts.createSourceFile('pending.ts', parse(source).descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true)
const compiled = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

function setup() {
  const calls: { signal: AbortSignal, resolve: (value: unknown) => void, reject: (error: Error) => void }[] = []
  let callback!: (value: [string, boolean, number], old: unknown, cleanup: (fn: () => void) => void) => Promise<void>
  let cleanup = () => {}
  const state = runInNewContext(`${compiled}\n({items, visibleItems, hiddenItems, loading, failed})`, {
    defineProps: () => ({ orderId: 'first', active: true }),
    useI18n: () => ({ t: (key: string) => key }),
    ref: (value: unknown) => ({ value }),
    shallowRef: (value: unknown) => ({ value }),
    computed: (getter: () => unknown) => ({ get value() { return getter() } }),
    watch: (_: unknown, cb: typeof callback) => { callback = cb },
    AbortController,
    salesOrdersApi: { pendingPurchaseProducts: (_: string, signal: AbortSignal) => new Promise((resolve, reject) => calls.push({ signal, resolve, reject })) },
  })
  function load(id: string, active = true) {
    cleanup()
    return callback([id, active, 0], undefined, (fn) => {
      cleanup = fn
    })
  }
  return { state, calls, load }
}

test('切换订单与关闭取消旧请求，延迟结果不能覆盖新订单图片', async () => {
  const { state, calls, load } = setup()
  const old = load('old')
  const current = load('current')
  assert.equal(calls[0]!.signal.aborted, true)
  calls[1]!.resolve({ data: { items: [{ id: 'current', mainImage: null }] } })
  await current
  calls[0]!.resolve({ data: { items: [{ id: 'old', mainImage: null }] } })
  await old
  assert.equal(state.items.value[0].id, 'current')
  const pending = load('next')
  await load('next', false)
  assert.equal(calls[2]!.signal.aborted, true)
  calls[2]!.resolve({ data: { items: [{ id: 'next' }] } })
  await pending
  assert.equal(state.items.value.length, 0)
  assert.equal(state.loading.value, false)
})

test('失败状态可重试，无图片产品保留位置且总展示位置不超过四个', async () => {
  const { state, calls, load } = setup()
  const failed = load('order')
  calls[0]!.reject(new Error('offline'))
  await failed
  assert.equal(state.failed.value, true)
  const retry = load('order')
  assert.equal(state.failed.value, false)
  calls[1]!.resolve({ data: { items: [
    { id: 'image', productName: '产品', mainImage: { contentUrl: '/image' } },
    { id: 'custom', productName: '自定义', mainImage: null },
  ] } })
  await retry
  assert.equal(state.visibleItems.value.length, 2)
  assert.equal(state.visibleItems.value[1].id, 'custom')
  assert.equal(state.hiddenItems.value.length, 0)
  state.items.value = Array.from({ length: 4 }, (_, id) => ({ id }))
  assert.equal(state.visibleItems.value.length, 4)
  assert.equal(state.hiddenItems.value.length, 0)
  state.items.value = Array.from({ length: 8 }, (_, id) => ({ id }))
  assert.equal(state.visibleItems.value.length, 3)
  assert.equal(state.hiddenItems.value.length, 5)
  assert.equal(state.hiddenItems.value[0].id, 3)
})
