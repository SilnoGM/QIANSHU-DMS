import type { AxiosInstance, AxiosResponse } from 'axios'
import type { HealthResponse } from '../../src/api/modules/health'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API 单元测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'

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
