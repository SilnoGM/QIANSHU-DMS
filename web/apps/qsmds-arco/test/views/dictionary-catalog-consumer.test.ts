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
  isReadonly,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
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

function mountConsumer(
  harness: ReturnType<typeof createProviderHarness>,
  createConsumer: () => ReturnType<typeof useDictionaryCatalog>,
) {
  const renderer = createHostRenderer()
  let consumer!: ReturnType<typeof useDictionaryCatalog>

  const Consumer = defineComponent({
    setup() {
      consumer = createConsumer()
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

  return { app, consumer }
}

function requestAt(
  harness: ReturnType<typeof createProviderHarness>,
  index: number,
): ReturnType<typeof createProviderHarness>['requests'][number] {
  const request = harness.requests[index]
  assert.ok(request, `预期第 ${index + 1} 个 Catalog 请求存在`)
  return request
}

function observableConsumerState(
  consumer: ReturnType<typeof useDictionaryCatalog>,
) {
  return {
    catalog: consumer.catalog.value,
    error: consumer.error.value,
    invalid: consumer.invalid.value,
    loading: consumer.loading.value,
    missing: consumer.missing.value,
    selectableItems: consumer.selectableItems.value,
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
  assert.equal(requestAt(harness, 0).code, 'sales.status')
  requestAt(harness, 0).response.resolve(catalog())
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
    requestAt(harness, 1).signal.aborted,
    true,
    '失效事件必须同步作废正在读取的旧身份/旧版本请求',
  )
  await flushVue()
  assert.equal(harness.requests.length, 3)

  requestAt(harness, 1).response.resolve(catalog('sales.status', false))
  await flushVue()
  assert.equal(consumer.catalog.value, null)

  requestAt(harness, 2).response.resolve(null)
  await flushVue()
  assert.equal(consumer.catalog.value, null)
  assert.equal(consumer.missing.value, true)
  assert.deepEqual(consumer.selectableItems.value, [])
  assert.equal(consumer.resolve(' RAW '), null)

  harness.emitInvalidation('sales.status')
  await flushVue()
  assert.equal(harness.requests.length, 4)
  app.unmount()
  assert.equal(requestAt(harness, 3).signal.aborted, true)
  assert.equal(harness.unsubscribeCalls, 1)
  const stateAfterUnmount = {
    catalog: consumer.catalog.value,
    error: consumer.error.value,
    loading: consumer.loading.value,
    missing: consumer.missing.value,
  }
  requestAt(harness, 3).response.resolve(catalog())
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

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()
  harness.emitInvalidation('sales.status')
  await flushVue()
  requestAt(harness, 1).response.reject(new Error('sensitive upstream detail'))
  await flushVue()

  assert.equal(consumer.error.value, '字典选项暂时不可用，请稍后重试')
  assert.equal(consumer.catalog.value, null)
  assert.deepEqual(consumer.selectableItems.value, [])
  assert.equal(consumer.resolve('ARCHIVED'), null)

  const retry = consumer.retry()
  assert.equal(harness.requests.length, 3)
  requestAt(harness, 2).response.resolve(catalog())
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

  requestAt(harness, 0).response.reject({
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

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()
  harness.emitInvalidation(null)
  await flushVue()
  assert.equal(harness.requests.length, 2)

  requestAt(harness, 1).response.reject(new DOMException(
    'identity snapshot is pending',
    'AbortError',
  ))
  await flushVue()
  assert.equal(consumer.loading.value, true)
  assert.equal(consumer.error.value, null)

  await flushTask()
  assert.equal(harness.requests.length, 3)
  requestAt(harness, 2).response.resolve(catalog())
  await flushVue()
  assert.equal(consumer.loading.value, false)
  assert.equal(consumer.error.value, null)
  assert.deepEqual(consumer.selectableItems.value.map(item => item.value), ['PENDING'])

  app.unmount()
})

test('响应式 code 只在规范身份变化时同步 Abort 并重读目录', async () => {
  const harness = createProviderHarness()
  const code = ref(' Sales.Status\u0085')
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog(() => code.value),
  )

  assert.equal(consumer.invalid.value, false)
  assert.equal(harness.requests.length, 1)
  assert.equal(requestAt(harness, 0).code, 'sales.status')

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()
  assert.equal(consumer.catalog.value?.code, 'sales.status')

  code.value = 'SALES.STATUS'
  assert.equal(harness.requests.length, 1, '同一规范 code 不应重读')
  assert.equal(consumer.catalog.value?.code, 'sales.status')

  code.value = 'order.status'
  assert.equal(harness.requests.length, 2, 'flush:sync 应在赋值栈内启动新读取')
  assert.equal(requestAt(harness, 1).code, 'order.status')
  assert.equal(consumer.catalog.value, null)
  assert.equal(consumer.loading.value, true)
  assert.equal(consumer.invalid.value, false)

  requestAt(harness, 1).response.resolve(catalog('order.status'))
  await flushVue()
  assert.equal(consumer.catalog.value?.code, 'order.status')
  assert.equal(consumer.loading.value, false)

  app.unmount()
})

test('code 切换后失效订阅与 retry 始终只读取当前规范 code', async () => {
  const harness = createProviderHarness()
  const code = ref('sales.status')
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog(code),
  )

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()

  code.value = 'order.status'
  assert.equal(harness.requests.length, 2)
  assert.equal(requestAt(harness, 1).code, 'order.status')

  harness.emitInvalidation('sales.status')
  await flushVue()
  assert.equal(harness.requests.length, 2, '旧 code 的精确失效必须被忽略')
  assert.equal(requestAt(harness, 1).signal.aborted, false)

  requestAt(harness, 1).response.resolve(catalog('order.status'))
  await flushVue()
  harness.emitInvalidation('order.status')
  assert.equal(consumer.catalog.value, null)
  await flushVue()
  assert.equal(harness.requests.length, 3)
  assert.equal(requestAt(harness, 2).code, 'order.status')

  requestAt(harness, 2).response.resolve(catalog('order.status'))
  await flushVue()
  const retryPromise = consumer.retry()
  assert.equal(harness.requests.length, 4)
  assert.equal(requestAt(harness, 3).code, 'order.status')
  requestAt(harness, 3).response.resolve(catalog('order.status'))
  await retryPromise
  await flushVue()
  assert.equal(consumer.catalog.value?.code, 'order.status')

  app.unmount()
})

test('invalid code 不请求、不重试，合法恢复后自动加载', async () => {
  const harness = createProviderHarness()
  const code = ref('invalid-code-without-namespace')
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog(code),
  )

  assert.equal(isReadonly(consumer.invalid), true)
  assert.equal(consumer.invalid.value, true)
  assert.equal(consumer.loading.value, false)
  assert.equal(consumer.catalog.value, null)
  assert.equal(consumer.error.value, null)
  assert.equal(consumer.missing.value, false)
  assert.equal(harness.requests.length, 0)

  await consumer.retry()
  harness.emitInvalidation(null)
  await flushVue()
  assert.equal(harness.requests.length, 0, 'invalid 期间 retry/失效都不得请求 Provider')

  code.value = 'sales.status'
  assert.equal(consumer.invalid.value, false)
  assert.equal(consumer.loading.value, true)
  assert.equal(harness.requests.length, 1)

  code.value = 'order.status'
  assert.equal(requestAt(harness, 0).signal.aborted, true)
  assert.equal(harness.requests.length, 2)
  code.value = 'still-invalid'
  assert.equal(requestAt(harness, 1).signal.aborted, true, '进入 invalid 必须同步释放请求所有权')
  assert.equal(harness.requests.length, 2)
  assert.equal(consumer.invalid.value, true)
  assert.equal(consumer.loading.value, false)
  assert.equal(consumer.catalog.value, null)

  requestAt(harness, 0).response.resolve(catalog())
  requestAt(harness, 1).response.reject(new Error('late sensitive failure'))
  await flushVue()
  assert.equal(consumer.invalid.value, true)
  assert.equal(consumer.error.value, null)
  assert.equal(consumer.missing.value, false)

  code.value = 'order.status'
  assert.equal(harness.requests.length, 3)
  requestAt(harness, 2).response.resolve(catalog('order.status'))
  await flushVue()
  assert.equal(consumer.invalid.value, false)
  assert.equal(consumer.catalog.value?.code, 'order.status')

  app.unmount()
})

test('快速 A→B→A 中只有最后一次请求可以写回', async () => {
  const harness = createProviderHarness()
  const code = ref('sales.status')
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog(code),
  )

  code.value = 'order.status'
  code.value = 'sales.status'

  assert.equal(harness.requests.length, 3)
  assert.deepEqual(harness.requests.map(request => request.code), [
    'sales.status',
    'order.status',
    'sales.status',
  ])
  assert.equal(requestAt(harness, 0).signal.aborted, true)
  assert.equal(requestAt(harness, 1).signal.aborted, true)

  requestAt(harness, 0).response.resolve(catalog())
  requestAt(harness, 1).response.reject(new Error('late order failure'))
  await flushVue()
  assert.equal(consumer.catalog.value, null)
  assert.equal(consumer.error.value, null)
  assert.equal(consumer.loading.value, true)

  requestAt(harness, 2).response.resolve(catalog())
  await flushVue()
  assert.equal(consumer.catalog.value?.code, 'sales.status')
  assert.equal(consumer.loading.value, false)

  app.unmount()
})

test('exact invalidation 与 code switch 同 task 时作废旧调度且不继承 identity budget', async () => {
  const harness = createProviderHarness()
  const code = ref('sales.status')
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog(code),
  )

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()

  harness.emitInvalidation('sales.status')
  code.value = 'order.status'
  assert.equal(harness.requests.length, 2)
  assert.equal(requestAt(harness, 1).code, 'order.status')
  await flushVue()
  assert.equal(harness.requests.length, 2, '失效 microtask 不得再读旧 code')

  requestAt(harness, 1).response.reject(new DOMException(
    'exact invalidation abort',
    'AbortError',
  ))
  await flushTask()
  assert.equal(harness.requests.length, 2, 'exact 失效不应提供 identity retry budget')
  assert.equal(consumer.loading.value, false)
  assert.equal(consumer.error.value, '字典选项暂时不可用，请稍后重试')

  app.unmount()
})

test('global invalidation 与 code switch 同 task 时把一次 identity budget 交给新 code', async () => {
  const harness = createProviderHarness()
  const code = ref('sales.status')
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog(code),
  )

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()

  harness.emitInvalidation(null)
  code.value = 'order.status'
  assert.equal(harness.requests.length, 2)
  assert.equal(requestAt(harness, 1).code, 'order.status')
  await flushVue()
  assert.equal(harness.requests.length, 2, '旧身份失效 microtask 不得重读 sales.status')

  requestAt(harness, 1).response.reject(new DOMException(
    'identity snapshot is pending',
    'AbortError',
  ))
  await flushVue()
  assert.equal(consumer.loading.value, true)
  assert.equal(consumer.error.value, null)

  await flushTask()
  assert.equal(harness.requests.length, 3)
  assert.equal(requestAt(harness, 2).code, 'order.status')
  requestAt(harness, 2).response.resolve(catalog('order.status'))
  await flushVue()
  assert.equal(consumer.catalog.value?.code, 'order.status')
  assert.equal(consumer.loading.value, false)

  app.unmount()
})

test('identity retry 第二次 Abort 后固定失败且不再发起第三次重试', async () => {
  const harness = createProviderHarness()
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog('sales.status'),
  )

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()
  harness.emitInvalidation(null)
  await flushVue()
  assert.equal(harness.requests.length, 2)

  requestAt(harness, 1).response.reject(new DOMException(
    'identity snapshot is pending',
    'AbortError',
  ))
  await flushVue()
  assert.equal(consumer.loading.value, true)
  assert.equal(consumer.error.value, null)

  await flushTask()
  assert.equal(harness.requests.length, 3)
  requestAt(harness, 2).response.reject(new DOMException(
    'identity snapshot is still pending',
    'AbortError',
  ))
  await flushTask()

  assert.equal(harness.requests.length, 3, 'identity retry budget 只能消费一次')
  assert.equal(consumer.loading.value, false)
  assert.equal(consumer.error.value, '字典选项暂时不可用，请稍后重试')
  assert.equal(consumer.catalog.value, null)
  assert.equal(consumer.missing.value, false)

  app.unmount()
})

test('identity retry timer 等待期间卸载后不再创建请求或改写状态', async () => {
  const harness = createProviderHarness()
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog('sales.status'),
  )

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()
  harness.emitInvalidation(null)
  await flushVue()
  requestAt(harness, 1).response.reject(new DOMException(
    'identity snapshot is pending',
    'AbortError',
  ))
  await flushVue()
  assert.equal(consumer.loading.value, true)
  assert.equal(consumer.error.value, null)

  const stateAtUnmount = observableConsumerState(consumer)
  app.unmount()
  await flushTask()

  assert.equal(harness.requests.length, 2, '卸载必须取消尚未执行的 identity timer retry')
  assert.equal(harness.unsubscribeCalls, 1)
  assert.deepEqual(observableConsumerState(consumer), stateAtUnmount)
})

test('invalidation microtask 等待期间卸载后忽略调度和迟到 reject', async () => {
  const harness = createProviderHarness()
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog('sales.status'),
  )

  harness.emitInvalidation('sales.status')
  assert.equal(requestAt(harness, 0).signal.aborted, true)
  assert.equal(harness.requests.length, 1)
  const stateAtUnmount = observableConsumerState(consumer)
  app.unmount()

  requestAt(harness, 0).response.reject(new Error('late sensitive failure'))
  await flushTask()

  assert.equal(harness.requests.length, 1, '卸载必须取消失效 microtask reload')
  assert.equal(harness.unsubscribeCalls, 1)
  assert.deepEqual(
    observableConsumerState(consumer),
    stateAtUnmount,
    '卸载后的迟到失败不得改写 catalog/error/loading/missing/invalid/selectableItems',
  )
})

test('identity retry timer 等待期间切换 code 只启动新 code 请求', async () => {
  const harness = createProviderHarness()
  const code = ref('sales.status')
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog(code),
  )

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()
  harness.emitInvalidation(null)
  await flushVue()
  requestAt(harness, 1).response.reject(new DOMException(
    'identity snapshot is pending',
    'AbortError',
  ))
  await flushVue()

  code.value = 'order.status'
  assert.equal(harness.requests.length, 3)
  assert.equal(requestAt(harness, 2).code, 'order.status')
  await flushTask()
  assert.equal(harness.requests.length, 3, '旧 code 的 identity timer 不得再创建请求')

  requestAt(harness, 2).response.resolve(catalog('order.status'))
  await flushVue()
  assert.equal(consumer.catalog.value?.code, 'order.status')
  assert.equal(consumer.loading.value, false)
  assert.equal(consumer.error.value, null)

  app.unmount()
})

test('retry 与 invalidation 同轮发生时只请求一次当前 code', async () => {
  const harness = createProviderHarness()
  const code = ref('sales.status')
  const { app, consumer } = mountConsumer(
    harness,
    () => useDictionaryCatalog(code),
  )

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()
  code.value = 'order.status'
  requestAt(harness, 1).response.resolve(catalog('order.status'))
  await flushVue()

  harness.emitInvalidation('order.status')
  const retryPromise = consumer.retry()
  assert.equal(harness.requests.length, 3)
  assert.equal(requestAt(harness, 2).code, 'order.status')
  await flushVue()
  assert.equal(harness.requests.length, 3, 'retry 必须作废同轮失效 microtask')

  requestAt(harness, 2).response.resolve(catalog('order.status'))
  await retryPromise
  await flushVue()
  assert.equal(consumer.catalog.value?.code, 'order.status')

  app.unmount()
})

test('同组件后注册的 onBeforeUnmount 改 code 不得穿透 Consumer teardown', async () => {
  const harness = createProviderHarness()
  const code = ref('sales.status')
  const renderer = createHostRenderer()
  let consumer!: ReturnType<typeof useDictionaryCatalog>

  const Consumer = defineComponent({
    setup() {
      consumer = useDictionaryCatalog(code)
      // 此 hook 晚于 composable 的 teardown 注册，用于锁定同一 beforeUnmount 队列窗口。
      onBeforeUnmount(() => {
        code.value = 'order.status'
      })
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

  requestAt(harness, 0).response.resolve(catalog())
  await flushVue()
  const stateBeforeUnmount = observableConsumerState(consumer)
  app.unmount()
  await flushVue()

  assert.equal(code.value, 'order.status')
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.unsubscribeCalls, 1)
  assert.deepEqual(
    observableConsumerState(consumer),
    stateBeforeUnmount,
    'disposed 后的同步 watch 不得再清空已冻结的 Consumer 状态',
  )
})
