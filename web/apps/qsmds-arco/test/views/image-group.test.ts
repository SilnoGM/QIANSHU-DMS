import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 图片组纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  createImageGroupEntries,
  normalizeImageGroupItems,
  resolveImageGroupMaxCount,
  resolveImageGroupOverlap,
  resolveImageGroupRadius,
  resolveImageGroupSize,
  resolveImageGroupStateKey,
  resolveImageGroupTooltip,
  retainImageGroupStateKeys,
} from '../../src/components/base/ImageGroup/logic'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const images = [
  {
    alt: '墨蓝色旅行收纳包',
    key: 'front',
    previewSrc: '/fixtures/product-front-large.svg',
    src: '/fixtures/product-front.svg',
    tooltip: '产品正面图',
  },
  {
    alt: '旅行收纳包侧面',
    key: 'side',
    src: '/fixtures/product-side.svg',
  },
  {
    key: 'detail',
    src: '/fixtures/product-detail.svg',
  },
  {
    key: 'package',
    src: '/fixtures/product-package.svg',
  },
  {
    key: 'label',
    src: '/fixtures/product-label.svg',
  },
] as const

test('图片组过滤空地址但保留调用方原始图片字段和顺序', () => {
  const normalized = normalizeImageGroupItems([
    images[0],
    { alt: '空地址', src: '   ' },
    images[1],
  ])

  assert.equal(normalized.length, 2)
  assert.equal(normalized[0]?.item, images[0])
  assert.equal(normalized[0]?.index, 0)
  assert.equal(normalized[0]?.key, 'front')
  assert.equal(normalized[1]?.item, images[1])
  assert.equal(normalized[1]?.index, 1)
  assert.equal(normalized[1]?.key, 'side')
})

test('图片组尺寸、重叠和最大显示数量具有稳定边界', () => {
  assert.equal(resolveImageGroupSize('sm'), 32)
  assert.equal(resolveImageGroupSize('md'), 40)
  assert.equal(resolveImageGroupSize('lg'), 48)
  assert.equal(resolveImageGroupSize(56), 56)
  assert.equal(resolveImageGroupSize(10), 24)
  assert.equal(resolveImageGroupSize(200), 96)
  assert.equal(resolveImageGroupSize(Number.NaN), 40)

  assert.equal(resolveImageGroupOverlap(undefined, 40), 10)
  assert.equal(resolveImageGroupOverlap(7, 40), 7)
  assert.equal(resolveImageGroupOverlap(-1, 40), 0)
  assert.equal(resolveImageGroupOverlap(80, 40), 32)

  assert.equal(resolveImageGroupMaxCount(undefined), 4)
  assert.equal(resolveImageGroupMaxCount(1), 2)
  assert.equal(resolveImageGroupMaxCount(6.8), 6)
  assert.equal(resolveImageGroupMaxCount(Number.NaN), 4)
})

test('图片圆角支持项目预设和受控像素值', () => {
  assert.deepEqual(resolveImageGroupRadius('none'), {
    className: 'rounded-none',
    style: undefined,
  })
  assert.deepEqual(resolveImageGroupRadius('md'), {
    className: 'rounded-md',
    style: undefined,
  })
  assert.deepEqual(resolveImageGroupRadius('full'), {
    className: 'rounded-full',
    style: undefined,
  })
  assert.deepEqual(resolveImageGroupRadius(12), {
    className: undefined,
    style: '12px',
  })
  assert.deepEqual(resolveImageGroupRadius(-4), {
    className: undefined,
    style: '0px',
  })
})

test('图片溢出时为隐藏图片保留一个可预览入口', () => {
  const normalized = normalizeImageGroupItems(images)
  const entries = createImageGroupEntries(normalized, 4)

  assert.equal(entries.length, 4)
  assert.deepEqual(entries.slice(0, 3).map(entry => entry.type), [
    'image',
    'image',
    'image',
  ])
  assert.deepEqual(entries[3], {
    hiddenCount: 2,
    previewIndex: 3,
    type: 'overflow',
  })

  const completeEntries = createImageGroupEntries(normalized.slice(0, 4), 4)
  assert.equal(completeEntries.length, 4)
  assert.ok(completeEntries.every(entry => entry.type === 'image'))
})

test('Tooltip 文案依次回退到 tooltip、alt 和图片序号', () => {
  assert.equal(resolveImageGroupTooltip(images[0], 0), '产品正面图')
  assert.equal(resolveImageGroupTooltip(images[1], 1), '旅行收纳包侧面')
  assert.equal(resolveImageGroupTooltip(images[2], 2), '第 3 张图片')
})

test('图片数据刷新时保留 URL 未变化项的加载状态并清除已变化项', () => {
  const previous = normalizeImageGroupItems([images[0], images[1]])
  const previousLoadedKeys = new Set(previous.map(resolveImageGroupStateKey))
  const refreshed = normalizeImageGroupItems([
    { ...images[0] },
    { ...images[1], src: '/fixtures/product-side-updated.svg' },
  ])

  assert.deepEqual(
    [...retainImageGroupStateKeys(previousLoadedKeys, refreshed)],
    [resolveImageGroupStateKey(refreshed[0]!)],
  )
  assert.notEqual(
    resolveImageGroupStateKey(previous[1]!),
    resolveImageGroupStateKey(refreshed[1]!),
  )
})

test('ImageGroup 复用 FaTooltip 和整组图片预览，并覆盖完整交互状态', () => {
  const source = readRelativeSource(
    '../../src/components/base/ImageGroup/index.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'ImageGroup' \}\)/u)
  assert.match(source, /import \{ useFaImagePreview \} from '@fantastic-admin\/components'/u)
  assert.match(source, /<FaTooltip/u)
  assert.match(source, /<template #content>/u)
  assert.match(
    source,
    /tooltip: \(props: \{ index: number, item: ImageGroupItem, total: number \}\) => unknown/u,
  )
  assert.match(source, /name="tooltip"[\s\S]*:item="entry\.image\.item"/u)
  assert.match(source, /:index="entry\.image\.index"/u)
  assert.match(source, /:total="normalizedItems\.length"/u)
  assert.match(source, /imagePreview\.open\(previewSources\.value,\s*index\)/u)
  assert.match(source, /data-slot="image-group"/u)
  assert.match(source, /role="group"/u)
  assert.match(source, /:aria-label="groupAriaLabel"/u)
  assert.match(source, /loading="lazy"/u)
  assert.match(source, /decoding="async"/u)
  assert.match(source, /@click\.stop/u)
  assert.match(source, /ArrowLeft/u)
  assert.match(source, /ArrowRight/u)
  assert.match(source, /@keydown="handleTriggerKeydown/u)
  assert.match(source, /prefers-reduced-motion:\s*reduce/u)
  assert.match(source, /data-image-state="error"/u)
  assert.match(source, /data-image-state="loading"/u)
  assert.match(source, /data-image-state="loaded"/u)
  assert.match(source, /loadedKeys\.value = retainImageGroupStateKeys/u)
  assert.match(source, /failedKeys\.value = retainImageGroupStateKeys/u)
  assert.match(source, /resolveImageGroupStateKey\(image\)/u)
  assert.doesNotMatch(
    source,
    /@\/api|@\/components\/business\/QsGoodTooltip|useApp\w*Store|linear-gradient|radial-gradient|purple|violet|indigo|fuchsia|system-ui|-apple-system|Inter|Roboto|Arial/u,
  )
})

test('ImageGroup 中文文档记录圆角、溢出、Tooltip 和表格接入契约', () => {
  const readme = readRelativeSource(
    '../../src/components/base/ImageGroup/README.md',
  )

  assert.match(readme, /ImageGroup/u)
  assert.match(readme, /FaTooltip/u)
  assert.match(readme, /useFaImagePreview/u)
  assert.match(readme, /radius/u)
  assert.match(readme, /maxCount/u)
  assert.match(readme, /cell-images/u)
  assert.match(readme, /mobile-row/u)
})
