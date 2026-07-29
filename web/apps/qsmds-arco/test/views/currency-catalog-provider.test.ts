import type {
  CurrencyCatalogBroadcastChannel,
  CurrencyCatalogIdentity,
  CurrencyCatalogLoader,
} from '../../src/currency-catalog/provider'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- Catalog kernel 是无 DOM 的纯 TypeScript 可信边界。
import test from 'node:test'

import {
  createCurrencyCatalogProvider,
  CURRENCY_CATALOG_CACHE_TTL_MS,
  CurrencyCatalogResponseError,
} from '../../src/currency-catalog/provider'

const CNY_ID = '00000000-0000-4000-8000-000000001001'
const TWD_ID = '00000000-0000-4000-8000-000000001002'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly reject: (reason?: unknown) => void
  readonly resolve: (value: T) => void
}

interface FakeChannel extends CurrencyCatalogBroadcastChannel {
  readonly posted: unknown[]
  closed: boolean
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

function rawCurrency(
  code: 'CNY' | 'TWD' = 'CNY',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const currency = code === 'CNY'
    ? {
        code: 'CNY',
        enabled: true,
        englishName: 'Chinese Yuan',
        id: CNY_ID,
        isBase: true,
        minorUnit: 2,
        name: '人民币',
        sortOrder: 10,
        symbol: '¥',
      }
    : {
        code: 'TWD',
        enabled: false,
        englishName: 'New Taiwan Dollar',
        id: TWD_ID,
        isBase: false,
        minorUnit: 2,
        name: '新台币',
        sortOrder: 20,
        symbol: 'NT$',
      }

  return {
    ...currency,
    ...overrides,
  }
}

function validCatalog(): Record<string, unknown>[] {
  return [rawCurrency('CNY'), rawCurrency('TWD')]
}

function createFakeChannel(): FakeChannel {
  return {
    closed: false,
    onmessage: null,
    posted: [],
    close() {
      this.closed = true
    },
    postMessage(message) {
      this.posted.push(message)
    },
  }
}

function createHarness(input: {
  loader?: CurrencyCatalogLoader
  identity?: CurrencyCatalogIdentity
  now?: () => number
  authController?: AbortController
  channelFactory?: (name: string) => CurrencyCatalogBroadcastChannel
} = {}) {
  let identity = input.identity ?? {
    authEpoch: 7,
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }
  let authController = input.authController ?? new AbortController()
  const controller = createCurrencyCatalogProvider({
    channelFactory: input.channelFactory,
    getAuthSignal: () => authController.signal,
    getIdentity: () => identity,
    loader: input.loader ?? (async () => validCatalog()),
    now: input.now ?? (() => 1_000),
  })

  return {
    ...controller,
    setAuthController(next: AbortController) {
      authController = next
    },
    setIdentity(next: CurrencyCatalogIdentity) {
      identity = next
    },
  }
}

test('白名单 clone 全量目录（含停用货币），并返回独立 deep-frozen 公共类型', async () => {
  const rawTwd = rawCurrency('TWD', {
    internalSecret: 'must-not-escape',
  })
  const harness = createHarness({
    loader: async () => [
      rawCurrency('CNY', {
        internalAudit: { actor: 'system' },
      }),
      rawTwd,
    ],
  })

  const result = await harness.provider.list({
    signal: new AbortController().signal,
  })

  assert.equal(result.length, 2)
  assert.deepEqual(result[1], {
    code: 'TWD',
    enabled: false,
    englishName: 'New Taiwan Dollar',
    id: TWD_ID,
    isBase: false,
    minorUnit: 2,
    name: '新台币',
    sortOrder: 20,
    symbol: 'NT$',
  })
  assert.equal('internalSecret' in (result[1] as object), false)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(result.every(Object.isFrozen), true)

  rawTwd.name = '被污染'
  assert.equal(result[1]?.name, '新台币')
  assert.throws(() => {
    Object.assign(result[1] as object, { name: '无法修改' })
  }, TypeError)

  harness.dispose()
})

test('目录运行时拒绝重复 code、非法 minorUnit 以及不唯一的 CNY base', async (t) => {
  const malformedCases: Array<{
    readonly name: string
    readonly response: unknown
  }> = [
    {
      name: '响应不是数组',
      response: { items: validCatalog() },
    },
    {
      name: 'code 不是三个大写字母',
      response: [
        rawCurrency('CNY'),
        rawCurrency('TWD', { code: 'twd' }),
      ],
    },
    {
      name: 'code 重复',
      response: [
        rawCurrency('CNY'),
        rawCurrency('TWD', { code: 'CNY', isBase: false }),
      ],
    },
    {
      name: 'minorUnit 不是整数',
      response: [
        rawCurrency('CNY'),
        rawCurrency('TWD', { minorUnit: 2.5 }),
      ],
    },
    {
      name: 'minorUnit 小于 0',
      response: [
        rawCurrency('CNY'),
        rawCurrency('TWD', { minorUnit: -1 }),
      ],
    },
    {
      name: 'minorUnit 大于 4',
      response: [
        rawCurrency('CNY'),
        rawCurrency('TWD', { minorUnit: 5 }),
      ],
    },
    {
      name: '没有 base',
      response: [
        rawCurrency('CNY', { isBase: false }),
        rawCurrency('TWD'),
      ],
    },
    {
      name: 'base 不是 CNY',
      response: [
        rawCurrency('CNY', { isBase: false }),
        rawCurrency('TWD', { isBase: true }),
      ],
    },
    {
      name: '存在两个 base',
      response: [
        rawCurrency('CNY'),
        rawCurrency('TWD', { isBase: true }),
      ],
    },
    {
      name: 'nullable 字段不能是空白字符串',
      response: [
        rawCurrency('CNY'),
        rawCurrency('TWD', { symbol: ' ' }),
      ],
    },
  ]

  for (const malformed of malformedCases) {
    await t.test(malformed.name, async () => {
      const harness = createHarness({
        loader: async () => malformed.response,
      })

      await assert.rejects(
        harness.provider.list({
          signal: new AbortController().signal,
        }),
        (error: unknown) => {
          assert.equal(error instanceof CurrencyCatalogResponseError, true)
          assert.deepEqual(
            {
              code: (error as CurrencyCatalogResponseError).code,
              message: (error as Error).message,
              name: (error as Error).name,
            },
            {
              code: 'CURRENCY_CATALOG_RESPONSE_INVALID',
              message: '货币目录响应格式无效',
              name: 'CurrencyCatalogResponseError',
            },
          )
          assert.doesNotMatch(
            JSON.stringify(error),
            /must-not-escape|internalAudit/u,
          )
          return true
        },
      )

      harness.dispose()
    })
  }
})

test('nullable 展示字段保持 null，其余字段仍需完整且有效', async () => {
  const harness = createHarness({
    loader: async () => [
      rawCurrency('CNY'),
      rawCurrency('TWD', {
        englishName: null,
        symbol: null,
      }),
    ],
  })

  const result = await harness.provider.list({
    signal: new AbortController().signal,
  })

  assert.equal(result[1]?.englishName, null)
  assert.equal(result[1]?.symbol, null)
  harness.dispose()
})

test('TTL 固定 300000ms、identity 参与缓存 key，且失败不进入缓存', async () => {
  let now = 10_000
  let calls = 0
  let shouldFail = true
  const harness = createHarness({
    loader: async () => {
      calls += 1
      if (shouldFail) {
        shouldFail = false
        throw new Error('temporary')
      }
      return validCatalog()
    },
    now: () => now,
  })
  const signal = new AbortController().signal

  assert.equal(CURRENCY_CATALOG_CACHE_TTL_MS, 300_000)
  await assert.rejects(harness.provider.list({ signal }), /temporary/u)
  await harness.provider.list({ signal })
  await harness.provider.list({ signal })
  assert.equal(calls, 2, 'failure 不能缓存，成功结果应缓存')

  now += CURRENCY_CATALOG_CACHE_TTL_MS - 1
  await harness.provider.list({ signal })
  assert.equal(calls, 2)

  now += 1
  await harness.provider.list({ signal })
  assert.equal(calls, 3)

  harness.setIdentity({
    authEpoch: 7,
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  await harness.provider.list({ signal })
  assert.equal(calls, 4, 'userId 变化必须隔离缓存')

  harness.setIdentity({
    authEpoch: 8,
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  await harness.provider.list({ signal })
  assert.equal(calls, 5, 'authEpoch 变化必须隔离缓存')

  harness.dispose()
})

test('相同 identity 合并底层请求，单个消费者取消不影响其他消费者', async () => {
  const request = deferred<unknown>()
  let calls = 0
  let underlyingSignal: AbortSignal | undefined
  const harness = createHarness({
    loader: async (signal) => {
      calls += 1
      underlyingSignal = signal
      return request.promise
    },
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = harness.provider.list({ signal: firstController.signal })
  const second = harness.provider.list({ signal: secondController.signal })

  await Promise.resolve()
  assert.equal(calls, 1)

  firstController.abort()
  await assert.rejects(first, { name: 'AbortError' })
  assert.equal(underlyingSignal?.aborted, false)

  request.resolve(validCatalog())
  assert.equal((await second)[0]?.code, 'CNY')

  harness.dispose()
})

test('全部消费者取消会中止底层请求，忽略 signal 的迟到响应不得污染缓存', async () => {
  const requests: Deferred<unknown>[] = []
  const signals: AbortSignal[] = []
  const harness = createHarness({
    loader: async (signal) => {
      signals.push(signal)
      const request = deferred<unknown>()
      requests.push(request)
      return request.promise
    },
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = harness.provider.list({ signal: firstController.signal })
  const second = harness.provider.list({ signal: secondController.signal })
  await Promise.resolve()

  firstController.abort()
  secondController.abort()
  await Promise.all([
    assert.rejects(first, { name: 'AbortError' }),
    assert.rejects(second, { name: 'AbortError' }),
  ])
  assert.equal(signals[0]?.aborted, true)

  const third = harness.provider.list({
    signal: new AbortController().signal,
  })
  await Promise.resolve()
  assert.equal(signals.length, 2)
  requests[1]?.resolve(validCatalog())
  assert.equal((await third)[1]?.code, 'TWD')

  requests[0]?.resolve([
    rawCurrency('CNY'),
    rawCurrency('TWD', { name: '旧数据' }),
  ])
  await Promise.resolve()

  assert.equal(
    (await harness.provider.list({
      signal: new AbortController().signal,
    }))[1]?.name,
    '新台币',
  )
  assert.equal(signals.length, 2)

  harness.dispose()
})

test('auth abort 与静默 identity/signal 替换都阻断迟到响应回写', async () => {
  const firstRequest = deferred<unknown>()
  const secondRequest = deferred<unknown>()
  const firstAuth = new AbortController()
  let calls = 0
  const harness = createHarness({
    authController: firstAuth,
    loader: async () => {
      calls += 1
      if (calls === 1) {
        return firstRequest.promise
      }
      if (calls === 2) {
        return secondRequest.promise
      }
      return validCatalog()
    },
  })
  let invalidations = 0
  harness.provider.subscribeInvalidation?.(() => {
    invalidations += 1
  })

  const aborted = harness.provider.list({
    signal: new AbortController().signal,
  })
  await Promise.resolve()
  firstAuth.abort()
  await assert.rejects(aborted, { name: 'AbortError' })
  assert.equal(invalidations, 1)
  firstRequest.resolve(validCatalog())

  harness.setIdentity({
    authEpoch: 8,
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  harness.setAuthController(new AbortController())
  const stale = harness.provider.list({
    signal: new AbortController().signal,
  })
  await Promise.resolve()

  harness.setIdentity({
    authEpoch: 9,
    userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  })
  harness.setAuthController(new AbortController())
  secondRequest.resolve(validCatalog())
  await assert.rejects(stale, { name: 'AbortError' })

  await harness.provider.list({
    signal: new AbortController().signal,
  })
  assert.equal(calls, 3, '两个迟到响应都不得写入新 identity 的缓存')

  harness.dispose()
})

test('local invalidation 与 BroadcastChannel 仅接受 exact message 且不回广播', async () => {
  const channel = createFakeChannel()
  const channelNames: string[] = []
  let calls = 0
  const harness = createHarness({
    channelFactory: (name) => {
      channelNames.push(name)
      return channel
    },
    loader: async () => {
      calls += 1
      return validCatalog()
    },
  })
  const signal = new AbortController().signal
  let invalidations = 0
  const unsubscribe = harness.provider.subscribeInvalidation?.(() => {
    invalidations += 1
  })

  await harness.provider.list({ signal })
  harness.invalidate({ broadcast: false })
  assert.equal(invalidations, 1)
  assert.deepEqual(channel.posted, [])
  await harness.provider.list({ signal })
  assert.equal(calls, 2)

  harness.invalidate({ broadcast: true })
  assert.deepEqual(channelNames, ['qianshu-currency-catalog-v1'])
  assert.deepEqual(channel.posted, [{
    type: 'CURRENCY_CATALOG_CHANGED',
  }])
  assert.deepEqual(Object.keys(channel.posted[0] as object), ['type'])
  assert.equal(invalidations, 2)

  channel.onmessage?.({
    data: {
      leakedCurrencyData: validCatalog(),
      type: 'CURRENCY_CATALOG_CHANGED',
    },
  } as MessageEvent<unknown>)
  assert.equal(invalidations, 2, '非 exact message 必须忽略')

  channel.onmessage?.({
    data: { type: 'CURRENCY_CATALOG_CHANGED' },
  } as MessageEvent<unknown>)
  assert.equal(invalidations, 3)
  assert.equal(channel.posted.length, 1, 'incoming message 不得重播')

  unsubscribe?.()
  harness.invalidate({ broadcast: false })
  assert.equal(invalidations, 3)

  harness.dispose()
  assert.equal(channel.closed, true)
  assert.equal(channel.onmessage, null)
})

test('初始 identity 无效时不创建 BroadcastChannel 资源', () => {
  const channel = createFakeChannel()
  let channelFactoryCalls = 0

  assert.throws(
    () => createCurrencyCatalogProvider({
      channelFactory: () => {
        channelFactoryCalls += 1
        return channel
      },
      getAuthSignal: () => new AbortController().signal,
      getIdentity: () => {
        throw new Error('identity unavailable')
      },
      loader: async () => validCatalog(),
      now: () => 0,
    }),
    /identity unavailable/u,
  )

  assert.equal(channelFactoryCalls, 0)
  assert.equal(channel.closed, false)
})

test('Catalog kernel 不导入 API、Store、generated DTO 或持久化能力', () => {
  const providerSource = readFileSync(
    new URL('../../src/currency-catalog/provider.ts', import.meta.url),
    'utf8',
  )
  const typesSource = readFileSync(
    new URL('../../src/currency-catalog/types.ts', import.meta.url),
    'utf8',
  )
  const validationSource = readFileSync(
    new URL('../../src/currency-catalog/validation.ts', import.meta.url),
    'utf8',
  )
  const combined = `${providerSource}\n${typesSource}\n${validationSource}`

  assert.doesNotMatch(combined, /from ['"][^'"]*\/api[/'"]/u)
  assert.doesNotMatch(combined, /from ['"][^'"]*\/store[/'"]/u)
  assert.doesNotMatch(combined, /generated\/api/u)
  assert.doesNotMatch(
    combined,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/u,
  )
  assert.doesNotMatch(combined, /new BroadcastChannel/u)
})
