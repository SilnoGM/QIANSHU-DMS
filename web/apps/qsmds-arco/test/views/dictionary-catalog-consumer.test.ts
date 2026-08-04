import type {
  DictionaryCatalog,
  DictionaryCatalogProvider,
} from '../../src/dictionary-catalog/types'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- Catalog 消费层是无浏览器依赖的 Vue composable 契约。
import test from 'node:test'

import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  provide,
} from 'vue'
import { dictionaryCatalogProviderKey } from '../../src/dictionary-catalog/injection'
import {
  resolveDictionaryCatalogValue,
  selectEffectiveDictionaryItems,
} from '../../src/dictionary-catalog/options'
import { useDictionaryCatalog } from '../../src/dictionary-catalog/use-dictionary-catalog'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly reject: (reason?: unknown) => void
  readonly resolve: (value: T) => void
}

interface HostNode {
  children: HostNode[]
  parent: HostNode | null
  text?: string
}

function deferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

function catalog(
  code = 'sales.status',
  enabled = true,
): DictionaryCatalog {
  return Object.freeze({
    code,
    enabled,
    items: Object.freeze([
      Object.freeze({
        effectiveEnabled: enabled,
        enabled: true,
        label: '待处理',
        sortOrder: 10,
        tone: 'WARNING' as const,
        value: 'PENDING',
      }),
      Object.freeze({
        effectiveEnabled: false,
        enabled: false,
        label: '已归档',
        sortOrder: 20,
        tone: 'DEFAULT' as const,
        value: 'ARCHIVED',
      }),
    ]),
    name: '销售状态',
  })
}

function createHostRenderer() {
  return createRenderer<HostNode, HostNode>({
    createComment: text => ({ children: [], parent: null, text }),
    createElement: () => ({ children: [], parent: null }),
    createText: text => ({ children: [], parent: null, text }),
    insert: (child, parent, anchor) => {
      child.parent = parent
      const index = anchor === null ? -1 : parent.children.indexOf(anchor)
      if (index < 0) {
        parent.children.push(child)
      }
      else {
        parent.children.splice(index, 0, child)
      }
    },
    nextSibling: (node) => {
      const parent = node.parent
      if (parent === null) {
        return null
      }
      const index = parent.children.indexOf(node)
      return parent.children[index + 1] ?? null
    },
    parentNode: node => node.parent,
    patchProp: () => undefined,
    remove: (child) => {
      const parent = child.parent
      if (parent !== null) {
        const index = parent.children.indexOf(child)
        if (index >= 0) {
          parent.children.splice(index, 1)
        }
      }
      child.parent = null
    },
    setElementText: (node, text) => {
      node.children = []
      node.text = text
    },
    setText: (node, text) => {
      node.text = text
    },
  })
}

async function flushVue(): Promise<void> {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}

async function flushTask(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  await flushVue()
}

function createProviderHarness() {
  const requests: Array<{
    readonly code: string
    readonly response: Deferred<DictionaryCatalog | null>
    readonly signal: AbortSignal
  }> = []
  let invalidationListener:
    | ((event: { readonly code: string | null }) => void)
    | null = null
  let unsubscribeCalls = 0

  const provider: DictionaryCatalogProvider = {
    get: ({ code, signal }) => {
      const response = deferred<DictionaryCatalog | null>()
      requests.push({ code, response, signal })
      return response.promise
    },
    prefetch: async () => undefined,
    subscribeInvalidation: (listener) => {
      invalidationListener = listener
      let subscribed = true
      return () => {
        if (subscribed) {
          subscribed = false
          unsubscribeCalls += 1
          invalidationListener = null
        }
      }
    },
  }

  return {
    emitInvalidation: (code: string | null) => invalidationListener?.({ code }),
    get unsubscribeCalls() {
      return unsubscribeCalls
    },
    provider,
    requests,
  }
}

test('历史值解析精确区分 ACTIVE、DISABLED 与 UNKNOWN，且从不改写 raw value', () => {
  const activeCatalog = catalog()
  const disabledCatalog = catalog('sales.status', false)

  const selectableItems = selectEffectiveDictionaryItems(activeCatalog)
  assert.deepEqual(selectableItems.map(item => item.value), ['PENDING'])
  assert.equal(Object.isFrozen(selectableItems), true)
  assert.deepEqual(selectEffectiveDictionaryItems(disabledCatalog), [])

  assert.deepEqual(resolveDictionaryCatalogValue(activeCatalog, 'PENDING'), {
    displayLabel: '待处理',
    item: activeCatalog.items[0],
    label: '待处理',
    status: 'ACTIVE',
    value: 'PENDING',
  })
  assert.deepEqual(resolveDictionaryCatalogValue(activeCatalog, 'ARCHIVED'), {
    displayLabel: '已归档（已停用）',
    item: activeCatalog.items[1],
    label: '已归档',
    status: 'DISABLED',
    value: 'ARCHIVED',
  })
  assert.deepEqual(resolveDictionaryCatalogValue(disabledCatalog, 'PENDING'), {
    displayLabel: '待处理（已停用）',
    item: disabledCatalog.items[0],
    label: '待处理',
    status: 'DISABLED',
    value: 'PENDING',
  })

  const rawValue = ' pending\u0085'
  const unknownResolution = resolveDictionaryCatalogValue(activeCatalog, rawValue)
  assert.deepEqual(unknownResolution, {
    displayLabel: `${rawValue}（未知字典值）`,
    item: null,
    label: rawValue,
    status: 'UNKNOWN',
    value: rawValue,
  })
  assert.equal(Object.isFrozen(unknownResolution), true)
  assert.deepEqual(resolveDictionaryCatalogValue(activeCatalog, ''), {
    displayLabel: '（未知字典值）',
    item: null,
    label: '',
    status: 'UNKNOWN',
    value: '',
  })
  assert.equal(resolveDictionaryCatalogValue(null, rawValue), null)
  assert.equal(resolveDictionaryCatalogValue(activeCatalog, null), null)
  assert.equal(resolveDictionaryCatalogValue(activeCatalog, undefined), null)
})

test('useDictionaryCatalog 只响应所属 code 或身份域失效，并拒绝迟到响应', async () => {
  const harness = createProviderHarness()
  const renderer = createHostRenderer()
  let consumer!: ReturnType<typeof useDictionaryCatalog>

  const Consumer = defineComponent({
    setup() {
      consumer = useDictionaryCatalog(' Sales.Status\u0085')
      return () => null
    },
  })
  const Root = defineComponent({
    setup() {
      provide(dictionaryCatalogProviderKey, harness.provider)
      return () => h(Consumer)
    },
  })
  const app = renderer.createApp(Root)
  app.mount({ children: [], parent: null })

  assert.equal(consumer.loading.value, true)
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.requests[0]?.code, 'sales.status')
  harness.requests[0]?.response.resolve(catalog())
  await flushVue()

  assert.equal(consumer.loading.value, false)
  assert.equal(consumer.error.value, null)
  assert.equal(consumer.missing.value, false)
  assert.deepEqual(consumer.selectableItems.value.map(item => item.value), ['PENDING'])
  assert.equal(consumer.resolve('ARCHIVED')?.status, 'DISABLED')

  harness.emitInvalidation('order.status')
  assert.equal(harness.requests.length, 1)

  harness.emitInvalidation('sales.status')
  harness.emitInvalidation(null)
  assert.equal(harness.requests.length, 1, '同一调用栈的失效应合并')
  assert.equal(consumer.catalog.value, null, '失效后旧目录必须立即清除')
  await flushVue()
  assert.equal(harness.requests.length, 2)

  harness.emitInvalidation(null)
  assert.equal(
    harness.requests[1]?.signal.aborted,
    true,
    '失效事件必须同步作废正在读取的旧身份/旧版本请求',
  )
  await flushVue()
  assert.equal(harness.requests.length, 3)

  harness.requests[1]?.response.resolve(catalog('sales.status', false))
  await flushVue()
  assert.equal(consumer.catalog.value, null)

  harness.requests[2]?.response.resolve(null)
  await flushVue()
  assert.equal(consumer.catalog.value, null)
  assert.equal(consumer.missing.value, true)
  assert.deepEqual(consumer.selectableItems.value, [])
  assert.equal(consumer.resolve(' RAW '), null)

  harness.emitInvalidation('sales.status')
  await flushVue()
  assert.equal(harness.requests.length, 4)
  app.unmount()
  assert.equal(harness.requests[3]?.signal.aborted, true)
  assert.equal(harness.unsubscribeCalls, 1)
  const stateAfterUnmount = {
    catalog: consumer.catalog.value,
    error: consumer.error.value,
    loading: consumer.loading.value,
    missing: consumer.missing.value,
  }
  harness.requests[3]?.response.resolve(catalog())
  await flushVue()
  assert.deepEqual({
    catalog: consumer.catalog.value,
    error: consumer.error.value,
    loading: consumer.loading.value,
    missing: consumer.missing.value,
  }, stateAfterUnmount, '卸载后的迟到成功不得改写任何可观察状态')
})

test('失败使用稳定本地错误且 retry 可恢复，旧目录不再提供新选择', async () => {
  const harness = createProviderHarness()
  const renderer = createHostRenderer()
  let consumer!: ReturnType<typeof useDictionaryCatalog>

  const Consumer = defineComponent({
    setup() {
      consumer = useDictionaryCatalog('sales.status')
      return () => null
    },
  })
  const Root = defineComponent({
    setup() {
      provide(dictionaryCatalogProviderKey, harness.provider)
      return () => h(Consumer)
    },
  })
  const app = renderer.createApp(Root)
  app.mount({ children: [], parent: null })

  harness.requests[0]?.response.resolve(catalog())
  await flushVue()
  harness.emitInvalidation('sales.status')
  await flushVue()
  harness.requests[1]?.response.reject(new Error('sensitive upstream detail'))
  await flushVue()

  assert.equal(consumer.error.value, '字典选项暂时不可用，请稍后重试')
  assert.equal(consumer.catalog.value, null)
  assert.deepEqual(consumer.selectableItems.value, [])
  assert.equal(consumer.resolve('ARCHIVED'), null)

  const retry = consumer.retry()
  assert.equal(harness.requests.length, 3)
  harness.requests[2]?.response.resolve(catalog())
  await retry
  await flushVue()
  assert.equal(consumer.error.value, null)
  assert.deepEqual(consumer.selectableItems.value.map(item => item.value), ['PENDING'])

  app.unmount()
})

test('当前 Provider 主动取消进入稳定错误，且 Provider 缺失时同步失败', async () => {
  const harness = createProviderHarness()
  const renderer = createHostRenderer()
  let consumer!: ReturnType<typeof useDictionaryCatalog>

  const Consumer = defineComponent({
    setup() {
      consumer = useDictionaryCatalog('sales.status')
      return () => null
    },
  })
  const Root = defineComponent({
    setup() {
      provide(dictionaryCatalogProviderKey, harness.provider)
      return () => h(Consumer)
    },
  })
  const app = renderer.createApp(Root)
  app.mount({ children: [], parent: null })

  harness.requests[0]?.response.reject({
    code: 'ERR_CANCELED',
    name: 'CanceledError',
  })
  await flushVue()

  assert.equal(consumer.loading.value, false)
  assert.equal(consumer.error.value, '字典选项暂时不可用，请稍后重试')
  assert.equal(consumer.catalog.value, null)
  assert.equal(consumer.missing.value, false)
  app.unmount()

  const missingProviderApp = renderer.createApp(Consumer)
  missingProviderApp.config.warnHandler = () => undefined
  assert.throws(
    () => missingProviderApp.mount({ children: [], parent: null }),
    /DictionaryCatalogProvider is not installed/u,
  )
})

test('身份域失效中的瞬时 Provider Abort 只做一次有界重取', async () => {
  const harness = createProviderHarness()
  const renderer = createHostRenderer()
  let consumer!: ReturnType<typeof useDictionaryCatalog>

  const Consumer = defineComponent({
    setup() {
      consumer = useDictionaryCatalog('sales.status')
      return () => null
    },
  })
  const Root = defineComponent({
    setup() {
      provide(dictionaryCatalogProviderKey, harness.provider)
      return () => h(Consumer)
    },
  })
  const app = renderer.createApp(Root)
  app.mount({ children: [], parent: null })

  harness.requests[0]?.response.resolve(catalog())
  await flushVue()
  harness.emitInvalidation(null)
  await flushVue()
  assert.equal(harness.requests.length, 2)

  harness.requests[1]?.response.reject(new DOMException(
    'identity snapshot is pending',
    'AbortError',
  ))
  await flushVue()
  assert.equal(consumer.loading.value, true)
  assert.equal(consumer.error.value, null)

  await flushTask()
  assert.equal(harness.requests.length, 3)
  harness.requests[2]?.response.resolve(catalog())
  await flushVue()
  assert.equal(consumer.loading.value, false)
  assert.equal(consumer.error.value, null)
  assert.deepEqual(consumer.selectableItems.value.map(item => item.value), ['PENDING'])

  app.unmount()
})
