import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Catalog adapter 是无 DOM 的纯 TypeScript 契约。
import test from 'node:test'

import { toCurrencyDescriptors } from '../../src/currency-catalog/adapter'
import {
  installDefaultCurrencyCatalogProvider,
  invalidateCurrencyCatalogCache,
} from '../../src/currency-catalog/default-provider'
import { currencyCatalogProviderKey } from '../../src/currency-catalog/injection'

const CNY_ID = '00000000-0000-4000-8000-000000001001'
const TWD_ID = '00000000-0000-4000-8000-000000001002'

function validCatalog() {
  return [
    {
      code: 'CNY',
      enabled: true,
      englishName: 'Chinese Yuan',
      id: CNY_ID,
      isBase: true,
      minorUnit: 2,
      name: '人民币',
      sortOrder: 10,
      symbol: '¥',
    },
    {
      code: 'TWD',
      enabled: false,
      englishName: 'New Taiwan Dollar',
      id: TWD_ID,
      isBase: false,
      minorUnit: 2,
      name: '新台币',
      sortOrder: 20,
      symbol: 'NT$',
    },
  ] as const
}

test('catalog adapter 只映射金额公共字段并保留停用货币', () => {
  const descriptors = toCurrencyDescriptors(validCatalog())

  assert.deepEqual(descriptors, [
    {
      code: 'CNY',
      enabled: true,
      minorUnit: 2,
      name: '人民币',
      symbol: '¥',
    },
    {
      code: 'TWD',
      enabled: false,
      minorUnit: 2,
      name: '新台币',
      symbol: 'NT$',
    },
  ])
  assert.equal(Object.isFrozen(descriptors), true)
  assert.equal(descriptors.every(Object.isFrozen), true)
})

test('默认 Provider 是唯一应用实例，管理写成功可触发本地及跨标签失效', async () => {
  const posted: unknown[] = []
  let calls = 0
  const authController = new AbortController()
  const controller = installDefaultCurrencyCatalogProvider({
    channelFactory: () => ({
      close: () => undefined,
      onmessage: null,
      postMessage: message => posted.push(message),
    }),
    getAuthSignal: () => authController.signal,
    getIdentity: () => ({
      authEpoch: 1,
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }),
    loader: async () => {
      calls += 1
      return validCatalog()
    },
    now: () => 1_000,
  })

  await controller.provider.list({
    signal: new AbortController().signal,
  })
  invalidateCurrencyCatalogCache({ broadcast: true })
  await controller.provider.list({
    signal: new AbortController().signal,
  })

  assert.equal(calls, 2)
  assert.deepEqual(posted, [{ type: 'CURRENCY_CATALOG_CHANGED' }])
  assert.equal(
    currencyCatalogProviderKey.description,
    'CurrencyCatalogProvider',
  )

  controller.dispose()
  invalidateCurrencyCatalogCache({ broadcast: true })
  assert.equal(posted.length, 1)
})
