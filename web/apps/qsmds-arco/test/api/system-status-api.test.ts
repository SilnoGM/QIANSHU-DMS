import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API 单元测试由 Node.js 内置 runner 直接运行。
import test from 'node:test'

import { createSystemStatusApi } from '../../src/api/modules/system-status'

interface RecordedCall {
  readonly config: unknown
  readonly url: string
}

test('系统状态 API 使用只读路径并关闭自动重试与全局错误提示', async () => {
  const calls: RecordedCall[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    get(url: string, config?: unknown) {
      calls.push({ config, url })
      return response
    },
  } as unknown as AxiosInstance
  const api = createSystemStatusApi(client)
  const controller = new AbortController()

  await api.get(controller.signal)
  assert.deepEqual(calls, [{
    config: {
      errorPresentation: 'local',
      retry: false,
      signal: controller.signal,
    },
    url: 'system/status',
  }])

  calls.length = 0
  await api.get()
  assert.deepEqual(calls, [{
    config: {
      errorPresentation: 'local',
      retry: false,
    },
    url: 'system/status',
  }])
})
