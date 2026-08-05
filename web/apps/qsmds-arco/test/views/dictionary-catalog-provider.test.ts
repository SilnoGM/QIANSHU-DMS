import type {
  DictionaryCatalogIdentity,
  DictionaryCatalogIdentitySource,
  DictionaryCatalogLoader,
} from '../../src/dictionary-catalog/types'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- Provider 内核是无 DOM 的纯 TypeScript 边界。
import test from 'node:test'

import {
  createDictionaryCatalogProviderController,
  DICTIONARY_CATALOG_CACHE_TTL_MS,
  DictionaryCatalogIdentityRequiredError,
} from '../../src/dictionary-catalog/provider'
import { DictionaryCatalogResponseError } from '../../src/dictionary-catalog/validation'

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly reject: (reason?: unknown) => void
  readonly resolve: (value: T) => void
}

interface FakeBroadcastChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  readonly posted: unknown[]
  readonly messageListeners: Set<(event: MessageEvent<unknown>) => void>
  closeCalls: number
  postError?: Error
  closeError?: Error
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void
  postMessage: (message: unknown) => void
  close: () => void
  emit: (data: unknown) => void
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

function rawCatalog(
  code = 'sales.status',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    code,
    enabled: true,
    items: [{
      effectiveEnabled: true,
      enabled: true,
      label: '启用',
      sortOrder: 10,
      tone: 'SUCCESS',
      value: 'ACTIVE',
    }],
    name: `${code} 字典`,
    ...overrides,
  }
}

function stableNotFoundError(
  code = 'DICTIONARY_TYPE_NOT_FOUND',
): Record<string, unknown> {
  return {
    body: {
      code,
      message: '系统字典类型不存在',
      requestId: 'req-dictionary-provider-test',
    },
    kind: 'http',
    status: 404,
  }
}

class FakeIdentitySource implements DictionaryCatalogIdentitySource {
  private identity: DictionaryCatalogIdentity
  private readonly listeners = new Set<(
    identity: DictionaryCatalogIdentity,
  ) => void>()

  constructor(identity: DictionaryCatalogIdentity = {
    authEpoch: 7,
    userId: USER_A,
  }) {
    this.identity = identity
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  getSnapshot(): DictionaryCatalogIdentity {
    return this.identity
  }

  subscribe(
    listener: (identity: DictionaryCatalogIdentity) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(identity: DictionaryCatalogIdentity): void {
    this.identity = identity
    for (const listener of [...this.listeners]) {
      listener(identity)
    }
  }

  replaceSnapshot(identity: DictionaryCatalogIdentity): void {
    this.identity = identity
  }

  emit(identity: DictionaryCatalogIdentity): void {
    for (const listener of [...this.listeners]) {
      listener(identity)
    }
  }
}

function createLoader(
  overrides: Partial<DictionaryCatalogLoader> = {},
): DictionaryCatalogLoader {
  return {
    batch: async ({ codes }) => ({
      dictionaries: codes.map(code => rawCatalog(code)),
      missingCodes: [],
    }),
    get: async ({ code }) => rawCatalog(code),
    ...overrides,
  }
}

function createFakeBroadcastChannel(): FakeBroadcastChannel {
  const messageListeners = new Set<(event: MessageEvent<unknown>) => void>()
  return {
    closeCalls: 0,
    messageListeners,
    onmessage: null,
    posted: [],
    addEventListener(type, listener) {
      if (type !== 'message') {
        return
      }
      const callback = typeof listener === 'function'
        ? listener
        : event => listener.handleEvent(event)
      messageListeners.add(callback as (event: MessageEvent<unknown>) => void)
    },
    close() {
      this.closeCalls += 1
      if (this.closeError !== undefined) {
        throw this.closeError
      }
    },
    emit(data) {
      const event = { data } as MessageEvent<unknown>
      this.onmessage?.(event)
      for (const listener of [...messageListeners]) {
        listener(event)
      }
    },
    postMessage(message) {
      if (this.postError !== undefined) {
        throw this.postError
      }
      this.posted.push(message)
    },
    removeEventListener(type, listener) {
      if (type === 'message' && typeof listener === 'function') {
        messageListeners.delete(
          listener as (event: MessageEvent<unknown>) => void,
        )
      }
    },
  }
}

function asBroadcastChannel(channel: FakeBroadcastChannel): BroadcastChannel {
  return channel as unknown as BroadcastChannel
}

async function flushLoaderStart(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('identitySource 是唯一身份边界，null userId 固定拒绝且不调用 loader', async () => {
  const identitySource = new FakeIdentitySource({
    authEpoch: 1,
    userId: null,
  })
  let getCalls = 0
  let batchCalls = 0
  const controller = createDictionaryCatalogProviderController({
    identitySource,
    loader: createLoader({
      batch: async () => {
        batchCalls += 1
        return { dictionaries: [], missingCodes: ['sales.status'] }
      },
      get: async ({ code }) => {
        getCalls += 1
        return rawCatalog(code)
      },
    }),
  })

  assert.equal(identitySource.listenerCount, 1)
  await assert.rejects(
    controller.provider.get({
      code: 'sales.status',
      signal: new AbortController().signal,
    }),
    (error: unknown) => {
      assert.equal(error instanceof DictionaryCatalogIdentityRequiredError, true)
      assert.deepEqual(
        {
          code: (error as DictionaryCatalogIdentityRequiredError).code,
          message: (error as Error).message,
          name: (error as Error).name,
        },
        {
          code: 'DICTIONARY_CATALOG_IDENTITY_REQUIRED',
          message: 'Dictionary catalog identity is required',
          name: 'DictionaryCatalogIdentityRequiredError',
        },
      )
      return true
    },
  )
  await assert.rejects(
    controller.provider.prefetch({
      codes: ['sales.status'],
      signal: new AbortController().signal,
    }),
    DictionaryCatalogIdentityRequiredError,
  )
  assert.deepEqual({ batchCalls, getCalls }, { batchCalls: 0, getCalls: 0 })

  identitySource.set({ authEpoch: 2, userId: USER_A })
  assert.equal(
    (await controller.provider.get({
      code: 'sales.status',
      signal: new AbortController().signal,
    }))?.code,
    'sales.status',
  )
  assert.equal(getCalls, 1)

  controller.dispose()
  assert.equal(identitySource.listenerCount, 0)
})

test('缓存 key 使用 authEpoch/userId/code JSON tuple，正缓存 TTL 固定 300000ms', async () => {
  const identitySource = new FakeIdentitySource()
  let now = 10_000
  const calls: string[] = []
  const controller = createDictionaryCatalogProviderController({
    identitySource,
    loader: createLoader({
      get: async ({ code }) => {
        calls.push(`${identitySource.getSnapshot().authEpoch}:${identitySource.getSnapshot().userId}:${code}`)
        return rawCatalog(code)
      },
    }),
    now: () => now,
  })
  const signal = new AbortController().signal

  assert.equal(DICTIONARY_CATALOG_CACHE_TTL_MS, 300_000)
  await controller.provider.get({ code: ' Sales.Status\u0085', signal })
  await controller.provider.get({ code: 'sales.status', signal })
  assert.equal(calls.length, 1)

  now += DICTIONARY_CATALOG_CACHE_TTL_MS - 1
  await controller.provider.get({ code: 'sales.status', signal })
  assert.equal(calls.length, 1)

  now += 1
  await controller.provider.get({ code: 'sales.status', signal })
  assert.equal(calls.length, 2)

  identitySource.set({ authEpoch: 7, userId: USER_B })
  await controller.provider.get({ code: 'sales.status', signal })
  assert.equal(calls.length, 3, 'userId 必须参与 cache key')

  identitySource.set({ authEpoch: 8, userId: USER_B })
  await controller.provider.get({ code: 'sales.status', signal })
  assert.equal(calls.length, 4, 'authEpoch 必须参与 cache key')
  assert.deepEqual(calls, [
    `7:${USER_A}:sales.status`,
    `7:${USER_A}:sales.status`,
    `7:${USER_B}:sales.status`,
    `8:${USER_B}:sales.status`,
  ])

  controller.dispose()
})

test('get 仅将稳定 404 DICTIONARY_TYPE_NOT_FOUND 写入负缓存', async (t) => {
  await t.test('稳定 404 映射 null 并使用相同 TTL', async () => {
    let now = 0
    let calls = 0
    const controller = createDictionaryCatalogProviderController({
      identitySource: new FakeIdentitySource(),
      loader: createLoader({
        get: async () => {
          calls += 1
          throw stableNotFoundError()
        },
      }),
      now: () => now,
    })
    const input = {
      code: 'sales.status',
      signal: new AbortController().signal,
    }

    assert.equal(await controller.provider.get(input), null)
    assert.equal(await controller.provider.get(input), null)
    assert.equal(calls, 1)
    now += DICTIONARY_CATALOG_CACHE_TTL_MS
    assert.equal(await controller.provider.get(input), null)
    assert.equal(calls, 2)
    controller.dispose()
  })

  for (const malformed of [
    stableNotFoundError('DICTIONARY_ITEM_NOT_FOUND'),
    { ...stableNotFoundError(), status: 403 },
    {
      body: { code: 'DICTIONARY_TYPE_NOT_FOUND' },
      kind: 'http',
      status: 404,
    },
    {
      body: {
        code: 'DICTIONARY_TYPE_NOT_FOUND',
        message: '系统字典类型不存在',
        requestId: 42,
      },
      kind: 'http',
      status: 404,
    },
    {
      kind: 'http-unparseable',
      message: '服务器返回了无法识别的错误响应',
      status: 404,
    },
  ]) {
    await t.test(`非稳定 missing 不缓存: ${JSON.stringify(malformed)}`, async () => {
      let calls = 0
      const controller = createDictionaryCatalogProviderController({
        identitySource: new FakeIdentitySource(),
        loader: createLoader({
          get: async () => {
            calls += 1
            throw malformed
          },
        }),
      })
      const input = {
        code: 'sales.status',
        signal: new AbortController().signal,
      }

      await assert.rejects(controller.provider.get(input), error => error === malformed)
      await assert.rejects(controller.provider.get(input), error => error === malformed)
      assert.equal(calls, 2)
      controller.dispose()
    })
  }
})

test('网络失败和畸形成功响应均不进入缓存', async (t) => {
  const temporary = new Error('temporary network failure')
  const cases: Array<{
    readonly name: string
    readonly first: unknown
    readonly rejects: (error: unknown) => boolean
  }> = [
    {
      first: temporary,
      name: 'network failure',
      rejects: error => error === temporary,
    },
    {
      first: rawCatalog('sales.status', { name: '  非规范名称  ' }),
      name: 'malformed successful response',
      rejects: error => error instanceof DictionaryCatalogResponseError,
    },
  ]

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      let calls = 0
      const controller = createDictionaryCatalogProviderController({
        identitySource: new FakeIdentitySource(),
        loader: createLoader({
          get: async ({ code }) => {
            calls += 1
            if (calls === 1) {
              if (testCase.first instanceof Error) {
                throw testCase.first
              }
              return testCase.first
            }
            return rawCatalog(code)
          },
        }),
      })
      const input = {
        code: 'sales.status',
        signal: new AbortController().signal,
      }

      await assert.rejects(controller.provider.get(input), testCase.rejects)
      assert.equal((await controller.provider.get(input))?.code, 'sales.status')
      assert.equal(calls, 2)
      controller.dispose()
    })
  }
})

test('same-key in-flight 合并请求，消费者保持独立 Abort', async () => {
  const request = deferred<unknown>()
  let calls = 0
  let underlyingSignal: AbortSignal | undefined
  const controller = createDictionaryCatalogProviderController({
    identitySource: new FakeIdentitySource(),
    loader: createLoader({
      get: async ({ signal }) => {
        calls += 1
        underlyingSignal = signal
        return request.promise
      },
    }),
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = controller.provider.get({
    code: 'sales.status',
    signal: firstController.signal,
  })
  const second = controller.provider.get({
    code: 'sales.status',
    signal: secondController.signal,
  })

  await flushLoaderStart()
  assert.equal(calls, 1)
  firstController.abort()
  await assert.rejects(first, { name: 'AbortError' })
  assert.equal(underlyingSignal?.aborted, false)

  request.resolve(rawCatalog())
  assert.equal((await second)?.code, 'sales.status')
  assert.equal(calls, 1)
  controller.dispose()
})

test('最后消费者取消时中止底层请求，忽略 signal 的迟到结果不能污染缓存', async () => {
  const requests: Deferred<unknown>[] = []
  const signals: AbortSignal[] = []
  const controller = createDictionaryCatalogProviderController({
    identitySource: new FakeIdentitySource(),
    loader: createLoader({
      get: async ({ signal }) => {
        signals.push(signal)
        const request = deferred<unknown>()
        requests.push(request)
        return request.promise
      },
    }),
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = controller.provider.get({
    code: 'sales.status',
    signal: firstController.signal,
  })
  const second = controller.provider.get({
    code: 'sales.status',
    signal: secondController.signal,
  })
  await flushLoaderStart()

  firstController.abort()
  secondController.abort()
  await Promise.all([
    assert.rejects(first, { name: 'AbortError' }),
    assert.rejects(second, { name: 'AbortError' }),
  ])
  assert.equal(signals[0]?.aborted, true)

  const current = controller.provider.get({
    code: 'sales.status',
    signal: new AbortController().signal,
  })
  await flushLoaderStart()
  assert.equal(signals.length, 2)
  requests[1]?.resolve(rawCatalog('sales.status', { name: '当前数据' }))
  assert.equal((await current)?.name, '当前数据')

  requests[0]?.resolve(rawCatalog('sales.status', { name: '迟到旧数据' }))
  await flushLoaderStart()
  assert.equal(
    (await controller.provider.get({
      code: 'sales.status',
      signal: new AbortController().signal,
    }))?.name,
    '当前数据',
  )
  assert.equal(signals.length, 2)
  controller.dispose()
})

test('identity 变化清空所有 code，并以 generation 阻止旧身份迟到回写', async () => {
  const identitySource = new FakeIdentitySource()
  const requests: Deferred<unknown>[] = []
  const signals: AbortSignal[] = []
  const controller = createDictionaryCatalogProviderController({
    identitySource,
    loader: createLoader({
      get: async ({ signal }) => {
        signals.push(signal)
        const request = deferred<unknown>()
        requests.push(request)
        return request.promise
      },
    }),
  })
  const invalidations: Array<{ readonly code: string | null }> = []
  controller.provider.subscribeInvalidation(event => invalidations.push(event))

  const stale = controller.provider.get({
    code: 'sales.status',
    signal: new AbortController().signal,
  })
  await flushLoaderStart()
  identitySource.set({ authEpoch: 8, userId: USER_B })
  await assert.rejects(stale, { name: 'AbortError' })
  assert.equal(signals[0]?.aborted, true)
  assert.deepEqual(invalidations, [{ code: null }])

  const current = controller.provider.get({
    code: 'sales.status',
    signal: new AbortController().signal,
  })
  await flushLoaderStart()
  requests[1]?.resolve(rawCatalog('sales.status', { name: '新身份数据' }))
  assert.equal((await current)?.name, '新身份数据')

  requests[0]?.resolve(rawCatalog('sales.status', { name: '旧身份数据' }))
  await flushLoaderStart()
  assert.equal(
    (await controller.provider.get({
      code: 'sales.status',
      signal: new AbortController().signal,
    }))?.name,
    '新身份数据',
  )
  assert.equal(signals.length, 2)
  controller.dispose()
})

test('invalid identity snapshot 立即清空缓存且恢复同身份也必须重取', async () => {
  const identitySource = new FakeIdentitySource()
  let calls = 0
  const controller = createDictionaryCatalogProviderController({
    identitySource,
    loader: createLoader({
      get: async ({ code }) => {
        calls += 1
        return rawCatalog(code)
      },
    }),
  })
  const invalidations: Array<{ readonly code: string | null }> = []
  controller.provider.subscribeInvalidation(event => invalidations.push(event))
  const signal = new AbortController().signal

  await controller.provider.get({ code: 'sales.status', signal })
  identitySource.replaceSnapshot({ authEpoch: -1, userId: USER_A })
  await assert.rejects(
    controller.provider.get({ code: 'sales.status', signal }),
    TypeError,
  )
  assert.deepEqual(invalidations, [{ code: null }])

  identitySource.replaceSnapshot({ authEpoch: 7, userId: USER_A })
  await controller.provider.get({ code: 'sales.status', signal })
  assert.equal(calls, 2)
  controller.dispose()
})

test('invalid identity snapshot 立即中止既有 in-flight ownership', async () => {
  const identitySource = new FakeIdentitySource()
  const request = deferred<unknown>()
  let underlyingSignal: AbortSignal | undefined
  const controller = createDictionaryCatalogProviderController({
    identitySource,
    loader: createLoader({
      get: async ({ signal }) => {
        underlyingSignal = signal
        return request.promise
      },
    }),
  })
  const invalidations: Array<{ readonly code: string | null }> = []
  controller.provider.subscribeInvalidation(event => invalidations.push(event))
  const pending = controller.provider.get({
    code: 'sales.status',
    signal: new AbortController().signal,
  })
  await flushLoaderStart()

  try {
    identitySource.replaceSnapshot({ authEpoch: -1, userId: USER_A })
    await assert.rejects(
      controller.provider.get({
        code: 'order.status',
        signal: new AbortController().signal,
      }),
      TypeError,
    )
    assert.equal(underlyingSignal?.aborted, true)
    assert.deepEqual(invalidations, [{ code: null }])
  }
  finally {
    controller.dispose()
    request.resolve(rawCatalog())
    await pending.catch(() => undefined)
  }
})

test('身份订阅事件先于 snapshot 更新时也立即切断旧缓存', async () => {
  const identitySource = new FakeIdentitySource()
  let calls = 0
  const controller = createDictionaryCatalogProviderController({
    identitySource,
    loader: createLoader({
      get: async ({ code }) => {
        calls += 1
        return rawCatalog(code)
      },
    }),
  })
  const invalidations: Array<{ readonly code: string | null }> = []
  const synchronousReloads: Array<Promise<unknown>> = []
  controller.provider.subscribeInvalidation((event) => {
    invalidations.push(event)
    synchronousReloads.push(controller.provider.get({
      code: 'sales.status',
      signal: new AbortController().signal,
    }))
  })
  const signal = new AbortController().signal

  await controller.provider.get({ code: 'sales.status', signal })
  identitySource.emit({ authEpoch: 8, userId: USER_B })
  assert.deepEqual(invalidations, [{ code: null }])
  assert.equal(synchronousReloads.length, 1)
  await assert.rejects(synchronousReloads[0]!, { name: 'AbortError' })
  assert.equal(calls, 1, 'snapshot 追平前不得重新请求旧身份 Catalog')

  // 正式 identity source 随后提交同一 snapshot，不应重复发送失效事件。
  identitySource.set({ authEpoch: 8, userId: USER_B })
  await controller.provider.get({ code: 'sales.status', signal })
  assert.equal(calls, 2, '订阅事件必须在 snapshot 提交前立即清除旧身份缓存')
  assert.deepEqual(invalidations, [{ code: null }])
  controller.dispose()
})

test('精确失效只中止目标 code，其他缓存保留且迟到响应不能复活', async () => {
  const staleSales = deferred<unknown>()
  let salesCalls = 0
  let orderCalls = 0
  const controller = createDictionaryCatalogProviderController({
    identitySource: new FakeIdentitySource(),
    loader: createLoader({
      get: async ({ code }) => {
        if (code === 'order.status') {
          orderCalls += 1
          return rawCatalog(code)
        }
        salesCalls += 1
        return salesCalls === 1
          ? staleSales.promise
          : rawCatalog(code, { name: '失效后的数据' })
      },
    }),
  })
  const invalidations: Array<{ readonly code: string | null }> = []
  controller.provider.subscribeInvalidation(event => invalidations.push(event))
  const signal = new AbortController().signal

  await controller.provider.get({ code: 'order.status', signal })
  const stale = controller.provider.get({ code: 'sales.status', signal })
  await flushLoaderStart()
  controller.invalidate({ broadcast: false, code: ' Sales.Status\u0085' })
  await assert.rejects(stale, { name: 'AbortError' })
  assert.deepEqual(invalidations, [{ code: 'sales.status' }])

  await controller.provider.get({ code: 'order.status', signal })
  assert.equal(orderCalls, 1, '无关 code 的正缓存必须保留')
  assert.equal(
    (await controller.provider.get({ code: 'sales.status', signal }))?.name,
    '失效后的数据',
  )

  staleSales.resolve(rawCatalog('sales.status', { name: '迟到旧数据' }))
  await flushLoaderStart()
  assert.equal(
    (await controller.provider.get({ code: 'sales.status', signal }))?.name,
    '失效后的数据',
  )
  assert.equal(salesCalls, 2)
  controller.dispose()
})

test('prefetch 规范化去重且保持首次顺序，空输入 no-op，唯一 code 最多 20 个', async () => {
  const batchCalls: string[][] = []
  let getCalls = 0
  const controller = createDictionaryCatalogProviderController({
    identitySource: new FakeIdentitySource(),
    loader: createLoader({
      batch: async ({ codes }) => {
        batchCalls.push([...codes])
        return {
          dictionaries: [rawCatalog('sales.status')],
          missingCodes: ['order.status'],
        }
      },
      get: async () => {
        getCalls += 1
        throw new Error('prefetch cache should satisfy get')
      },
    }),
  })
  const signal = new AbortController().signal

  await controller.provider.prefetch({ codes: [], signal })
  assert.equal(batchCalls.length, 0)
  await controller.provider.prefetch({
    codes: [
      ' Sales.Status\u0085',
      'sales.status',
      ' Order.Status ',
      'order.status',
    ],
    signal,
  })
  assert.deepEqual(batchCalls, [['sales.status', 'order.status']])
  assert.equal(
    (await controller.provider.get({ code: 'sales.status', signal }))?.code,
    'sales.status',
  )
  assert.equal(
    await controller.provider.get({ code: 'order.status', signal }),
    null,
  )
  assert.equal(getCalls, 0, 'batch found 与 missing 都必须进入各自缓存')

  await assert.rejects(
    controller.provider.prefetch({
      codes: Array.from({ length: 21 }, (_, index) => `batch.code${index}`),
      signal,
    }),
    TypeError,
  )
  assert.equal(batchCalls.length, 1)
  controller.dispose()
})

test('共享 batch 中一个 code 失效时，其他 code 仍可安全写入缓存', async () => {
  const batchRequest = deferred<unknown>()
  let batchSignal: AbortSignal | undefined
  const getCalls: string[] = []
  const controller = createDictionaryCatalogProviderController({
    identitySource: new FakeIdentitySource(),
    loader: createLoader({
      batch: async ({ signal }) => {
        batchSignal = signal
        return batchRequest.promise
      },
      get: async ({ code }) => {
        getCalls.push(code)
        return rawCatalog(code, { name: `${code} 单查新数据` })
      },
    }),
  })
  const signal = new AbortController().signal
  const prefetch = controller.provider.prefetch({
    codes: ['sales.status', 'order.status'],
    signal,
  })
  await flushLoaderStart()

  controller.invalidate({ broadcast: false, code: 'sales.status' })
  assert.equal(batchSignal?.aborted, false, '共享 batch 仍有未失效 code，不应整体取消')
  batchRequest.resolve({
    dictionaries: [
      rawCatalog('sales.status', { name: 'sales batch 旧数据' }),
      rawCatalog('order.status', { name: 'order batch 数据' }),
    ],
    missingCodes: [],
  })
  await prefetch

  assert.equal(
    (await controller.provider.get({ code: 'order.status', signal }))?.name,
    'order batch 数据',
  )
  assert.deepEqual(getCalls, [])
  assert.equal(
    (await controller.provider.get({ code: 'sales.status', signal }))?.name,
    'sales.status 单查新数据',
  )
  assert.deepEqual(getCalls, ['sales.status'])
  controller.dispose()
})

test('精确失效会中止已加入共享 batch 的目标 get，但保留 prefetch', async () => {
  const batchRequest = deferred<unknown>()
  let batchSignal: AbortSignal | undefined
  const controller = createDictionaryCatalogProviderController({
    identitySource: new FakeIdentitySource(),
    loader: createLoader({
      batch: async ({ signal }) => {
        batchSignal = signal
        return batchRequest.promise
      },
      get: async ({ code }) => rawCatalog(code, { name: '单查新数据' }),
    }),
  })
  const signal = new AbortController().signal
  const prefetch = controller.provider.prefetch({
    codes: ['sales.status', 'order.status'],
    signal,
  })
  await flushLoaderStart()
  const joined = controller.provider.get({ code: 'sales.status', signal })
  const joinedOutcome = joined.then(
    () => 'resolved',
    (error: unknown) => error instanceof Error ? error.name : 'unknown',
  )

  controller.invalidate({ broadcast: false, code: 'sales.status' })
  const outcomeBeforeBatch = await Promise.race([
    joinedOutcome,
    new Promise<'pending'>(resolve => setTimeout(resolve, 0, 'pending')),
  ])
  const batchStillActive = batchSignal?.aborted === false

  batchRequest.resolve({
    dictionaries: [rawCatalog('sales.status'), rawCatalog('order.status')],
    missingCodes: [],
  })
  await Promise.allSettled([prefetch, joined])
  controller.dispose()

  assert.equal(outcomeBeforeBatch, 'AbortError')
  assert.equal(batchStillActive, true)
})

test('BroadcastChannel 只接受 exact plain message，本地先失效且接收方不回播', async () => {
  const channel = createFakeBroadcastChannel()
  const channelNames: string[] = []
  const calls: string[] = []
  const controller = createDictionaryCatalogProviderController({
    createBroadcastChannel: (name) => {
      channelNames.push(name)
      return asBroadcastChannel(channel)
    },
    identitySource: new FakeIdentitySource(),
    loader: createLoader({
      get: async ({ code }) => {
        calls.push(code)
        return rawCatalog(code)
      },
    }),
  })
  const signal = new AbortController().signal
  const received: Array<{ readonly code: string | null }> = []
  controller.provider.subscribeInvalidation(() => {
    throw new Error('一个订阅者异常不能阻断其他订阅者')
  })
  const unsubscribe = controller.provider.subscribeInvalidation((event) => {
    received.push(event)
  })

  await controller.provider.get({ code: 'sales.status', signal })
  await controller.provider.get({ code: 'order.status', signal })
  controller.invalidate({ broadcast: true, code: ' Sales.Status\u0085' })
  assert.deepEqual(channelNames, ['qianshu-dictionary-catalog-v1'])
  assert.deepEqual(channel.posted, [{
    code: 'sales.status',
    type: 'DICTIONARY_CATALOG_CHANGED',
  }])
  assert.deepEqual(
    Object.keys(channel.posted[0] as object).sort(),
    ['code', 'type'],
  )
  assert.deepEqual(received, [{ code: 'sales.status' }])
  assert.equal(
    (await controller.provider.get({ code: 'order.status', signal }))?.code,
    'order.status',
  )
  assert.deepEqual(calls, ['sales.status', 'order.status'])

  class NonPlainMessage {
    readonly code = 'order.status'
    readonly type = 'DICTIONARY_CATALOG_CHANGED'
  }
  const nonEnumerableExtra = {
    code: 'order.status',
    type: 'DICTIONARY_CATALOG_CHANGED',
  }
  Object.defineProperty(nonEnumerableExtra, 'leaked', { value: true })
  const symbolExtra = {
    code: 'order.status',
    type: 'DICTIONARY_CATALOG_CHANGED',
    [Symbol('leaked')]: true,
  }
  for (const malformed of [
    {
      code: 'order.status',
      leaked: true,
      type: 'DICTIONARY_CATALOG_CHANGED',
    },
    { code: 'order/status', type: 'DICTIONARY_CATALOG_CHANGED' },
    { code: 'order.status', type: 'WRONG_TYPE' },
    new NonPlainMessage(),
    nonEnumerableExtra,
    symbolExtra,
  ]) {
    channel.emit(malformed)
  }
  assert.equal(received.length, 1)

  channel.emit({
    code: 'order.status',
    type: 'DICTIONARY_CATALOG_CHANGED',
  })
  assert.deepEqual(received, [
    { code: 'sales.status' },
    { code: 'order.status' },
  ])
  assert.equal(channel.posted.length, 1, '接收跨标签消息不得再次广播')

  unsubscribe()
  controller.invalidate({ broadcast: false, code: 'sales.status' })
  assert.equal(received.length, 2)
  controller.dispose()
  assert.equal(channel.closeCalls, 1)
})

test('BroadcastChannel 与 dispose 均为 best-effort，dispose 幂等并清理身份订阅', async () => {
  const identitySource = new FakeIdentitySource()
  const channel = createFakeBroadcastChannel()
  channel.postError = new Error('post failed')
  channel.closeError = new Error('close failed')
  const request = deferred<unknown>()
  let underlyingSignal: AbortSignal | undefined
  const controller = createDictionaryCatalogProviderController({
    createBroadcastChannel: () => asBroadcastChannel(channel),
    identitySource,
    loader: createLoader({
      get: async ({ signal }) => {
        underlyingSignal = signal
        return request.promise
      },
    }),
  })
  const invalidations: Array<{ readonly code: string | null }> = []
  controller.provider.subscribeInvalidation(event => invalidations.push(event))

  assert.doesNotThrow(() => {
    controller.invalidate({ broadcast: true, code: 'sales.status' })
  })
  assert.deepEqual(invalidations, [{ code: 'sales.status' }])

  const pending = controller.provider.get({
    code: 'sales.status',
    signal: new AbortController().signal,
  })
  await flushLoaderStart()
  assert.equal(identitySource.listenerCount, 1)
  assert.doesNotThrow(() => controller.dispose())
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(underlyingSignal?.aborted, true)
  assert.equal(identitySource.listenerCount, 0)
  assert.equal(channel.closeCalls, 1)

  request.reject(new Error('late loader failure'))
  await flushLoaderStart()
  assert.doesNotThrow(() => controller.dispose())
  assert.equal(channel.closeCalls, 1)

  controller.invalidate({ broadcast: true, code: 'sales.status' })
  assert.equal(invalidations.length, 1)
  await assert.rejects(
    controller.provider.get({
      code: 'sales.status',
      signal: new AbortController().signal,
    }),
    { name: 'AbortError' },
  )

  const factoryFailureController = createDictionaryCatalogProviderController({
    createBroadcastChannel: () => {
      throw new Error('channel unavailable')
    },
    identitySource: new FakeIdentitySource(),
    loader: createLoader(),
  })
  assert.equal(
    (await factoryFailureController.provider.get({
      code: 'sales.status',
      signal: new AbortController().signal,
    }))?.code,
    'sales.status',
  )
  factoryFailureController.dispose()
})

test('Provider kernel 不依赖 API、Store、Pinia、generated DTO 或持久化能力', () => {
  const providerSource = readFileSync(
    new URL('../../src/dictionary-catalog/provider.ts', import.meta.url),
    'utf8',
  )
  const typesSource = readFileSync(
    new URL('../../src/dictionary-catalog/types.ts', import.meta.url),
    'utf8',
  )
  const validationSource = readFileSync(
    new URL('../../src/dictionary-catalog/validation.ts', import.meta.url),
    'utf8',
  )
  const combined = `${providerSource}\n${typesSource}\n${validationSource}`

  assert.match(
    providerSource,
    /JSON\.stringify\(\[[^\]]*authEpoch[^\]]*userId[^\]]*code[^\]]*\]\)/u,
  )
  assert.doesNotMatch(combined, /from ['"][^'"]*\/api[/'"]/u)
  assert.doesNotMatch(combined, /from ['"][^'"]*\/store[/'"]/u)
  assert.doesNotMatch(combined, /from ['"]pinia['"]/u)
  assert.doesNotMatch(combined, /generated\/api/u)
  assert.doesNotMatch(
    combined,
    /\b(?:localStorage|sessionStorage|indexedDB)\s*[.[]/u,
  )
  assert.doesNotMatch(providerSource, /new\s+BroadcastChannel\b/u)
})
