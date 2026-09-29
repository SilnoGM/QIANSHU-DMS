import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证顺联航账单的请求契约与幂等头。
import test from 'node:test'
import { createSlhBillsApi } from '../../src/api/modules/slh-bills'

test('列表与明细带上查询条件，详情与分页路径转义账单主键', async () => {
  const calls: unknown[][] = []
  const api = createSlhBillsApi({ get: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  await api.list({ page: 2, pageSize: 50, keyword: 'CBILL', state: 'active' }, signal)
  await api.get('bill/id', signal)
  await api.lines('bill/id', { page: 3, pageSize: 20 }, signal)
  await api.downloadSourceFile('bill/id', signal)
  assert.deepEqual(calls, [
    ['slh-bills', { errorPresentation: 'local', signal, params: { page: 2, pageSize: 50, keyword: 'CBILL', state: 'active' } }],
    ['slh-bills/bill%2Fid', { errorPresentation: 'local', signal }],
    ['slh-bills/bill%2Fid/lines', { errorPresentation: 'local', signal, params: { page: 3, pageSize: 20 } }],
    ['slh-bills/bill%2Fid/source-file', { errorPresentation: 'local', responseType: 'blob', signal }],
  ])
})

test('上传先发 mediaType 再发文件流，且写请求禁用重试', async () => {
  const calls: unknown[][] = []
  const api = createSlhBillsApi({ post: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const file = new File(['xlsx'], 'slh.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  await api.uploadSourceFile(file, signal)
  assert.equal(calls[0]?.[0], 'slh-bills/source-file-uploads')
  const body = calls[0]?.[1] as FormData
  assert.deepEqual(Array.from(body.keys()), ['mediaType', 'file'])
  assert.equal(body.get('mediaType'), 'DOCUMENT')
  assert.equal(body.get('file'), file)
  assert.deepEqual(calls[0]?.[2], { errorPresentation: 'local', retry: false, signal })
})

test('入库携带调用方提供的幂等键，预览与入库都不自动重放', async () => {
  const calls: unknown[][] = []
  const api = createSlhBillsApi({ post: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  await api.importPreview({ mediaAssetId: 'asset-1' }, signal)
  await api.create({ duplicateAcknowledged: true, mediaAssetId: 'asset-1', manualForeignUnitsPerCny: '4.8' }, 'request-key', signal)
  assert.deepEqual(calls, [
    ['slh-bills/import-preview', { mediaAssetId: 'asset-1' }, { errorPresentation: 'local', retry: false, signal }],
    ['slh-bills', { duplicateAcknowledged: true, mediaAssetId: 'asset-1', manualForeignUnitsPerCny: '4.8' }, { errorPresentation: 'local', headers: { 'Idempotency-Key': 'request-key' }, retry: false, signal }],
  ])
})
