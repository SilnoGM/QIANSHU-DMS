import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createDictionariesApi } from '../../src/api/modules/dictionaries'

interface Call {
  method: 'get' | 'patch' | 'post'
  url: string
  data?: unknown
  config?: unknown
}

function createClientRecorder(): {
  calls: Call[]
  client: AxiosInstance
  response: object
} {
  const calls: Call[] = []
  const response = Object.freeze({
    config: {},
    data: {},
    headers: {},
    status: 200,
    statusText: 'OK',
  })
  const pendingResponse = Promise.resolve(response)
  const client = {
    get(url: string, config?: unknown) {
      calls.push({ method: 'get', url, config })
      return pendingResponse
    },
    patch(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'patch', url, data, config })
      return pendingResponse
    },
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'post', url, data, config })
      return pendingResponse
    },
  } as unknown as AxiosInstance

  return { calls, client, response }
}

test('Catalog 与管理读取保留 AxiosResponse、编码 path 并固定本地呈错和 AbortSignal', async () => {
  const fixture = createClientRecorder()
  const api = createDictionariesApi(fixture.client)
  const signals = Array.from(
    { length: 6 },
    () => new AbortController().signal,
  )
  const typeQuery = {
    page: 2,
    pageSize: 20,
    query: '渠道',
    sortBy: 'updatedAt' as const,
    sortOrder: 'desc' as const,
    status: 'DISABLED' as const,
  }
  const itemQuery = {
    page: 1,
    pageSize: 50,
    query: '线上',
    sortBy: 'value' as const,
    sortOrder: 'asc' as const,
    status: 'ENABLED' as const,
  }

  const responses = [
    await api.catalog.get('sales/channel with spaces', signals[0]!),
    await api.catalog.batch(
      ['sales.channel', 'fulfillment.mode'],
      signals[1]!,
    ),
    await api.types.list(typeQuery, signals[2]!),
    await api.types.get('type/id with spaces', signals[3]!),
    await api.items.list('type/id with spaces', itemQuery, signals[4]!),
    await api.items.get(
      'type/id with spaces',
      'item/id with spaces',
      signals[5]!,
    ),
  ]

  assert.equal(
    responses.every(response => response === fixture.response),
    true,
  )
  assert.deepEqual(
    fixture.calls.map(({ method, url }) => ({ method, url })),
    [
      {
        method: 'get',
        url: 'dictionary-catalog/sales%2Fchannel%20with%20spaces',
      },
      { method: 'get', url: 'dictionary-catalog' },
      { method: 'get', url: 'dictionary-types' },
      {
        method: 'get',
        url: 'dictionary-types/type%2Fid%20with%20spaces',
      },
      {
        method: 'get',
        url: 'dictionary-types/type%2Fid%20with%20spaces/items',
      },
      {
        method: 'get',
        url: 'dictionary-types/type%2Fid%20with%20spaces/items/item%2Fid%20with%20spaces',
      },
    ],
  )
  assert.deepEqual(fixture.calls[0]?.config, {
    errorPresentation: 'local',
    signal: signals[0],
  })

  const batchConfig = fixture.calls[1]?.config as
    | Record<string, unknown>
    | undefined
  assert.ok(batchConfig)
  assert.ok(batchConfig.params instanceof URLSearchParams)
  assert.equal(
    batchConfig.params.toString(),
    'codes=sales.channel&codes=fulfillment.mode',
  )
  assert.deepEqual(
    {
      errorPresentation: batchConfig.errorPresentation,
      signal: batchConfig.signal,
    },
    {
      errorPresentation: 'local',
      signal: signals[1],
    },
  )
  assert.deepEqual(fixture.calls[2]?.config, {
    errorPresentation: 'local',
    params: typeQuery,
    signal: signals[2],
  })
  assert.deepEqual(fixture.calls[3]?.config, {
    errorPresentation: 'local',
    signal: signals[3],
  })
  assert.deepEqual(fixture.calls[4]?.config, {
    errorPresentation: 'local',
    params: itemQuery,
    signal: signals[4],
  })
  assert.deepEqual(fixture.calls[5]?.config, {
    errorPresentation: 'local',
    signal: signals[5],
  })
})

test('Type 与 Item 的八个 Mutation 使用 generated payload 且一律禁止自动重试', async () => {
  const fixture = createClientRecorder()
  const api = createDictionariesApi(fixture.client)
  const createTypePayload = {
    code: 'sales.channel',
    description: null,
    name: '销售渠道',
    sortOrder: 10,
  }
  const updateTypePayload = {
    description: '订单来源渠道',
    expectedVersion: 3,
    name: '订单渠道',
    sortOrder: 20,
  }
  const typeStatusPayload = { expectedVersion: 4 }
  const createItemPayload = {
    description: null,
    label: '线上',
    sortOrder: 10,
    tone: 'PRIMARY' as const,
    value: 'ONLINE',
  }
  const updateItemPayload = {
    description: '在线渠道',
    expectedVersion: 5,
    label: '线上渠道',
    sortOrder: 20,
    tone: 'SUCCESS' as const,
  }
  const itemStatusPayload = { expectedVersion: 6 }

  const responses = [
    await api.types.create(createTypePayload),
    await api.types.update('type/id', updateTypePayload),
    await api.types.enable('type/id', typeStatusPayload),
    await api.types.disable('type/id', typeStatusPayload),
    await api.items.create('type/id', createItemPayload),
    await api.items.update('type/id', 'item/id', updateItemPayload),
    await api.items.enable('type/id', 'item/id', itemStatusPayload),
    await api.items.disable('type/id', 'item/id', itemStatusPayload),
  ]

  assert.equal(
    responses.every(response => response === fixture.response),
    true,
  )

  const localMutationConfig = {
    errorPresentation: 'local',
    retry: false,
  }
  assert.deepEqual(fixture.calls, [
    {
      method: 'post',
      url: 'dictionary-types',
      data: createTypePayload,
      config: localMutationConfig,
    },
    {
      method: 'patch',
      url: 'dictionary-types/type%2Fid',
      data: updateTypePayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'dictionary-types/type%2Fid/enable',
      data: typeStatusPayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'dictionary-types/type%2Fid/disable',
      data: typeStatusPayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'dictionary-types/type%2Fid/items',
      data: createItemPayload,
      config: localMutationConfig,
    },
    {
      method: 'patch',
      url: 'dictionary-types/type%2Fid/items/item%2Fid',
      data: updateItemPayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'dictionary-types/type%2Fid/items/item%2Fid/enable',
      data: itemStatusPayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'dictionary-types/type%2Fid/items/item%2Fid/disable',
      data: itemStatusPayload,
      config: localMutationConfig,
    },
  ])
  assert.equal('delete' in api.types, false)
  assert.equal('delete' in api.items, false)
})

test('Dictionary API 传输类型只来自 generated tree，不声明平行 DTO 镜像', () => {
  const source = readFileSync(
    new URL('../../src/api/modules/dictionaries.ts', import.meta.url),
    'utf8',
  )

  assert.match(source, /from ['"]\.\.\/generated\/types\.gen['"]/u)
  assert.doesNotMatch(source, /\binterface\s+\w+\b/u)
  assert.doesNotMatch(source, /\btype\s+\w+\s*=\s*\{/u)
  assert.doesNotMatch(
    source,
    /interface\s+(?:DictionaryTypeDto|DictionaryItemDto|DictionaryCatalogDto)\b/u,
  )
  assert.doesNotMatch(source, /\b(?:interface|type)\s+\w*(?:Dto|RequestDto)\b/u)
  assert.doesNotMatch(source, /\bdelete\s*:/u)
})
