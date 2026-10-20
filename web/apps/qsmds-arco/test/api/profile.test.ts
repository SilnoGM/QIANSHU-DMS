import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createProfileApi } from '../../src/api/modules/profile'

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

test('本人资料 API 使用固定 profile 路径，并允许 GET 被身份域取消', async () => {
  const fixture = createClientRecorder()
  const profile = createProfileApi(fixture.client)
  const controller = new AbortController()

  await profile.get(controller.signal)

  assert.deepEqual(fixture.calls, [{
    method: 'get',
    url: 'profile',
    config: {
      errorPresentation: 'local',
      signal: controller.signal,
    },
  }])
})

test('本人资料 GET 未提供 signal 时不伪造取消配置', async () => {
  const fixture = createClientRecorder()
  const profile = createProfileApi(fixture.client)

  await profile.get()

  assert.deepEqual(fixture.calls, [{
    method: 'get',
    url: 'profile',
    config: {
      errorPresentation: 'local',
    },
  }])
})

test('本人资料 PATCH 使用本地错误展示且禁止自动重试', async () => {
  const fixture = createClientRecorder()
  const profile = createProfileApi(fixture.client)
  const payload = {
    avatarUrl: null,
    email: 'operator@example.com',
    mobileE164: '+8613800138000',
  }

  await profile.update(payload)

  assert.deepEqual(fixture.calls, [{
    method: 'patch',
    url: 'profile',
    data: payload,
    config: {
      errorPresentation: 'local',
      retry: false,
    },
  }])
})

test('头像上传使用固定 multipart 路径、mediaType 在 file 之前且禁止重试', async () => {
  const fixture = createClientRecorder()
  const profile = createProfileApi(fixture.client)
  const controller = new AbortController()
  const file = new File(['avatar'], 'avatar.webp', { type: 'image/webp' })

  await profile.uploadAvatar(file, controller.signal)

  const [call] = fixture.calls
  assert.equal(call?.method, 'post')
  assert.equal(call?.url, 'profile/avatar-uploads')
  assert.ok(call?.data instanceof FormData)
  assert.equal(call.data.get('mediaType'), 'IMAGE')
  const uploaded = call.data.get('file')
  assert.ok(uploaded instanceof File)
  assert.equal(uploaded.name, 'avatar.webp')
  assert.equal(uploaded.type, 'image/webp')
  assert.deepEqual(call.config, {
    errorPresentation: 'local',
    retry: false,
    signal: controller.signal,
  })
})
