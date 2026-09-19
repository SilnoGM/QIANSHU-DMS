import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证柜次传输契约与安全重试。
import test from 'node:test'
import { createContainerBatchesApi } from '../../src/api/modules/container-batches'

test('创建带幂等键，修改携带两个版本且禁止自动重试', async () => {
  const calls: unknown[][] = []
  const invoke = (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  }
  const api = createContainerBatchesApi({ get: invoke, post: invoke, patch: invoke } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const create = { containerBatchName: '0919柜', warehouseValue: 'b5', sourceFileId: 'uploaded-source' }
  await api.create(create, 'key', signal)
  await api.updateItem('batch/id', 'item/id', { goodsName: 'Machine', packageCount: 10, expectedVersion: 3, itemExpectedVersion: 2 }, signal)
  await api.list({ page: 1, pageSize: 20, search: '0919', warehouseValue: 'b5' }, signal)
  assert.equal(calls[0][0], 'container-batches')
  assert.deepEqual(calls[0][1], create)
  assert.deepEqual(calls[0][2], { errorPresentation: 'local', retry: false, headers: { 'Idempotency-Key': 'key' }, signal })
  assert.equal(calls[1][0], 'container-batches/batch%2Fid/items/item%2Fid')
  assert.equal((calls[1][1] as {
    itemExpectedVersion: number
  }).itemExpectedVersion, 2)
  assert.equal((calls[1][2] as {
    retry: boolean
  }).retry, false)
  assert.equal((calls[2][1] as {
    params: {
      search: string
    }
  }).params.search, '0919')
})
