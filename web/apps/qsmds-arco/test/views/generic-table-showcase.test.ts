import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 展示页源码契约使用 Node.js 内置 runner。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('业务组件页面展示通用表格及金额汇总自定义组件', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/index.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/GenericTableShowcase.vue',
  )

  assert.match(pageSource, /import GenericTableShowcase from '.\/components\/GenericTableShowcase\.vue'/u)
  assert.match(pageSource, /stage-label="首个组件已展示"/u)
  assert.match(pageSource, /<GenericTableShowcase\s*\/>/u)
  assert.match(showcaseSource, /<QsGenericTable/u)
  assert.match(showcaseSource, /component: AmountDisplay/u)
  assert.match(showcaseSource, /currency: 'CNY'/u)
  assert.match(showcaseSource, /20, 50, 100, 200/u)
  assert.match(showcaseSource, /#mobile-row/u)
  assert.doesNotMatch(showcaseSource, /@\/api|useApp\w*Store/u)
})
