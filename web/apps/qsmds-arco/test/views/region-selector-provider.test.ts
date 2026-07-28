import type {
  RegionSelectorDataSource,
  RegionSelectorIdentity,
} from '../../src/components/business/QsRegionSelector/provider'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- Provider 是无 DOM 的纯 TypeScript 边界，使用 Node.js 内置 runner。
import test from 'node:test'

import {
  createRegionSelectorProvider,
  installDefaultRegionSelectorProvider,
  invalidateRegionSelectorCache,
  REGION_SELECTOR_CACHE_TTL_MS,
  RegionSelectorResponseError,
} from '../../src/components/business/QsRegionSelector/provider'

const COUNTRY_ID = '11111111-1111-4111-8111-111111111111'
const PROVINCE_ID = '22222222-2222-4222-8222-222222222222'
const CITY_ID = '33333333-3333-4333-8333-333333333333'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason?: unknown) => void
}

interface FakeChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  readonly posted: unknown[]
  closed: boolean
  postMessage: (message: unknown) => void
  close: () => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function rawNode(
  level: 'COUNTRY_REGION' | 'PROVINCE_STATE' | 'CITY',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const values = level === 'COUNTRY_REGION'
    ? {
        code: 'CN',
        englishName: 'China',
        hasChildren: true,
        id: COUNTRY_ID,
        name: '中国',
        parentId: null,
      }
    : level === 'PROVINCE_STATE'
      ? {
          code: 'CN-TW',
          englishName: 'Taiwan',
          hasChildren: true,
          id: PROVINCE_ID,
          name: '台湾',
          parentId: COUNTRY_ID,
        }
      : {
          code: 'CN-TW-KHH',
          englishName: 'Kaohsiung City',
          hasChildren: false,
          id: CITY_ID,
          name: '高雄市',
          parentId: PROVINCE_ID,
        }

  return {
    ...values,
    effectiveEnabled: true,
    enabled: true,
    level,
    ...overrides,
  }
}

function rawPath(cityId = CITY_ID): {
  cityId: string
  path: Record<string, unknown>[]
} {
  return {
    cityId,
    path: [
      rawNode('COUNTRY_REGION'),
      rawNode('PROVINCE_STATE'),
      rawNode('CITY', { id: cityId }),
    ],
  }
}

function createDataSource(
  overrides: Partial<RegionSelectorDataSource> = {},
): RegionSelectorDataSource {
  return {
    getPath: async cityId => rawPath(cityId),
    listOptions: async parentId => parentId === null
      ? [rawNode('COUNTRY_REGION')]
      : [rawNode('PROVINCE_STATE', { parentId })],
    search: async () => ({
      hasMore: false,
      items: [{
        cityId: CITY_ID,
        path: rawPath().path,
      }],
      limit: 50,
    }),
    ...overrides,
  }
}

function createHarness(input: {
  dataSource?: RegionSelectorDataSource
  identity?: RegionSelectorIdentity
  now?: () => number
  authController?: AbortController
  channelFactory?: (name: string) => FakeChannel
} = {}) {
  let identity = input.identity ?? {
    authEpoch: 7,
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }
  let authController = input.authController ?? new AbortController()
  const controller = createRegionSelectorProvider({
    channelFactory: input.channelFactory,
    dataSource: input.dataSource ?? createDataSource(),
    getAuthSignal: () => authController.signal,
    getIdentity: () => identity,
    now: input.now ?? (() => 1_000),
  })

  return {
    ...controller,
    setAuthController(next: AbortController) {
      authController = next
    },
    setIdentity(next: RegionSelectorIdentity) {
      identity = next
    },
  }
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

test('DTO 经过白名单 clone、运行时校验和 deep freeze 后才进入公共只读类型', async () => {
  const rawCountry = rawNode('COUNTRY_REGION', {
    internalSecret: 'must-not-escape',
  })
  const source = createDataSource({
    listOptions: async () => [rawCountry],
  })
  const harness = createHarness({ dataSource: source })

  const result = await harness.provider.listChildren({
    parentId: null,
    signal: new AbortController().signal,
  })

  assert.equal(result.length, 1)
  assert.deepEqual(result[0], {
    code: 'CN',
    effectiveEnabled: true,
    enabled: true,
    englishName: 'China',
    hasChildren: true,
    id: COUNTRY_ID,
    level: 'COUNTRY_REGION',
    name: '中国',
    parentId: null,
  })
  assert.equal('internalSecret' in (result[0] as object), false)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result[0]), true)

  rawCountry.name = '被污染'
  assert.equal(result[0]?.name, '中国')
  assert.throws(() => {
    Object.assign(result[0] as object, { name: '无法修改' })
  }, TypeError)

  harness.dispose()
})

test('path 必须恰好三级、level 与 parent 连续，且末级 ID 等于请求 city ID', async (t) => {
  const malformedCases: Array<{
    name: string
    response: unknown
  }> = [
    {
      name: 'path 少于三级',
      response: {
        cityId: CITY_ID,
        path: rawPath().path.slice(0, 2),
      },
    },
    {
      name: 'level 顺序错误',
      response: {
        cityId: CITY_ID,
        path: [
          rawNode('COUNTRY_REGION'),
          rawNode('CITY'),
          rawNode('PROVINCE_STATE'),
        ],
      },
    },
    {
      name: 'parent 不连续',
      response: {
        cityId: CITY_ID,
        path: [
          rawNode('COUNTRY_REGION'),
          rawNode('PROVINCE_STATE', {
            parentId: '44444444-4444-4444-8444-444444444444',
          }),
          rawNode('CITY'),
        ],
      },
    },
    {
      name: '末级 ID 与请求不一致',
      response: rawPath('55555555-5555-4555-8555-555555555555'),
    },
    {
      name: '必要字段类型错误',
      response: {
        cityId: CITY_ID,
        path: [
          rawNode('COUNTRY_REGION'),
          rawNode('PROVINCE_STATE'),
          rawNode('CITY', { effectiveEnabled: 'true' }),
        ],
      },
    },
  ]

  for (const malformed of malformedCases) {
    await t.test(malformed.name, async () => {
      const harness = createHarness({
        dataSource: createDataSource({
          getPath: async () => malformed.response,
        }),
      })

      await assert.rejects(
        harness.provider.resolvePath({
          cityId: CITY_ID,
          signal: new AbortController().signal,
        }),
        (error: unknown) => {
          assert.equal(error instanceof RegionSelectorResponseError, true)
          assert.deepEqual(
            {
              code: (error as RegionSelectorResponseError).code,
              message: (error as Error).message,
              name: (error as Error).name,
            },
            {
              code: 'REGION_SELECTOR_RESPONSE_INVALID',
              message: '地区数据响应格式无效',
              name: 'RegionSelectorResponseError',
            },
          )
          assert.doesNotMatch(
            JSON.stringify(error),
            /must-not-escape|55555555/u,
          )
          return true
        },
      )
      harness.dispose()
    })
  }
})

test('resolvePath 与 search 返回独立 deep-frozen path，并剥离 DTO envelope 字段', async () => {
  const harness = createHarness()
  const signal = new AbortController().signal

  const path = await harness.provider.resolvePath({
    cityId: CITY_ID,
    signal,
  })
  const searchResult = await harness.provider.search({
    query: '  高雄  ',
    signal,
  })

  assert.equal(path.length, 3)
  assert.equal(path[2].id, CITY_ID)
  assert.equal(Object.isFrozen(path), true)
  assert.equal(path.every(Object.isFrozen), true)
  assert.deepEqual(Object.keys(searchResult).sort(), ['hasMore', 'paths'])
  assert.equal(Object.isFrozen(searchResult), true)
  assert.equal(Object.isFrozen(searchResult.paths), true)
  assert.equal(Object.isFrozen(searchResult.paths[0]), true)
  assert.equal(searchResult.paths[0]?.[2].name, '高雄市')

  harness.dispose()
})

test('search 拒绝 items 超过声明 limit 的畸形成功响应', async () => {
  const harness = createHarness({
    dataSource: createDataSource({
      search: async () => ({
        hasMore: true,
        items: [
          { cityId: CITY_ID, path: rawPath().path },
          { cityId: CITY_ID, path: rawPath().path },
        ],
        limit: 1,
      }),
    }),
  })

  await assert.rejects(
    harness.provider.search({
      query: '高雄',
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof RegionSelectorResponseError
      && error.code === 'REGION_SELECTOR_RESPONSE_INVALID',
  )

  harness.dispose()
})

test('缓存 key 包含 identity 与规范化参数，TTL 固定 300000ms 且只缓存成功结果', async () => {
  let now = 10_000
  const calls: Array<{ kind: string, value: string | null }> = []
  let shouldFail = true
  const dataSource = createDataSource({
    getPath: async (cityId) => {
      calls.push({ kind: 'path', value: cityId })
      return rawPath(cityId)
    },
    listOptions: async (parentId) => {
      calls.push({ kind: 'options', value: parentId })
      if (shouldFail) {
        shouldFail = false
        throw new Error('temporary')
      }
      return [rawNode('COUNTRY_REGION')]
    },
    search: async (query) => {
      calls.push({ kind: 'search', value: query })
      return {
        hasMore: false,
        items: [{ cityId: CITY_ID, path: rawPath().path }],
        limit: 50,
      }
    },
  })
  const harness = createHarness({
    dataSource,
    now: () => now,
  })
  const signal = new AbortController().signal

  assert.equal(REGION_SELECTOR_CACHE_TTL_MS, 300_000)
  await assert.rejects(
    harness.provider.listChildren({ parentId: null, signal }),
    /temporary/u,
  )
  await harness.provider.listChildren({ parentId: null, signal })
  await harness.provider.listChildren({ parentId: null, signal })
  assert.equal(
    calls.filter(call => call.kind === 'options').length,
    2,
    'failure 不能缓存，随后成功结果应缓存',
  )

  await harness.provider.search({ query: '  İSTANBUL\u3000', signal })
  await harness.provider.search({ query: 'i\u0307stanbul', signal })
  assert.deepEqual(
    calls.filter(call => call.kind === 'search'),
    [{ kind: 'search', value: 'i\u0307stanbul' }],
  )

  await harness.provider.resolvePath({ cityId: CITY_ID, signal })
  now += REGION_SELECTOR_CACHE_TTL_MS - 1
  await harness.provider.resolvePath({ cityId: CITY_ID, signal })
  assert.equal(calls.filter(call => call.kind === 'path').length, 1)

  now += 1
  await harness.provider.resolvePath({ cityId: CITY_ID, signal })
  assert.equal(calls.filter(call => call.kind === 'path').length, 2)

  harness.setIdentity({
    authEpoch: 8,
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  harness.setAuthController(new AbortController())
  await harness.provider.resolvePath({ cityId: CITY_ID, signal })
  assert.equal(calls.filter(call => call.kind === 'path').length, 3)

  harness.dispose()
})

test('相同 key 合并底层请求，单个消费者取消不影响其余消费者', async () => {
  const request = deferred<unknown>()
  let calls = 0
  let underlyingSignal: AbortSignal | undefined
  const harness = createHarness({
    dataSource: createDataSource({
      listOptions: async (_parentId, signal) => {
        calls += 1
        underlyingSignal = signal
        return request.promise
      },
    }),
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = harness.provider.listChildren({
    parentId: null,
    signal: firstController.signal,
  })
  const second = harness.provider.listChildren({
    parentId: null,
    signal: secondController.signal,
  })

  await Promise.resolve()
  assert.equal(calls, 1)

  firstController.abort()
  await assert.rejects(first, { name: 'AbortError' })
  assert.equal(underlyingSignal?.aborted, false)

  request.resolve([rawNode('COUNTRY_REGION')])
  assert.equal((await second)[0]?.id, COUNTRY_ID)

  harness.dispose()
})

test('全部消费者取消时中止底层请求，后续消费者创建全新请求', async () => {
  const signals: AbortSignal[] = []
  const requests: Deferred<unknown>[] = []
  const harness = createHarness({
    dataSource: createDataSource({
      listOptions: async (_parentId, signal) => {
        signals.push(signal)
        const request = deferred<unknown>()
        requests.push(request)
        return request.promise
      },
    }),
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = harness.provider.listChildren({
    parentId: null,
    signal: firstController.signal,
  })
  const second = harness.provider.listChildren({
    parentId: null,
    signal: secondController.signal,
  })
  await Promise.resolve()

  firstController.abort()
  secondController.abort()
  await Promise.all([
    assert.rejects(first, { name: 'AbortError' }),
    assert.rejects(second, { name: 'AbortError' }),
  ])
  assert.equal(signals[0]?.aborted, true)

  const third = harness.provider.listChildren({
    parentId: null,
    signal: new AbortController().signal,
  })
  await Promise.resolve()
  assert.equal(signals.length, 2)
  requests[1]?.resolve([rawNode('COUNTRY_REGION')])
  assert.equal((await third)[0]?.name, '中国')

  // 被取消且忽略 signal 的旧请求迟到完成也不得污染新请求或形成未处理拒绝。
  requests[0]?.resolve([rawNode('COUNTRY_REGION', { name: '旧数据' })])
  await Promise.resolve()

  harness.dispose()
})

test('auth signal 与 identity/generation 阻断迟到响应回写并通知订阅者', async () => {
  const firstRequest = deferred<unknown>()
  let calls = 0
  const firstAuth = new AbortController()
  const harness = createHarness({
    authController: firstAuth,
    dataSource: createDataSource({
      getPath: async (cityId) => {
        calls += 1
        if (calls === 1) {
          return firstRequest.promise
        }
        return rawPath(cityId)
      },
    }),
  })
  let invalidations = 0
  const unsubscribe = harness.provider.subscribeInvalidation?.(() => {
    invalidations += 1
  })

  const stale = harness.provider.resolvePath({
    cityId: CITY_ID,
    signal: new AbortController().signal,
  })
  await Promise.resolve()
  firstAuth.abort()

  await assert.rejects(stale, { name: 'AbortError' })
  assert.equal(invalidations, 1)

  firstRequest.resolve(rawPath())
  await Promise.resolve()

  harness.setIdentity({
    authEpoch: 8,
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  harness.setAuthController(new AbortController())
  const fresh = await harness.provider.resolvePath({
    cityId: CITY_ID,
    signal: new AbortController().signal,
  })
  assert.equal(fresh[2].id, CITY_ID)
  assert.equal(calls, 2, '迟到响应不得写入新 identity 的缓存')

  unsubscribe?.()
  harness.invalidate({ broadcast: false })
  assert.equal(invalidations, 2, 'unsubscribe 后不再收到失效通知')
  harness.dispose()
})

test('identity 或 auth signal 静默替换时，完成门禁仍拒绝旧响应', async () => {
  const firstRequest = deferred<unknown>()
  let calls = 0
  const harness = createHarness({
    dataSource: createDataSource({
      getPath: async (cityId) => {
        calls += 1
        return calls === 1 ? firstRequest.promise : rawPath(cityId)
      },
    }),
  })
  const stale = harness.provider.resolvePath({
    cityId: CITY_ID,
    signal: new AbortController().signal,
  })
  await Promise.resolve()

  harness.setIdentity({
    authEpoch: 9,
    userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  })
  harness.setAuthController(new AbortController())
  firstRequest.resolve(rawPath())
  await assert.rejects(stale, { name: 'AbortError' })

  await harness.provider.resolvePath({
    cityId: CITY_ID,
    signal: new AbortController().signal,
  })
  assert.equal(calls, 2)

  harness.dispose()
})

test('身份切换通知期间的订阅者重取使用新上下文且不递归失效', async () => {
  let calls = 0
  const harness = createHarness({
    dataSource: createDataSource({
      getPath: async (cityId) => {
        calls += 1
        return rawPath(cityId)
      },
    }),
  })
  let invalidations = 0
  let reentrantRequest: Promise<unknown> | null = null
  harness.provider.subscribeInvalidation?.(() => {
    invalidations += 1
    /*
     * 真实组件收到身份失效后会立即恢复已有 CITY 的 path。上限只用于让旧实现
     * 稳定失败而不耗尽 Node 调用栈；正确实现只会进入一次。
     */
    if (invalidations <= 4) {
      reentrantRequest = harness.provider.resolvePath({
        cityId: CITY_ID,
        signal: new AbortController().signal,
      })
    }
  })

  harness.setIdentity({
    authEpoch: 8,
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  harness.setAuthController(new AbortController())
  const initiatingRequest = harness.provider.resolvePath({
    cityId: CITY_ID,
    signal: new AbortController().signal,
  })

  await initiatingRequest
  assert.notEqual(reentrantRequest, null)
  await reentrantRequest
  assert.equal(invalidations, 1)
  assert.equal(calls, 1, '同一新身份的重入与发起请求应共享 in-flight')

  harness.dispose()
})

test('BroadcastChannel 只发送 exact 失效消息，收到消息只本地失效且不回广播', async () => {
  const channel = createFakeChannel()
  const channelNames: string[] = []
  let calls = 0
  const harness = createHarness({
    channelFactory: (name) => {
      channelNames.push(name)
      return channel
    },
    dataSource: createDataSource({
      listOptions: async () => {
        calls += 1
        return [rawNode('COUNTRY_REGION')]
      },
    }),
  })
  const signal = new AbortController().signal
  let invalidations = 0
  harness.provider.subscribeInvalidation?.(() => {
    invalidations += 1
  })

  await harness.provider.listChildren({ parentId: null, signal })
  harness.invalidate({ broadcast: true })
  assert.deepEqual(channelNames, ['qianshu-regions-v1'])
  assert.deepEqual(channel.posted, [{ type: 'REGIONS_CHANGED' }])
  assert.deepEqual(Object.keys(channel.posted[0] as object), ['type'])
  assert.equal(invalidations, 1)

  await harness.provider.listChildren({ parentId: null, signal })
  assert.equal(calls, 2)

  channel.onmessage?.({
    data: { type: 'REGIONS_CHANGED' },
  } as MessageEvent<unknown>)
  assert.equal(invalidations, 2)
  assert.equal(channel.posted.length, 1, 'incoming message 不得重播')

  await harness.provider.listChildren({ parentId: null, signal })
  assert.equal(calls, 3)

  channel.onmessage?.({
    data: {
      leakedRegionData: rawPath(),
      type: 'REGIONS_CHANGED',
    },
  } as MessageEvent<unknown>)
  assert.equal(invalidations, 2, '非 exact message 必须忽略')

  harness.dispose()
  assert.equal(channel.closed, true)
  assert.equal(channel.onmessage, null)
})

test('初始身份上下文无效时不创建 BroadcastChannel 资源', () => {
  const channel = createFakeChannel()
  let channelFactoryCalls = 0

  assert.throws(
    () => createRegionSelectorProvider({
      channelFactory: () => {
        channelFactoryCalls += 1
        return channel
      },
      dataSource: createDataSource(),
      getAuthSignal: () => new AbortController().signal,
      getIdentity: () => {
        throw new Error('identity unavailable')
      },
      now: () => 0,
    }),
    /identity unavailable/u,
  )

  assert.equal(channelFactoryCalls, 0)
  assert.equal(channel.closed, false)
})

test('默认 controller 显式安装，全局 invalidation 未安装时 no-op', () => {
  assert.doesNotThrow(() => {
    invalidateRegionSelectorCache({ broadcast: true })
  })

  const firstChannel = createFakeChannel()
  const first = installDefaultRegionSelectorProvider({
    channelFactory: () => firstChannel,
    dataSource: createDataSource(),
    getAuthSignal: () => new AbortController().signal,
    getIdentity: () => ({ authEpoch: 1, userId: null }),
    now: () => 0,
  })
  invalidateRegionSelectorCache({ broadcast: true })
  assert.deepEqual(firstChannel.posted, [{ type: 'REGIONS_CHANGED' }])

  const secondChannel = createFakeChannel()
  const second = installDefaultRegionSelectorProvider({
    channelFactory: () => secondChannel,
    dataSource: createDataSource(),
    getAuthSignal: () => new AbortController().signal,
    getIdentity: () => ({ authEpoch: 2, userId: null }),
    now: () => 0,
  })
  assert.equal(firstChannel.closed, true, '只能保留一个默认 controller')

  invalidateRegionSelectorCache({ broadcast: true })
  assert.deepEqual(secondChannel.posted, [{ type: 'REGIONS_CHANGED' }])

  first.dispose()
  invalidateRegionSelectorCache({ broadcast: true })
  assert.equal(
    secondChannel.posted.length,
    2,
    '旧 controller 的重复 dispose 不能卸载新默认实例',
  )

  second.dispose()
  assert.equal(secondChannel.closed, true)
  assert.doesNotThrow(() => {
    invalidateRegionSelectorCache({ broadcast: true })
  })
})

test('Provider 边界不导入 API、Store 或持久化能力', () => {
  const providerSource = readFileSync(
    new URL(
      '../../src/components/business/QsRegionSelector/provider.ts',
      import.meta.url,
    ),
    'utf8',
  )
  const typesSource = readFileSync(
    new URL(
      '../../src/components/business/QsRegionSelector/types.ts',
      import.meta.url,
    ),
    'utf8',
  )
  const combined = `${providerSource}\n${typesSource}`

  assert.doesNotMatch(combined, /from ['"][^'"]*\/api[/'"]/u)
  assert.doesNotMatch(combined, /from ['"][^'"]*\/store[/'"]/u)
  assert.doesNotMatch(
    combined,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/u,
  )
  assert.doesNotMatch(combined, /new BroadcastChannel/u)
})

test('正式应用在 Router 安装后同步挂载，并仅在地区请求时动态装载 API', () => {
  const mainSource = readFileSync(
    new URL('../../src/main.ts', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(
    mainSource,
    /import regionsApi from ['"]@\/api\/modules\/regions['"]/u,
  )
  assert.match(
    mainSource,
    /await import\(['"]@\/api\/modules\/regions['"]\)/u,
  )
  assert.doesNotMatch(mainSource, /await router\.isReady\(\)/u)
  assert.match(
    mainSource,
    /installDefaultRegionSelectorProvider/u,
  )
  assert.match(mainSource, /regionSelectorProviderKey/u)
  assert.match(mainSource, /useAppAccountStore/u)

  const piniaInstallIndex = mainSource.indexOf('app.use(pinia)')
  const routerInstallIndex = mainSource.indexOf('app.use(router)')
  const regionsApiImportIndex = mainSource.indexOf(
    'await import(\'@/api/modules/regions\')',
  )
  const accountStoreIndex = mainSource.indexOf('useAppAccountStore(pinia)')
  const providerInstallIndex = mainSource.indexOf(
    'installDefaultRegionSelectorProvider({',
  )
  const providerInjectionIndex = mainSource.indexOf(
    'app.provide(regionSelectorProviderKey',
  )

  assert.ok(piniaInstallIndex >= 0)
  assert.ok(routerInstallIndex > piniaInstallIndex)
  assert.ok(accountStoreIndex > routerInstallIndex)
  assert.ok(providerInstallIndex > accountStoreIndex)
  assert.ok(regionsApiImportIndex > providerInstallIndex)
  assert.ok(providerInjectionIndex > providerInstallIndex)
  assert.ok(mainSource.indexOf('app.mount(\'#app\')') > providerInjectionIndex)
  assert.match(
    mainSource,
    /authEpoch:\s*appAccountStore\.authEpoch/u,
  )
  assert.match(
    mainSource,
    /userId:\s*appAccountStore\.authContext\?\.user\.id \?\? null/u,
  )
  assert.match(
    mainSource,
    /getAuthSignal:\s*\(\) => appAccountStore\.getAuthSignal\(\)/u,
  )
  assert.match(
    mainSource,
    /regionsApi\.selection\s*\.listOptions\(parentId, signal\)[\s\S]*?regionsApi\.selection\s*\.getPath\(cityId, signal\)[\s\S]*?regionsApi\.selection\s*\.search\(query, signal\)/u,
  )
  assert.match(
    mainSource,
    /app\.provide\(regionSelectorProviderKey,\s*regionSelectorController\.provider\)/u,
  )
})
