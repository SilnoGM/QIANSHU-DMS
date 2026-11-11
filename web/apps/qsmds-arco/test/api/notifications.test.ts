import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证通知记录 API 的查询、详情与取消传输契约。
import test from 'node:test'

import { createNotificationsApi } from '../../src/api/modules/notifications'

test('通知记录列表携带筛选参数，详情编码 ID，取消禁止自动重试', async () => {
  const calls: unknown[][] = []
  const invoke = (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  }
  const api = createNotificationsApi({
    get: invoke,
    post: invoke,
  } as unknown as AxiosInstance)
  const signal = new AbortController().signal

  await api.records.list({
    page: 2,
    pageSize: 50,
    status: 'FAILED',
    domain: 'FINANCE',
    channel: 'IN_APP',
    priority: 'HIGH',
    publishedFrom: '2026-11-01T00:00:00+08:00',
    publishedTo: '2026-11-09T23:59:59.999+08:00',
    keyword: '张三',
  }, signal)
  await api.records.get('record/1', signal)
  await api.records.cancel('record/1')
  await api.records.options(signal)

  assert.deepEqual(calls[0], [
    'notifications/records',
    {
      errorPresentation: 'local',
      params: {
        page: 2,
        pageSize: 50,
        status: 'FAILED',
        domain: 'FINANCE',
        channel: 'IN_APP',
        priority: 'HIGH',
        publishedFrom: '2026-11-01T00:00:00+08:00',
        publishedTo: '2026-11-09T23:59:59.999+08:00',
        keyword: '张三',
      },
      signal,
    },
  ])
  assert.deepEqual(calls[1], [
    'notifications/records/record%2F1',
    { errorPresentation: 'local', signal },
  ])
  assert.deepEqual(calls[2], [
    'notifications/records/record%2F1/cancel',
    {},
    { errorPresentation: 'local', retry: false },
  ])
  assert.deepEqual(calls[3], [
    'notifications/records/options',
    { errorPresentation: 'local', signal },
  ])
})
