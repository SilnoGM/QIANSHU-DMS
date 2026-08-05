import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- Catalog 可信边界是无 DOM 的纯 TypeScript 模块。
import test from 'node:test'

import {
  cloneDictionaryCatalogBatchResponse,
  cloneDictionaryCatalogResponse,
  DictionaryCatalogResponseError,
} from '../../src/dictionary-catalog/validation'

function rawItem(
  value = 'ONLINE',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    effectiveEnabled: true,
    enabled: true,
    internalItemId: 'must-not-escape',
    label: '线上',
    sortOrder: 10,
    tone: 'PRIMARY',
    value,
    version: 7,
    ...overrides,
  }
}

function rawCatalog(
  code = 'sales.channel',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    code,
    enabled: true,
    internalTypeId: 'must-not-escape',
    items: [rawItem()],
    name: '销售渠道',
    version: 9,
    ...overrides,
  }
}

function expectInvalidResponse(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert.equal(error instanceof DictionaryCatalogResponseError, true)
    assert.deepEqual(
      {
        code: (error as DictionaryCatalogResponseError).code,
        message: (error as Error).message,
        name: (error as Error).name,
      },
      {
        code: 'DICTIONARY_CATALOG_RESPONSE_INVALID',
        message: '系统字典目录响应格式无效',
        name: 'DictionaryCatalogResponseError',
      },
    )
    assert.doesNotMatch(
      JSON.stringify(error),
      /must-not-(?:escape|leak|read)|internalTypeId|internalItemId/u,
    )
    assert.equal('cause' in (error as object), false)
    return true
  })
}

function cloneSingle(
  value: unknown,
  requestedCode = 'sales.channel',
) {
  return cloneDictionaryCatalogResponse(value, requestedCode)
}

test('单 Catalog 只复制领域白名单，并返回与原响应隔离的 deep-frozen 对象', () => {
  const raw = rawCatalog()
  Object.defineProperty(raw, 'ignoredGetter', {
    enumerable: true,
    get() {
      throw new Error('must-not-read-unknown-field')
    },
  })
  const rawItems = raw.items as Record<string, unknown>[]
  const result = cloneSingle(raw, '  Sales.Channel\u0085')

  assert.deepEqual(result, {
    code: 'sales.channel',
    enabled: true,
    items: [{
      effectiveEnabled: true,
      enabled: true,
      label: '线上',
      sortOrder: 10,
      tone: 'PRIMARY',
      value: 'ONLINE',
    }],
    name: '销售渠道',
  })
  assert.equal('internalTypeId' in result, false)
  assert.equal('internalItemId' in result.items[0]!, false)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.items), true)
  assert.equal(result.items.every(Object.isFrozen), true)

  raw.name = '被污染的名称'
  rawItems[0]!.label = '被污染的条目'
  assert.equal(result.name, '销售渠道')
  assert.equal(result.items[0]?.label, '线上')
  assert.throws(() => {
    Object.assign(result.items[0] as object, { label: '无法修改' })
  }, TypeError)
})

test('单 Catalog 接受字段与 Int32 的精确有效上界', () => {
  const code = `a.${'b'.repeat(62)}`
  const value = 'A'.repeat(64)
  const result = cloneSingle(
    rawCatalog(code, {
      items: [rawItem(value, {
        label: '签'.repeat(128),
        sortOrder: 2_147_483_647,
      })],
      name: '名'.repeat(128),
    }),
    code,
  )

  assert.equal(result.code.length, 64)
  assert.equal(result.name.length, 128)
  assert.equal(result.items[0]?.value.length, 64)
  assert.equal(result.items[0]?.label.length, 128)
  assert.equal(result.items[0]?.sortOrder, 2_147_483_647)
})

test('单 Catalog 拒绝非法字段、重复 value、tone 与 effectiveEnabled 关系漂移', async (t) => {
  const sparseItems: unknown[] = []
  sparseItems.length = 1
  const throwingName = rawCatalog()
  Object.defineProperty(throwingName, 'name', {
    enumerable: true,
    get() {
      throw new Error('must-not-leak-known-getter')
    },
  })
  const throwingPrototype = new Proxy(rawCatalog(), {
    getPrototypeOf() {
      throw new Error('must-not-leak-prototype-trap')
    },
  })
  const malformedCases: Array<{
    readonly name: string
    readonly response: unknown
  }> = [
    { name: '根节点不是 plain object', response: [] },
    { name: '根节点 prototype trap 抛错', response: throwingPrototype },
    {
      name: 'code 不是规范小写命名空间',
      response: rawCatalog('Sales.Channel'),
    },
    {
      name: 'code 包含非法标识字符',
      response: rawCatalog('sales-channel.mode'),
    },
    {
      name: 'code 超过 64 个 code point',
      response: rawCatalog(`a.${'b'.repeat(63)}`),
    },
    {
      name: '响应 code 与请求 code 不匹配',
      response: rawCatalog('fulfillment.mode'),
    },
    {
      name: 'name 是空白字符串',
      response: rawCatalog('sales.channel', { name: '　' }),
    },
    {
      name: 'name 超过 128 个 code point',
      response: rawCatalog('sales.channel', { name: '名'.repeat(129) }),
    },
    {
      name: 'name 不是 NFC 规范形态',
      response: rawCatalog('sales.channel', { name: 'e\u0301' }),
    },
    {
      name: '已知 name getter 抛错',
      response: throwingName,
    },
    {
      name: 'Type enabled 不是 boolean',
      response: rawCatalog('sales.channel', { enabled: 1 }),
    },
    {
      name: 'items 不是数组',
      response: rawCatalog('sales.channel', { items: {} }),
    },
    {
      name: 'items 是稀疏数组',
      response: rawCatalog('sales.channel', { items: sparseItems }),
    },
    {
      name: 'value 不是规范大写身份',
      response: rawCatalog('sales.channel', { items: [rawItem('online')] }),
    },
    {
      name: 'value 包含非法标识字符',
      response: rawCatalog('sales.channel', { items: [rawItem('ON/LINE')] }),
    },
    {
      name: 'value 超过 64 个 code point',
      response: rawCatalog('sales.channel', {
        items: [rawItem('A'.repeat(65))],
      }),
    },
    {
      name: 'value 重复',
      response: rawCatalog('sales.channel', {
        items: [rawItem('ONLINE'), rawItem('ONLINE')],
      }),
    },
    {
      name: 'label 是空白字符串',
      response: rawCatalog('sales.channel', {
        items: [rawItem('ONLINE', { label: '\u0085' })],
      }),
    },
    {
      name: 'tone 不在固定白名单',
      response: rawCatalog('sales.channel', {
        items: [rawItem('ONLINE', { tone: 'CUSTOM' })],
      }),
    },
    {
      name: 'Item enabled 不是 boolean',
      response: rawCatalog('sales.channel', {
        items: [rawItem('ONLINE', { enabled: 'true' })],
      }),
    },
    {
      name: 'effectiveEnabled 与 Type/Item enabled 不一致',
      response: rawCatalog('sales.channel', {
        enabled: false,
        items: [rawItem('ONLINE', { effectiveEnabled: true })],
      }),
    },
    {
      name: 'Type 启用但 Item 停用时 effectiveEnabled 仍不能为 true',
      response: rawCatalog('sales.channel', {
        items: [rawItem('ONLINE', {
          effectiveEnabled: true,
          enabled: false,
        })],
      }),
    },
    {
      name: 'sortOrder 不是非负安全整数',
      response: rawCatalog('sales.channel', {
        items: [rawItem('ONLINE', { sortOrder: 1.5 })],
      }),
    },
    {
      name: 'sortOrder 超过 Int32 上界',
      response: rawCatalog('sales.channel', {
        items: [rawItem('ONLINE', { sortOrder: 2_147_483_648 })],
      }),
    },
  ]

  for (const malformed of malformedCases) {
    await t.test(malformed.name, () => {
      expectInvalidResponse(() =>
        cloneSingle(malformed.response),
      )
    })
  }
})

test('Batch 白名单复制后保持请求相对顺序、完整分区并递归冻结', () => {
  const response = {
    dictionaries: [
      rawCatalog('sales.channel'),
      rawCatalog('fulfillment.mode', {
        items: [rawItem('PICKUP', {
          label: '自提',
          tone: 'INFO',
          value: 'PICKUP',
        })],
        name: '履约方式',
      }),
    ],
    internalBatchTrace: 'must-not-escape',
    missingCodes: ['shipment.priority'],
  }
  const result = cloneDictionaryCatalogBatchResponse(response, [
    '  Sales.Channel\u0085',
    'FULFILLMENT.MODE',
    'shipment.priority',
  ])

  assert.deepEqual(
    result.dictionaries.map(catalog => catalog.code),
    ['sales.channel', 'fulfillment.mode'],
  )
  assert.deepEqual(result.missingCodes, ['shipment.priority'])
  assert.equal('internalBatchTrace' in result, false)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.dictionaries), true)
  assert.equal(Object.isFrozen(result.missingCodes), true)
  assert.equal(result.dictionaries.every(Object.isFrozen), true)
  assert.equal(
    result.dictionaries.every(catalog => Object.isFrozen(catalog.items)),
    true,
  )
})

test('Batch 拒绝重复、交集、越界、缺失与响应顺序漂移', async (t) => {
  const sales = rawCatalog('sales.channel')
  const fulfillment = rawCatalog('fulfillment.mode')
  const requested = [
    'sales.channel',
    'fulfillment.mode',
    'shipment.priority',
  ] as const
  const malformedCases: Array<{
    readonly name: string
    readonly requestedCodes?: readonly string[]
    readonly response: unknown
  }> = [
    { name: '根节点不是 plain object', response: [] },
    {
      name: 'dictionaries 不是数组',
      response: { dictionaries: {}, missingCodes: requested },
    },
    {
      name: 'missingCodes 不是数组',
      response: { dictionaries: [], missingCodes: {} },
    },
    {
      name: 'Dictionary code 重复',
      response: {
        dictionaries: [sales, sales],
        missingCodes: ['fulfillment.mode', 'shipment.priority'],
      },
    },
    {
      name: 'missing code 重复',
      response: {
        dictionaries: [sales],
        missingCodes: [
          'fulfillment.mode',
          'fulfillment.mode',
          'shipment.priority',
        ],
      },
    },
    {
      name: 'Dictionary 与 missing 交集',
      response: {
        dictionaries: [sales, fulfillment],
        missingCodes: ['fulfillment.mode', 'shipment.priority'],
      },
    },
    {
      name: '返回未请求 code',
      response: {
        dictionaries: [sales, rawCatalog('unexpected.code')],
        missingCodes: ['fulfillment.mode', 'shipment.priority'],
      },
    },
    {
      name: '没有完整覆盖请求集合',
      response: {
        dictionaries: [sales],
        missingCodes: ['shipment.priority'],
      },
    },
    {
      name: 'Dictionary 顺序不遵守请求顺序',
      response: {
        dictionaries: [fulfillment, sales],
        missingCodes: ['shipment.priority'],
      },
    },
    {
      name: 'missingCodes 顺序不遵守请求顺序',
      requestedCodes: ['sales.channel', 'fulfillment.mode'],
      response: {
        dictionaries: [],
        missingCodes: ['fulfillment.mode', 'sales.channel'],
      },
    },
    {
      name: 'missing code 不是规范命名空间',
      response: {
        dictionaries: [sales, fulfillment],
        missingCodes: ['Shipment.Priority'],
      },
    },
    {
      name: '请求 code 规范化后重复',
      requestedCodes: ['Sales.Channel', ' sales.channel '],
      response: { dictionaries: [sales], missingCodes: [] },
    },
    {
      name: '请求列表为空',
      requestedCodes: [],
      response: { dictionaries: [], missingCodes: [] },
    },
    {
      name: '请求列表超过 20 项',
      requestedCodes: Array.from(
        { length: 21 },
        (_, index) => `scope${index}.value`,
      ),
      response: { dictionaries: [], missingCodes: [] },
    },
  ]

  for (const malformed of malformedCases) {
    await t.test(malformed.name, () => {
      expectInvalidResponse(() =>
        cloneDictionaryCatalogBatchResponse(
          malformed.response,
          malformed.requestedCodes ?? requested,
        ),
      )
    })
  }
})

test('Catalog Domain 与校验层不依赖 Axios、API、Store 或 generated DTO', () => {
  const typesSource = readFileSync(
    new URL('../../src/dictionary-catalog/types.ts', import.meta.url),
    'utf8',
  )
  const validationSource = readFileSync(
    new URL('../../src/dictionary-catalog/validation.ts', import.meta.url),
    'utf8',
  )
  const sources = [typesSource, validationSource]

  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /from\s+['"][^'"]*(?:axios|api|generated|store)[^'"]*['"]/iu,
    )
    assert.doesNotMatch(source, /\b(?:pinia|useApp\w*Store)\b/u)
  }
  assert.doesNotMatch(
    typesSource,
    /\b(?:id|description|version|createdAt|updatedAt)\s*:/u,
  )
})
