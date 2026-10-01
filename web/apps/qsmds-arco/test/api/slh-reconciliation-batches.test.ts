import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证对账批次的请求契约、幂等头与路径转义。
import test from 'node:test'
import { createSlhReconciliationBatchesApi } from '../../src/api/modules/slh-reconciliation-batches'

test('列表与候选带上查询条件，详情与写路径转义批次主键', async () => {
  const calls: unknown[][] = []
  const api = createSlhReconciliationBatchesApi({
    get: (...args: unknown[]) => {
      calls.push(args)
      return Promise.resolve({ data: {} })
    },
    post: (...args: unknown[]) => {
      calls.push(args)
      return Promise.resolve({ data: {} })
    },
  } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  await api.list({ page: 1, pageSize: 20, status: 'IN_PROGRESS' }, signal)
  await api.candidates({ page: 2, pageSize: 20, keyword: 'CBILL' }, signal)
  await api.get('batch/id', signal)
  await api.reconcile('batch/id', { lineIds: ['line-1'] }, signal)
  await api.complete('batch/id', signal)
  assert.deepEqual(calls, [
    ['slh-reconciliation-batches', { errorPresentation: 'local', signal, params: { page: 1, pageSize: 20, status: 'IN_PROGRESS' } }],
    ['slh-reconciliation-batches/candidates', { errorPresentation: 'local', signal, params: { page: 2, pageSize: 20, keyword: 'CBILL' } }],
    ['slh-reconciliation-batches/batch%2Fid', { errorPresentation: 'local', signal }],
    ['slh-reconciliation-batches/batch%2Fid/reconcile', { lineIds: ['line-1'] }, { errorPresentation: 'local', retry: false, signal }],
    ['slh-reconciliation-batches/batch%2Fid/complete', {}, { errorPresentation: 'local', retry: false, signal }],
  ])
})

test('匹配预览与创建都不自动重放，创建携带调用方提供的幂等键', async () => {
  const calls: unknown[][] = []
  const api = createSlhReconciliationBatchesApi({ post: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  await api.matchPreview({ billId: 'bill-1' }, signal)
  await api.create({ billId: 'bill-1', previewLineIds: ['line-1'] }, 'request-key', signal)
  assert.deepEqual(calls, [
    ['slh-reconciliation-batches/match-preview', { billId: 'bill-1' }, { errorPresentation: 'local', retry: false, signal }],
    ['slh-reconciliation-batches', { billId: 'bill-1', previewLineIds: ['line-1'] }, { errorPresentation: 'local', headers: { 'Idempotency-Key': 'request-key' }, retry: false, signal }],
  ])
})
