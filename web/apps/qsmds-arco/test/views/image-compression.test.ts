import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  AVATAR_MAX_EDGE,
  fitWithinMaxEdge,
} from '../../src/utils/image-compression'
import {
  UPLOAD_IMAGE_MAX_BYTES,
  validateUploadImage,
} from '../../src/utils/image-upload-rules'

test('头像尺寸按最大边等比缩小且不放大', () => {
  assert.equal(AVATAR_MAX_EDGE, 512)
  assert.deepEqual(fitWithinMaxEdge(1024, 512), { height: 256, width: 512 })
  assert.deepEqual(fitWithinMaxEdge(512, 1024), { height: 512, width: 256 })
  assert.deepEqual(fitWithinMaxEdge(300, 300), { height: 300, width: 300 })
  assert.deepEqual(fitWithinMaxEdge(1000, 1000), { height: 512, width: 512 })
  assert.deepEqual(fitWithinMaxEdge(1, 1000), { height: 512, width: 1 })
})

test('头像尺寸拒绝非法输入', () => {
  for (const [width, height] of [
    [0, 10],
    [10, 0],
    [-1, 10],
    [Number.NaN, 10],
    [Number.POSITIVE_INFINITY, 10],
  ]) {
    assert.throws(() => fitWithinMaxEdge(width, height), /Invalid image dimensions/u)
  }
})

test('图片上传规则只接受 jpg/png/webp 且不超过 10 MiB', () => {
  assert.equal(validateUploadImage({ name: 'a.png', size: 20, type: 'image/png' }), null)
  assert.equal(validateUploadImage({ name: 'a.jpg', size: 20, type: 'image/jpeg' }), null)
  assert.equal(validateUploadImage({ name: 'a.webp', size: 20, type: 'image/webp' }), null)
  assert.equal(validateUploadImage({ name: 'a.gif', size: 20, type: 'image/gif' }), 'type')
  assert.equal(validateUploadImage({ name: 'a.svg', size: 20, type: 'image/svg+xml' }), 'type')
  assert.equal(validateUploadImage({ name: 'a.png', size: 0, type: 'image/png' }), 'empty')
  assert.equal(
    validateUploadImage({ name: 'a.png', size: UPLOAD_IMAGE_MAX_BYTES + 1, type: 'image/png' }),
    'too-large',
  )
  assert.equal(
    validateUploadImage({ name: 'a.png', size: UPLOAD_IMAGE_MAX_BYTES, type: 'image/png' }),
    null,
  )
})
