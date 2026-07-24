import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 展示页源码契约使用 Node.js 内置 runner。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('通用抽屉使用独立展示页并与通用表格页面隔离', () => {
  const drawerPageSource = readRelativeSource(
    '../../src/views/component_library/business/generic-drawer.vue',
  )
  const tablePageSource = readRelativeSource(
    '../../src/views/component_library/business/index.vue',
  )

  assert.match(drawerPageSource, /defineOptions\(\{ name: 'ComponentLibraryGenericDrawer' \}\)/u)
  assert.match(drawerPageSource, /import GenericDrawerShowcase from '.\/components\/GenericDrawerShowcase\.vue'/u)
  assert.match(drawerPageSource, /title="通用抽屉"/u)
  assert.match(drawerPageSource, /route-path="\/component-library\/business\/generic-drawer"/u)
  assert.match(drawerPageSource, /<GenericDrawerShowcase\s*\/>/u)
  assert.doesNotMatch(drawerPageSource, /GenericTableShowcase/u)
  assert.doesNotMatch(tablePageSource, /GenericDrawerShowcase/u)
})

test('抽屉展示覆盖尺寸、方向和稳定状态且不直接使用底层抽屉', () => {
  const source = readRelativeSource(
    '../../src/views/component_library/business/components/GenericDrawerShowcase.vue',
  )

  assert.match(source, /import QsGenericDrawer from '@\/components\/business\/QsGenericDrawer\/index\.vue'/u)
  assert.match(source, /<QsGenericDrawer/u)
  assert.doesNotMatch(source, /<FaDrawer|<ADrawer/u)
  assert.match(source, /'sm', 'md', 'lg', 'xl'/u)
  assert.match(source, /'right', 'bottom'/u)
  assert.match(source, /:loading=/u)
  assert.match(source, /:submitting=/u)
  assert.match(source, /:error=/u)
  assert.match(source, /#header-leading/u)
  assert.match(source, /#header-extra/u)
  assert.match(source, /#error-actions/u)
  assert.match(source, /#footer/u)
  assert.match(source, /before-close/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
})
