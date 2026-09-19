import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证只读解析与显式确认导入的独立传输契约。
import test from 'node:test'
import { createContainerImportApi } from '../../src/api/modules/container-import'

test('解析为 GET；确认全量行及来源快照，携带幂等键且不自动重试', async () => {
  const calls: unknown[][] = []
  const invoke = async (...args: unknown[]) => {
    calls.push(args)
    return { data: {} }
  }
  const api = createContainerImportApi({ get: invoke, post: invoke } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const body = { expectedVersion: 2, sourceFileId: 'source', sourceHash: 'hash', allowUnmatched: false, rows: [{ rowKey: 'Sheet1:3', shipmentId: 'shipment' }] }
  await api.preview('batch/id', signal)
  await api.confirm('batch/id', body, 'key', signal)
  assert.deepEqual(calls[0], ['container-batches/batch%2Fid/import-preview', { signal, errorPresentation: 'local' }])
  assert.deepEqual(calls[1], ['container-batches/batch%2Fid/import', body, { signal, errorPresentation: 'local', retry: false, headers: { 'Idempotency-Key': 'key' } }])
})
