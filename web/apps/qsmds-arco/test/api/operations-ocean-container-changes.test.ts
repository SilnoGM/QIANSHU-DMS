import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 修改及撤销必须绑定原请求，写请求禁止自动重试。
import test from 'node:test'
import { createOperationsOceanContainersApi } from '../../src/api/modules/operations-ocean-containers'

test('撤销定位本次修改并携带原版本与幂等键，不自动重复执行', async () => {
  const calls: unknown[][] = []
  const api = createOperationsOceanContainersApi({ post: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const payload = { requestKey: 'same-undo-key', expectedVersion: 3 }
  await api.undoChange('batch/1', 'line/1', 'change/1', payload, signal)
  await api.undoChange('batch/1', 'line/1', 'change/1', payload, signal)
  assert.deepEqual(calls[0], ['operations/ocean-containers/batch%2F1/items/line%2F1/changes/change%2F1/undo', payload, { signal, errorPresentation: 'local', retry: false }])
  assert.deepEqual(calls[0], calls[1])
})

test('金额修改携带版本和原幂等键，金额字符串不转浮点', async () => {
  const calls: unknown[][] = []
  const api = createOperationsOceanContainersApi({ post: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const payload = { requestKey: 'same-key', kind: 'COD' as const, expectedVersion: 2, notificationConfirmed: true as const, codAmountTwd: '9007199254740993.01' }
  await api.changeItem('batch/1', 'line/1', payload, signal)
  await api.changeItem('batch/1', 'line/1', payload, signal)
  assert.deepEqual(calls[0], ['operations/ocean-containers/batch%2F1/items/line%2F1/changes', payload, { signal, errorPresentation: 'local', retry: false }])
  assert.deepEqual(calls[0], calls[1])
})

test('全部柜次读取使用显式 all 路径，明细详情可读取他人行', async () => {
  const calls: unknown[][] = []
  const api = createOperationsOceanContainersApi({ get: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const query = { page: 1, pageSize: 10 }
  await api.listAll(query, signal)
  await api.allItems('batch/1', query, signal)
  await api.allItem('batch/1', 'line/1', signal)
  assert.deepEqual(calls, [
    ['operations/ocean-containers/all', { signal, errorPresentation: 'local', params: query }],
    ['operations/ocean-containers/all/batch%2F1/items', { signal, errorPresentation: 'local', params: query }],
    ['operations/ocean-containers/all/batch%2F1/items/line%2F1', { signal, errorPresentation: 'local' }],
  ])
})
