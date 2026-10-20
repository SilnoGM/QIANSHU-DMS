import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 批量图片弹窗契约使用 Node.js 内置 runner。
import test from 'node:test'

function readComponent(filename: string): string {
  return readFileSync(new URL(
    `../../src/views/admin/product-management/list/${filename}`,
    import.meta.url,
  ), 'utf8')
}

const modalSource = readComponent('product-batch-images-modal.vue')
const cardSource = readComponent('product-batch-image-card.vue')

test('批量图片弹窗使用 2xl 填充高度和独立滚动区', () => {
  assert.match(modalSource, /<QsGenericModal/u)
  assert.match(modalSource, /title="批量设置图片"/u)
  assert.match(modalSource, /size="2xl"/u)
  assert.match(modalSource, /fill-height/u)
  assert.match(modalSource, /overflow-y-auto/u)
  assert.match(modalSource, /sm:grid-cols-2/u)
  assert.match(modalSource, /未选择图片的产品将跳过/u)
})

test('弹窗复用现有上传与布局接口，不另建上传通道', () => {
  assert.match(modalSource, /productMediaApi\.upload/u)
  assert.match(modalSource, /productMediaApi\.updateLayout/u)
  assert.match(modalSource, /reconcileProductMediaUploadResult/u)
  assert.match(modalSource, /getProductMediaMutationFailure/u)
  assert.match(modalSource, /MAX_PRODUCT_IMAGES/u)
  assert.match(modalSource, /URL\.createObjectURL/u)
  assert.match(modalSource, /URL\.revokeObjectURL/u)
  assert.match(modalSource, /重试失败项/u)
  assert.match(modalSource, /结果未知/u)
  assert.match(modalSource, /aria-live="polite"/u)
  assert.doesNotMatch(modalSource, /product-media-upload-queue|confirmProductMediaUpload/u)
})

test('单产品卡片只允许选图，不提供文件名或产品名编辑', () => {
  assert.match(cardSource, /accept="\.jpg,\.jpeg,\.png,\.webp"/u)
  assert.match(cardSource, /type="file"/u)
  assert.match(cardSource, /<FaCheckbox/u)
  assert.match(cardSource, /设置为主图/u)
  assert.match(cardSource, /图片已达上限/u)
  assert.match(cardSource, /无权读取当前图片/u)
  assert.match(cardSource, /role="progressbar"/u)
  assert.doesNotMatch(cardSource, /<FaInput|<input[^>]+type="text"|v-model[^>]*product\.name/u)
  assert.doesNotMatch(cardSource, /getProductMediaFilenameParts|validateProductMediaFilenameStem/u)
})
