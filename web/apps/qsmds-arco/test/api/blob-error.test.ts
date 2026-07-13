import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API 纯函数单元测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'

import {
  MAX_API_ERROR_BLOB_BYTES,
  parseBlobApiError,
} from '../../src/api/blob-error'

const validApiError = {
  code: 'VALIDATION_FAILED',
  fieldErrors: {
    email: ['邮箱格式不正确'],
  },
  message: '请检查输入内容',
  requestId: 'req_12345678-1234-4234-9234-123456789abc',
}

test('parseBlobApiError 依据响应 Content-Type 解析 application/json 与 application/*+json', async () => {
  const jsonWithConflictingBlobType = new Blob(
    [JSON.stringify(validApiError)],
    { type: 'text/plain' },
  )

  assert.deepEqual(
    await parseBlobApiError(
      jsonWithConflictingBlobType,
      'application/json; charset=utf-8',
    ),
    validApiError,
  )
  assert.deepEqual(
    await parseBlobApiError(
      jsonWithConflictingBlobType,
      ' Application/Problem+JSON ; charset=UTF-8 ',
    ),
    validApiError,
  )
})

test('parseBlobApiError 在 Content-Type 缺失或与 Blob.type 冲突时拒绝解析', async () => {
  const jsonBlob = new Blob(
    [JSON.stringify(validApiError)],
    { type: 'application/json' },
  )

  assert.equal(await parseBlobApiError(jsonBlob, undefined), undefined)
  assert.equal(
    await parseBlobApiError(jsonBlob, 'application/octet-stream'),
    undefined,
  )
  assert.equal(await parseBlobApiError(jsonBlob, 'text/json'), undefined)
  assert.equal(
    await parseBlobApiError(
      jsonBlob,
      'application/problem+json,application/vendor.error+json',
    ),
    undefined,
  )
  assert.equal(
    await parseBlobApiError(jsonBlob, 'application/problem,foo+json'),
    undefined,
  )
})

test('parseBlobApiError 允许恰好 1 MiB 的 ApiError Blob', async () => {
  const boundaryValue = {
    code: 'E',
    message: 'm',
    padding: '',
    requestId: 'r',
  }
  const emptyPaddingBytes = new Blob([JSON.stringify(boundaryValue)]).size
  const boundaryJson = JSON.stringify({
    ...boundaryValue,
    padding: 'x'.repeat(MAX_API_ERROR_BLOB_BYTES - emptyPaddingBytes),
  })
  const boundaryBlob = new Blob([boundaryJson])

  assert.equal(boundaryBlob.size, MAX_API_ERROR_BLOB_BYTES)
  assert.deepEqual(
    await parseBlobApiError(boundaryBlob, 'application/json'),
    JSON.parse(boundaryJson),
  )
})

test('parseBlobApiError 拒绝非 Blob 与超过 1 MiB 的 body，且拒绝前不读取 body', async () => {
  class TrackingBlob extends Blob {
    textCallCount = 0

    override text(): Promise<string> {
      this.textCallCount += 1
      return super.text()
    }
  }

  const oversizedBlob = new TrackingBlob([
    'x'.repeat(MAX_API_ERROR_BLOB_BYTES + 1),
  ])
  const invalidMediaTypeBlob = new TrackingBlob([
    JSON.stringify(validApiError),
  ], { type: 'application/json' })

  assert.equal(
    await parseBlobApiError(validApiError, 'application/json'),
    undefined,
  )
  assert.equal(
    await parseBlobApiError(oversizedBlob, 'application/json'),
    undefined,
  )
  assert.equal(
    await parseBlobApiError(invalidMediaTypeBlob, 'text/plain'),
    undefined,
  )
  assert.equal(oversizedBlob.textCallCount, 0)
  assert.equal(invalidMediaTypeBlob.textCallCount, 0)
})

test('parseBlobApiError 将 Blob.text、JSON parse 与 ApiError 守卫失败收敛为 undefined', async () => {
  class FailingTextBlob extends Blob {
    override text(): Promise<string> {
      return Promise.reject(new Error('raw blob secret'))
    }
  }

  assert.equal(
    await parseBlobApiError(new FailingTextBlob(['{}']), 'application/json'),
    undefined,
  )
  assert.equal(
    await parseBlobApiError(new Blob(['not json']), 'application/json'),
    undefined,
  )
  assert.equal(
    await parseBlobApiError(
      new Blob([JSON.stringify({ message: 'missing fields' })]),
      'application/json',
    ),
    undefined,
  )
})

test('parseBlobApiError 将不可信 Blob.size getter 抛错收敛为 undefined', async () => {
  class ThrowingSizeBlob extends Blob {
    override get size(): number {
      throw new Error('raw Blob.size secret')
    }
  }

  assert.equal(
    await parseBlobApiError(
      new ThrowingSizeBlob([JSON.stringify(validApiError)]),
      'application/json',
    ),
    undefined,
  )
})
