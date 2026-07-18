import type { AxiosInstance, AxiosResponse } from 'axios'
import type { HealthResponse } from '../../src/api/modules/health'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API 单元测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'

import api from '../../src/api'
import { getHealth } from '../../src/api/modules/health'

test('getHealth 使用 /health 并保留完整 Axios response', async () => {
  const response = {
    config: {},
    data: {
      details: {
        database: { status: 'up' },
      },
      error: {},
      info: {
        database: { status: 'up' },
      },
      status: 'ok',
    },
    headers: {},
    status: 200,
    statusText: 'OK',
  } as unknown as AxiosResponse<HealthResponse>
  const calls: string[] = []
  const client = {
    get: async (url: string) => {
      calls.push(url)
      return response
    },
  } as unknown as AxiosInstance

  assert.equal(await getHealth(client), response)
  assert.deepEqual(calls, ['/health'])
})

test('getHealth 未注入 Client 时使用唯一生产 api', async () => {
  const response = {
    config: {},
    data: {
      details: {
        database: { status: 'up' },
      },
      error: {},
      info: {
        database: { status: 'up' },
      },
      status: 'ok',
    },
    headers: {},
    status: 200,
    statusText: 'OK',
  } as unknown as AxiosResponse<HealthResponse>
  const calls: string[] = []
  const originalGet = api.get

  assert.equal(api.defaults.baseURL, '/api/')
  assert.equal(api.defaults.timeout, 60_000)
  assert.equal(api.defaults.responseType, 'json')

  api.get = (async (url: string) => {
    calls.push(url)
    return response
  }) as AxiosInstance['get']

  try {
    assert.equal(await getHealth(), response)
    assert.deepEqual(calls, ['/health'])
  }
  finally {
    // 生产单例会被其他测试模块复用，必须恢复方法，避免测试顺序造成状态泄漏。
    api.get = originalGet
  }
})
