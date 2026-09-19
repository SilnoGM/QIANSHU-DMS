import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证来源文件上传顺序和私有下载契约。
import test from 'node:test'
import { createContainerSourceFilesApi } from '../../src/api/modules/container-source-files'

test('uploads one DOCUMENT before file, escapes batch id and disables upload retry', async () => {
  const calls: unknown[][] = []
  const api = createContainerSourceFilesApi({ post: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const file = new File(['xlsx'], 'source.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const signal = new AbortController().signal
  await api.upload('batch/id', file, signal)
  assert.equal(calls[0]?.[0], 'container-batches/batch%2Fid/source-file-uploads')
  const body = calls[0]?.[1] as FormData
  assert.deepEqual(Array.from(body.keys()), ['mediaType', 'file'])
  assert.equal(body.get('mediaType'), 'DOCUMENT')
  assert.equal(body.get('file'), file)
  assert.deepEqual(calls[0]?.[2], { errorPresentation: 'local', retry: false, signal })
})

test('metadata and binary download use attached batch source, never a raw media key', async () => {
  const calls: unknown[][] = []
  const api = createContainerSourceFilesApi({ get: (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  } } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  await api.metadata('batch', signal)
  await api.download('batch', signal)
  assert.deepEqual(calls, [
    ['container-batches/batch/source-file', { errorPresentation: 'local', signal }],
    ['container-batches/batch/source-file/content', { errorPresentation: 'local', responseType: 'blob', signal }],
  ])
})
