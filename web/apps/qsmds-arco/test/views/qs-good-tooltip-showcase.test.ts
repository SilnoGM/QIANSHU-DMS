import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 产品提示 Showcase 使用 Node.js 内置 runner 校验页面组合契约。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('产品提示拥有独立业务组件页面并展示核心边界状态', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/good-tooltip.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/GoodTooltipShowcase.vue',
  )

  assert.match(pageSource, /defineOptions\(\{ name: 'ComponentLibraryQsGoodTooltip' \}\)/u)
  assert.match(pageSource, /title="产品提示"/u)
  assert.match(pageSource, /route-path="\/component-library\/business\/good-tooltip"/u)
  assert.match(pageSource, /<GoodTooltipShowcase\s*\/>/u)

  assert.match(showcaseSource, /import QsGoodTooltip from '@\/components\/business\/QsGoodTooltip\/index\.vue'/u)
  assert.match(showcaseSource, /<QsGoodTooltip/u)
  assert.match(showcaseSource, /<template #content>/u)
  assert.match(showcaseSource, /正常产品图/u)
  assert.match(showcaseSource, /无产品图/u)
  assert.match(showcaseSource, /图片失败/u)
  assert.match(showcaseSource, /禁用状态/u)
  assert.match(showcaseSource, /SPU-/u)
  assert.match(showcaseSource, /SKU-/u)
  assert.doesNotMatch(
    showcaseSource,
    /@\/api|useApp\w*Store|linear-gradient|radial-gradient|purple|violet|indigo|fuchsia/u,
  )
})

test('图片组页面保留原示例并追加 QsGoodTooltip 互斥组合示例', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/basic/image-group.vue',
  )
  const combinationSource = readRelativeSource(
    '../../src/views/component_library/basic/components/GoodTooltipImageGroupShowcase.vue',
  )

  assert.match(pageSource, /import ImageGroupShowcase from '.\/components\/ImageGroupShowcase\.vue'/u)
  assert.match(pageSource, /import GoodTooltipImageGroupShowcase from '.\/components\/GoodTooltipImageGroupShowcase\.vue'/u)
  assert.match(
    pageSource,
    /<ImageGroupShowcase\s*\/>[\s\S]*<GoodTooltipImageGroupShowcase\s*\/>/u,
  )

  assert.match(combinationSource, /import ImageGroup from '@\/components\/base\/ImageGroup\/index\.vue'/u)
  assert.match(combinationSource, /import QsGoodTooltip from '@\/components\/business\/QsGoodTooltip\/index\.vue'/u)
  assert.equal((combinationSource.match(/<QsGoodTooltip/gu) ?? []).length, 2)
  assert.equal((combinationSource.match(/^\s+:tooltip="false"$/gmu) ?? []).length, 2)
  assert.equal((combinationSource.match(/^\s+tabindex="0"$/gmu) ?? []).length, 2)
  assert.match(combinationSource, /SPU 信息/u)
  assert.match(combinationSource, /SKU 信息/u)
  assert.match(combinationSource, /<template #content>/u)
  assert.doesNotMatch(
    combinationSource,
    /@\/api|useApp\w*Store|linear-gradient|radial-gradient|purple|violet|indigo|fuchsia/u,
  )
})
