import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createRegionsApi } from '../../src/api/modules/regions'

interface Call {
  method: 'get' | 'patch' | 'post'
  url: string
  data?: unknown
  config?: unknown
}

function createClientRecorder(): { calls: Call[], client: AxiosInstance } {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    get(url: string, config?: unknown) {
      calls.push({ method: 'get', url, config })
      return response
    },
    patch(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'patch', url, data, config })
      return response
    },
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'post', url, data, config })
      return response
    },
  } as unknown as AxiosInstance

  return { calls, client }
}

test('地区选择 API 固定 options、search、path 的查询参数、signal 与本地错误展示', async () => {
  const fixture = createClientRecorder()
  const regions = createRegionsApi(fixture.client)
  const rootController = new AbortController()
  const childController = new AbortController()
  const searchController = new AbortController()
  const pathController = new AbortController()

  await regions.selection.listOptions(null, rootController.signal)
  await regions.selection.listOptions(
    'country-region-id',
    childController.signal,
  )
  await regions.selection.search('中国台湾 高雄', searchController.signal)
  await regions.selection.getPath(
    'city/id with spaces',
    pathController.signal,
  )

  assert.deepEqual(fixture.calls, [
    {
      method: 'get',
      url: 'region-selection/options',
      config: {
        errorPresentation: 'local',
        signal: rootController.signal,
      },
    },
    {
      method: 'get',
      url: 'region-selection/options',
      config: {
        errorPresentation: 'local',
        params: { parentId: 'country-region-id' },
        signal: childController.signal,
      },
    },
    {
      method: 'get',
      url: 'region-selection/search',
      config: {
        errorPresentation: 'local',
        params: {
          limit: 50,
          query: '中国台湾 高雄',
        },
        signal: searchController.signal,
      },
    },
    {
      method: 'get',
      url: 'region-selection/paths/city%2Fid%20with%20spaces',
      config: {
        errorPresentation: 'local',
        signal: pathController.signal,
      },
    },
  ])
})

test('地区管理只读 API 固定 navigation、list、detail 的查询参数、signal 与本地错误展示', async () => {
  const fixture = createClientRecorder()
  const regions = createRegionsApi(fixture.client)
  const navigationController = new AbortController()
  const listController = new AbortController()
  const detailController = new AbortController()

  await regions.management.navigation(navigationController.signal)
  await regions.management.list({
    availability: 'ANCESTOR_DISABLED',
    code: 'CN-TW-KHH',
    ownStatus: 'ENABLED',
    page: 2,
    pageSize: 20,
    parentId: 'province-state-id',
    query: '高雄',
    sortBy: 'sortOrder',
    sortOrder: 'asc',
  }, listController.signal)
  await regions.management.get(
    'region/id with spaces',
    detailController.signal,
  )

  assert.deepEqual(fixture.calls, [
    {
      method: 'get',
      url: 'regions/navigation',
      config: {
        errorPresentation: 'local',
        signal: navigationController.signal,
      },
    },
    {
      method: 'get',
      url: 'regions',
      config: {
        errorPresentation: 'local',
        params: {
          availability: 'ANCESTOR_DISABLED',
          code: 'CN-TW-KHH',
          ownStatus: 'ENABLED',
          page: 2,
          pageSize: 20,
          parentId: 'province-state-id',
          query: '高雄',
          sortBy: 'sortOrder',
          sortOrder: 'asc',
        },
        signal: listController.signal,
      },
    },
    {
      method: 'get',
      url: 'regions/region%2Fid%20with%20spaces',
      config: {
        errorPresentation: 'local',
        signal: detailController.signal,
      },
    },
  ])
})

test('地区管理四个 mutation 固定 method、path、body、本地错误展示且显式禁止重试', async () => {
  const fixture = createClientRecorder()
  const regions = createRegionsApi(fixture.client)
  const createPayload = {
    code: 'CN-TW-KHH-NEW',
    enabled: true,
    englishName: 'New City',
    name: '新城市',
    parentId: 'province-state-id',
    sortOrder: 10,
  }
  const updatePayload = {
    englishName: null,
    name: '新名称',
    sortOrder: 20,
  }

  await regions.management.create(createPayload)
  await regions.management.update('region/id', updatePayload)
  await regions.management.enable('region/id')
  await regions.management.disable('region/id')

  assert.deepEqual(fixture.calls, [
    {
      method: 'post',
      url: 'regions',
      data: createPayload,
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
    {
      method: 'patch',
      url: 'regions/region%2Fid',
      data: updatePayload,
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
    {
      method: 'post',
      url: 'regions/region%2Fid/enable',
      data: {},
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
    {
      method: 'post',
      url: 'regions/region%2Fid/disable',
      data: {},
      config: {
        errorPresentation: 'local',
        retry: false,
      },
    },
  ])
})
