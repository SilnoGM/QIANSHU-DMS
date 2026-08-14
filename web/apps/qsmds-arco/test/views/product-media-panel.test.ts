import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- ProductMedia View 合同使用 Node.js 内置 runner。
import test from 'node:test'

import {
  formatProductMediaBytes,
  formatProductMediaDuration,
  getProductMediaFocusTargetId,
} from '../../src/views/admin/product-management/media/product-media-view.logic'

const ROOT = new URL(
  '../../src/views/admin/product-management/media/',
  import.meta.url,
)

async function readComponent(filename: string): Promise<string> {
  return readFile(new URL(filename, ROOT), 'utf8')
}

test('媒体展示辅助逻辑稳定格式化容量、时长和解除后的焦点目标', () => {
  assert.equal(formatProductMediaBytes('0'), '0 B')
  assert.equal(formatProductMediaBytes('1024'), '1 KiB')
  assert.equal(formatProductMediaBytes(String(5 * 1024 * 1024 + 256 * 1024)), '5.25 MiB')
  assert.equal(formatProductMediaDuration(null), '—')
  assert.equal(formatProductMediaDuration(65_000), '01:05')
  assert.equal(formatProductMediaDuration(3_661_000), '01:01:01')

  assert.equal(getProductMediaFocusTargetId(['a', 'b', 'c'], 'b'), 'c')
  assert.equal(getProductMediaFocusTargetId(['a', 'b', 'c'], 'c'), 'b')
  assert.equal(getProductMediaFocusTargetId(['a'], 'a'), null)
})

test('ProductMediaPanel 固定权限、领域状态、API 编排和离开保护边界', async () => {
  const source = await readComponent('product-media-panel.vue')
  const orchestration = await readComponent('use-product-media-panel.ts')
  const uploadOrchestration = await readComponent('use-product-media-upload.ts')
  const implementation = `${source}\n${orchestration}\n${uploadOrchestration}`

  assert.match(source, /defineProps<ProductMediaPanelProps>/u)
  assert.match(source, /product: ProductListItemDto/u)
  assert.match(source, /editable: boolean/u)
  assert.match(source, /contentReadable: boolean/u)
  assert.match(source, /authEpoch: number/u)
  assert.match(source, /<ProductImageBoard/u)
  assert.match(source, /<ProductVideoBoard/u)
  assert.match(source, /<ProductMediaUploadQueue/u)
  assert.match(source, /<ProductMediaRules/u)
  assert.match(implementation, /productMediaApi\.upload/u)
  assert.match(implementation, /productMediaApi\.updateLayout/u)
  assert.match(implementation, /productMediaApi\.detach/u)
  assert.match(implementation, /productsApi\.getById/u)
  assert.match(implementation, /createProductMediaResourceRegistry/u)
  assert.match(implementation, /resolveProductMediaContentUrl/u)
  assert.match(implementation, /onBeforeRouteLeave/u)
  assert.match(implementation, /beforeunload/u)
  assert.match(source, /dirtyChange/u)
  assert.match(source, /unknownChange/u)
  assert.match(source, /<QsGenericModal/u)
  assert.match(source, /本地布局/u)
  assert.match(source, /最新布局/u)
  assert.doesNotMatch(implementation, /setTimeout\([\s\S]{0,120}(?:progress|loadedBytes)/u)
})

test('媒体面板使用 7/5 主辅布局并在窄屏回落为无横向滚动的单列流程', async () => {
  const source = await readComponent('product-media-panel.vue')
  const imageBoard = await readComponent('product-image-board.vue')

  assert.match(source, /class="product-media-layout[^"]*min-w-0[^"]*overflow-x-hidden/u)
  assert.match(source, /grid-template-columns:\s*minmax\(0,\s*7fr\)\s+minmax\([^,]+,\s*5fr\)/u)
  assert.match(source, /@media \(width <=/u)
  assert.match(imageBoard, /grid-cols-1/u)
  assert.match(imageBoard, /sm:grid-cols-2/u)
  assert.match(imageBoard, /xl:grid-cols-3/u)
  assert.match(imageBoard, /2xl:grid-cols-4/u)

  for (const component of [source, imageBoard]) {
    assert.doesNotMatch(component, /overflow-x-auto/u)
    assert.doesNotMatch(component, /(?:gradient|#[\dA-Fa-f]{3,8}\b|rgba?\()/u)
  }
})

test('图片工作区提供预览、文本化主图、拖拽增强、键盘排序和解除操作', async () => {
  const source = await readComponent('product-image-board.vue')

  assert.match(source, /<img\b/u)
  assert.match(source, /object-contain/u)
  assert.match(source, /aria-pressed/u)
  assert.match(source, /设为主图/u)
  assert.match(source, /前移/u)
  assert.match(source, /后移/u)
  assert.match(source, /预览图片/u)
  assert.match(source, /解除图片/u)
  assert.match(source, /:draggable="editable && !locked"/u)
  assert.match(source, /@dragstart/u)
  assert.match(source, /@drop/u)
  assert.match(source, /data-focus-anchor/u)
  assert.match(source, /min-h-11/u)
  assert.match(source, /prefers-reduced-motion:\s*reduce/u)
})

test('视频工作区保留原生键盘控件、排序和解除，且不会提供主图操作', async () => {
  const source = await readComponent('product-video-board.vue')

  assert.match(source, /<video\b/u)
  assert.match(source, /controls/u)
  assert.match(source, /前移/u)
  assert.match(source, /后移/u)
  assert.match(source, /预览视频/u)
  assert.match(source, /解除视频/u)
  assert.match(source, /@dragstart/u)
  assert.match(source, /@drop/u)
  assert.match(source, /min-h-11/u)
  assert.doesNotMatch(source, /主图|aria-pressed/u)
})

test('上传队列拥有可见 label、非唯一拖放入口、真实进度、取消和显式重试', async () => {
  const source = await readComponent('product-media-upload-queue.vue')

  assert.match(source, /<label[^>]+for="product-media-upload-input"/u)
  assert.match(source, /选择图片或视频/u)
  assert.match(source, /id="product-media-upload-input"/u)
  assert.match(source, /type="file"/u)
  assert.match(source, /multiple/u)
  assert.match(source, /accept="\.jpg,\.jpeg,\.png,\.webp,\.mp4"/u)
  assert.match(source, /<FaFileUpload/u)
  assert.match(source, /:before-upload="interceptPrimitiveFile"/u)
  assert.match(source, /<FaProgress/u)
  assert.match(source, /loadedBytes/u)
  assert.match(source, /totalBytes/u)
  assert.match(source, /aria-live="polite"/u)
  assert.match(source, /tabindex="-1"/u)
  assert.match(source, /重试上传/u)
  assert.match(source, /取消上传/u)
  assert.match(source, /min-h-11/u)
  assert.doesNotMatch(source, /(?:gradient|#[\dA-Fa-f]{3,8}\b|rgba?\()/u)
})

test('媒体规则明确图片、视频限制和剩余容量，不出现产品文档入口', async () => {
  const source = await readComponent('product-media-rules.vue')

  assert.match(source, /JPEG/u)
  assert.match(source, /PNG/u)
  assert.match(source, /WebP/u)
  assert.match(source, /MP4/u)
  assert.match(source, /10 MiB/u)
  assert.match(source, /500 MiB/u)
  assert.match(source, /20 张/u)
  assert.match(source, /5 个/u)
  assert.match(source, /remainingImageCount/u)
  assert.match(source, /remainingVideoCount/u)
  assert.doesNotMatch(source, /PDF|DOCX|XLSX|说明书|证书/u)
})
