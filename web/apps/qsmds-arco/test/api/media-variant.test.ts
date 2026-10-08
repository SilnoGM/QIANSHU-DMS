import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 媒体变体 URL 助手使用 Node.js 内置 runner，避免引入浏览器测试依赖。
import test from 'node:test'

import {
  mediaPosterUrl,
  mediaThumbnailUrl,
  withMediaVariant,
} from '../../src/utils/media-variant'

const CONTENT_PATH = '/api/products/11111111-1111-4111-8111-111111111111/media/22222222-2222-4222-8222-222222222222/content'

test('appends the variant parameter to a same-origin content path', () => {
  assert.equal(
    withMediaVariant(CONTENT_PATH, 'thumb'),
    `${CONTENT_PATH}?variant=thumb`,
  )
  assert.equal(mediaThumbnailUrl(CONTENT_PATH), `${CONTENT_PATH}?variant=thumb`)
  assert.equal(mediaPosterUrl(CONTENT_PATH), `${CONTENT_PATH}?variant=poster`)
})

test('merges the variant parameter with an existing query string', () => {
  const withQuery = `${CONTENT_PATH}?currencyCode=MYR`
  assert.equal(
    withMediaVariant(withQuery, 'thumb'),
    `${withQuery}&variant=thumb`,
  )
})

test('refuses anything that is not a same-origin api path', () => {
  for (const value of [
    undefined,
    null,
    '',
    'https://example.com/api/products/1/media/2/content',
    '//evil.example/api/products/1/media/2/content',
    'javascript:alert(1)',
    '/other/products/1/media/2/content',
  ]) {
    assert.equal(withMediaVariant(value, 'thumb'), undefined)
    assert.equal(mediaThumbnailUrl(value), undefined)
    assert.equal(mediaPosterUrl(value), undefined)
  }
})

test('keeps the variant names that the server accepts', () => {
  // 服务端只接受 thumb（图片）与 poster（视频），其他取值会被拒绝为校验失败。
  assert.equal(mediaThumbnailUrl(CONTENT_PATH)?.endsWith('variant=thumb'), true)
  assert.equal(mediaPosterUrl(CONTENT_PATH)?.endsWith('variant=poster'), true)
})
