import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createAuthApi } from '../../src/api/modules/auth'

interface Call {
  method: 'get' | 'post'
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
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'post', url, data, config })
      return response
    },
  } as unknown as AxiosInstance
  return { calls, client }
}

test('认证 API 使用真实 Session 路径且所有认证 mutation 禁止自动重试', async () => {
  const fixture = createClientRecorder()
  const auth = createAuthApi(fixture.client)

  await auth.login({ username: 'operator', password: 'secret input' })
  await auth.me()
  await auth.me(undefined, false)
  await auth.changePassword({
    currentPassword: 'old secret',
    newPassword: 'new secret',
  })
  await auth.logout()
  await auth.logoutAll()

  assert.deepEqual(fixture.calls, [
    {
      method: 'post',
      url: 'auth/login',
      data: { username: 'operator', password: 'secret input' },
      config: { retry: false },
    },
    { method: 'get', url: 'auth/me', config: { retry: false } },
    {
      method: 'get',
      url: 'auth/me',
      config: { broadcastSessionInvalid: false, retry: false },
    },
    {
      method: 'post',
      url: 'auth/password/change',
      data: { currentPassword: 'old secret', newPassword: 'new secret' },
      config: { retry: false },
    },
    {
      method: 'post',
      url: 'auth/logout',
      data: {},
      config: { retry: false },
    },
    {
      method: 'post',
      url: 'auth/logout-all',
      data: {},
      config: { retry: false },
    },
  ])
})
