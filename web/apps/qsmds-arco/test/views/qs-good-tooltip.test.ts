import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 产品提示组件使用 Node.js 内置 runner 校验源码与文档契约。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('QsGoodTooltip 以 FaTooltip 为内核并保持窄公共契约', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGoodTooltip/index.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'QsGoodTooltip' \}\)/u)
  assert.match(source, /imageSrc\?: string \| null/u)
  assert.match(source, /imageAlt\?: string/u)
  assert.match(source, /type GoodTooltipImageFit = 'contain' \| 'cover'/u)
  assert.match(source, /imageFit\?: GoodTooltipImageFit/u)
  assert.match(source, /delay\?: number/u)
  assert.match(source, /side\?: GoodTooltipSide/u)
  assert.match(source, /align\?: GoodTooltipAlign/u)
  assert.match(source, /disabled\?: boolean/u)
  assert.match(source, /<FaTooltip/u)
  assert.match(source, /:delay="delay"/u)
  assert.match(source, /useMediaQuery\('\(max-width: 639px\)'\)/u)
  assert.match(source, /const resolvedSide = computed/u)
  assert.match(source, /:side="resolvedSide"/u)
  assert.match(source, /:align="align"/u)
  assert.match(source, /:disabled="disabled"/u)
  assert.match(source, /<slot\s*\/>/u)
  assert.match(source, /<template #content>/u)
  assert.match(source, /<slot name="content">/u)
  assert.doesNotMatch(
    source,
    /defineEmits|v-model:open|good\?:|spu\?:|sku\?:|contentClass|tooltipType/u,
  )
})

test('QsGoodTooltip 固定左图右文布局并覆盖空图和加载失败', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGoodTooltip/index.vue',
  )

  assert.match(source, /data-slot="good-tooltip-content"/u)
  assert.match(source, /grid-cols-\[4\.5rem_minmax\(0,1fr\)\]/u)
  assert.match(source, /data-slot="good-tooltip-image"/u)
  assert.match(source, /data-slot="good-tooltip-info"/u)
  assert.match(source, /data-slot="good-tooltip-image-fallback"/u)
  assert.match(source, /watch\(\s*\(\) => props\.imageSrc/u)
  assert.match(source, /@error="handleImageError"/u)
  assert.match(source, /loading="lazy"/u)
  assert.match(source, /decoding="async"/u)
  assert.match(source, /暂无产品图片/u)
  assert.match(source, /暂无产品信息/u)
  assert.doesNotMatch(
    source,
    /@\/api|useApp\w*Store|linear-gradient|radial-gradient|purple|violet|indigo|fuchsia/u,
  )
})

test('QsGoodTooltip 中文文档说明只读边界和 ImageGroup 互斥组合', () => {
  const readme = readRelativeSource(
    '../../src/components/business/QsGoodTooltip/README.md',
  )

  assert.match(readme, /QsGoodTooltip/u)
  assert.match(readme, /FaTooltip/u)
  assert.match(readme, /SPU/u)
  assert.match(readme, /SKU/u)
  assert.match(readme, /content/u)
  assert.match(readme, /:tooltip="false"/u)
  assert.match(readme, /单个稳定根节点/u)
  assert.match(readme, /可聚焦/u)
  assert.match(readme, /FaPopover/u)
  assert.match(readme, /触屏/u)
})
