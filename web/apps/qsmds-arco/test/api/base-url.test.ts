import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- URL 规范化是纯函数，使用 Node.js 内置 runner 验证。
import test from 'node:test'

import { resolveApiBaseUrl } from '../../src/api/base-url'

test('缺失、空白或历史根路径统一收敛为同源 /api/', () => {
  for (const value of [undefined, '', '   ', '/']) {
    assert.equal(resolveApiBaseUrl(value, false), '/api/')
  }
})

test('显式 API base URL 保留语义并补齐 trailing slash', () => {
  assert.equal(resolveApiBaseUrl('/custom-api', false), '/custom-api/')
  assert.equal(
    resolveApiBaseUrl('https://api.example.com/v1/', false),
    'https://api.example.com/v1/',
  )
})

test('明确启用开发代理时只使用固定 /proxy/', () => {
  assert.equal(resolveApiBaseUrl('/', true), '/proxy/')
})
