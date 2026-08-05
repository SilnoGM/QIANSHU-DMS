import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- Catalog 默认实例是无 DOM 的应用组装契约。
import test from 'node:test'

import {
  installDefaultDictionaryCatalogProvider,
  invalidateDictionaryCatalogCache,
} from '../../src/dictionary-catalog/default-provider'
import { dictionaryCatalogProviderKey } from '../../src/dictionary-catalog/injection'

interface FakeBroadcastChannel {
  readonly posted: unknown[]
  closeCalls: number
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: unknown) => void
  close: () => void
}

function createFakeBroadcastChannel(): FakeBroadcastChannel {
  return {
    closeCalls: 0,
    onmessage: null,
    posted: [],
    close() {
      this.closeCalls += 1
    },
    postMessage(message) {
      this.posted.push(message)
    },
  }
}

function createIdentitySource(authEpoch: number, userId: string) {
  let subscribeCalls = 0
  let unsubscribeCalls = 0

  return {
    get subscribeCalls() {
      return subscribeCalls
    },
    get unsubscribeCalls() {
      return unsubscribeCalls
    },
    getSnapshot: () => ({ authEpoch, userId }),
    subscribe: () => {
      subscribeCalls += 1
      let active = true
      return () => {
        if (!active) {
          return
        }
        active = false
        unsubscribeCalls += 1
      }
    },
  }
}

function readCatalogSource(fileName: string): string {
  return readFileSync(
    new URL(`../../src/dictionary-catalog/${fileName}`, import.meta.url),
    'utf8',
  )
}

test('默认 Provider 支持替换与幂等 dispose，未安装时精确失效为 no-op', () => {
  assert.doesNotThrow(() => {
    invalidateDictionaryCatalogCache({
      broadcast: true,
      code: 'sales.status',
    })
  })

  const firstChannel = createFakeBroadcastChannel()
  const firstIdentitySource = createIdentitySource(
    1,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  )
  let loaderCalls = 0
  const first = installDefaultDictionaryCatalogProvider({
    createBroadcastChannel: () =>
      firstChannel as unknown as BroadcastChannel,
    identitySource: firstIdentitySource,
    loader: {
      batch: async () => {
        loaderCalls += 1
        return { dictionaries: [], missingCodes: [] }
      },
      get: async () => {
        loaderCalls += 1
        return null
      },
    },
    now: () => 1_000,
  })

  assert.equal(firstIdentitySource.subscribeCalls, 1)
  assert.equal(loaderCalls, 0, '安装时不得登录预取 Catalog')
  invalidateDictionaryCatalogCache({
    broadcast: true,
    code: 'sales.status',
  })
  assert.deepEqual(firstChannel.posted, [{
    code: 'sales.status',
    type: 'DICTIONARY_CATALOG_CHANGED',
  }])

  const secondChannel = createFakeBroadcastChannel()
  const secondIdentitySource = createIdentitySource(
    2,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  )
  const second = installDefaultDictionaryCatalogProvider({
    createBroadcastChannel: () =>
      secondChannel as unknown as BroadcastChannel,
    identitySource: secondIdentitySource,
    loader: {
      batch: async () => ({ dictionaries: [], missingCodes: [] }),
      get: async () => null,
    },
    now: () => 2_000,
  })

  assert.equal(firstChannel.closeCalls, 1, '只能保留一个默认 controller')
  assert.equal(firstIdentitySource.unsubscribeCalls, 1)
  assert.equal(secondIdentitySource.subscribeCalls, 1)

  first.dispose()
  first.dispose()
  invalidateDictionaryCatalogCache({
    broadcast: true,
    code: 'orders.status',
  })
  assert.deepEqual(secondChannel.posted, [{
    code: 'orders.status',
    type: 'DICTIONARY_CATALOG_CHANGED',
  }], '旧 controller 重复 dispose 不得卸载新默认实例')

  second.dispose()
  second.dispose()
  assert.equal(secondChannel.closeCalls, 1)
  assert.equal(secondIdentitySource.unsubscribeCalls, 1)
  assert.doesNotThrow(() => {
    invalidateDictionaryCatalogCache({
      broadcast: true,
      code: 'orders.status',
    })
  })
  assert.equal(secondChannel.posted.length, 1)
})

test('新默认 Provider 初始化失败时保留已经可用的旧实例', () => {
  const channel = createFakeBroadcastChannel()
  const identitySource = createIdentitySource(
    1,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  )
  const installed = installDefaultDictionaryCatalogProvider({
    createBroadcastChannel: () => channel as unknown as BroadcastChannel,
    identitySource,
    loader: {
      batch: async () => ({ dictionaries: [], missingCodes: [] }),
      get: async () => null,
    },
  })

  assert.throws(() => {
    installDefaultDictionaryCatalogProvider({
      identitySource: {
        getSnapshot: () => {
          throw new Error('identity unavailable')
        },
        subscribe: () => () => undefined,
      },
      loader: {
        batch: async () => ({ dictionaries: [], missingCodes: [] }),
        get: async () => null,
      },
    })
  }, /identity unavailable/u)

  invalidateDictionaryCatalogCache({
    broadcast: true,
    code: 'sales.status',
  })
  assert.deepEqual(channel.posted, [{
    code: 'sales.status',
    type: 'DICTIONARY_CATALOG_CHANGED',
  }])
  assert.equal(channel.closeCalls, 0)
  assert.equal(identitySource.unsubscribeCalls, 0)

  installed.dispose()
  assert.equal(channel.closeCalls, 1)
  assert.equal(identitySource.unsubscribeCalls, 1)
})

test('Vue InjectionKey 只暴露 DictionaryCatalogProvider 中立契约', () => {
  const injectionSource = readCatalogSource('injection.ts')

  assert.equal(
    dictionaryCatalogProviderKey.description,
    'DictionaryCatalogProvider',
  )
  assert.match(
    injectionSource,
    /InjectionKey<DictionaryCatalogProvider>/u,
  )
  assert.doesNotMatch(injectionSource, /DictionaryCatalogProviderController/u)
  assert.doesNotMatch(injectionSource, /from ['"][^'"]*(?:\/api|\/store|\/router|\/views)[/'"]/u)
})

test('正式应用在 Pinia/Router 后、mount 前同步安装并注入默认 Provider', () => {
  const mainSource = readFileSync(
    new URL('../../src/main.ts', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(
    mainSource,
    /import dictionariesApi from ['"]@\/api\/modules\/dictionaries['"]/u,
  )
  assert.doesNotMatch(
    mainSource,
    /\bimport\s+(?!\()[\s\S]{0,160}\bfrom\s*['"]@\/api\/modules\/dictionaries['"]/u,
  )
  assert.match(
    mainSource,
    /await import\(['"]@\/api\/modules\/dictionaries['"]\)/u,
  )
  assert.doesNotMatch(mainSource, /await router\.isReady\(\)/u)
  assert.doesNotMatch(
    mainSource,
    /dictionaryCatalogController\.provider\.prefetch\(/u,
  )
  assert.doesNotMatch(mainSource, /\bprefetch\s*\(/u)

  const piniaInstallIndex = mainSource.indexOf('app.use(pinia)')
  const routerInstallIndex = mainSource.indexOf('app.use(router)')
  const accountStoreIndex = mainSource.indexOf('useAppAccountStore(pinia)')
  const identitySourceIndex = mainSource.indexOf(
    'dictionaryCatalogIdentitySource',
  )
  const providerInstallIndex = mainSource.indexOf(
    'installDefaultDictionaryCatalogProvider({',
  )
  const dictionariesApiImportIndex = mainSource.indexOf(
    'await import(\'@/api/modules/dictionaries\')',
  )
  const providerInjectionIndex = mainSource.indexOf(
    'app.provide(dictionaryCatalogProviderKey',
  )
  const mountIndex = mainSource.indexOf('app.mount(\'#app\')')

  assert.ok(piniaInstallIndex >= 0)
  assert.ok(routerInstallIndex > piniaInstallIndex)
  assert.ok(accountStoreIndex > routerInstallIndex)
  assert.ok(identitySourceIndex > accountStoreIndex)
  assert.ok(providerInstallIndex > identitySourceIndex)
  assert.ok(dictionariesApiImportIndex > providerInstallIndex)
  assert.ok(providerInjectionIndex > providerInstallIndex)
  assert.ok(mountIndex > providerInjectionIndex)

  assert.match(
    mainSource,
    /getSnapshot:\s*\(\)\s*=>\s*\(\{[\s\S]{0,180}authEpoch:\s*appAccountStore\.authEpoch[\s\S]{0,180}userId:\s*appAccountStore\.authContext\?\.user\.id\s*\?\?\s*null[\s\S]{0,40}\}\)/u,
  )
  assert.match(
    mainSource,
    /subscribe:[\s\S]{0,160}\bwatch\([\s\S]{0,500}\blistener\(/u,
  )
  assert.match(
    mainSource,
    /subscribe:[\s\S]{0,600}\{ flush: ['"]sync['"] \}/u,
  )
  assert.match(
    mainSource,
    /identitySource:\s*dictionaryCatalogIdentitySource/u,
  )
  assert.match(
    mainSource,
    /createBroadcastChannel:\s*typeof BroadcastChannel === 'undefined'[\s\S]{0,100}name => new BroadcastChannel\(name\)/u,
  )
  assert.match(
    mainSource,
    /dictionariesApi\.catalog\s*\.get\(code,\s*signal\)[\s\S]{0,160}response\.data/u,
  )
  assert.match(
    mainSource,
    /dictionariesApi\.catalog\s*\.batch\(codes,\s*signal\)[\s\S]{0,160}response\.data/u,
  )
  assert.match(
    mainSource,
    /app\.provide\(dictionaryCatalogProviderKey,\s*dictionaryCatalogController\.provider\)/u,
  )
})

test('Catalog 组装边界不依赖页面、路由、Pinia 模块或持久化能力', () => {
  const catalogSource = [
    'default-provider.ts',
    'injection.ts',
    'options.ts',
    'provider.ts',
    'types.ts',
    'use-dictionary-catalog.ts',
  ].map(readCatalogSource).join('\n')
  const storeModuleFiles = readdirSync(
    new URL('../../src/store/modules', import.meta.url),
    { encoding: 'utf8', recursive: true },
  )

  assert.doesNotMatch(
    catalogSource,
    /from ['"][^'"]*(?:\/api|\/store|\/router|\/views)[/'"]/u,
  )
  assert.doesNotMatch(catalogSource, /\bdefineStore\s*\(/u)
  assert.doesNotMatch(
    catalogSource,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/u,
  )
  assert.equal(
    storeModuleFiles.some(fileName => /dictionary.*catalog/iu.test(fileName)),
    false,
  )
})
