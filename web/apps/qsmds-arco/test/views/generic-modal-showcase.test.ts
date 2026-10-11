import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 展示页源码契约使用 Node.js 内置 runner。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('通用模态框使用独立展示页并与其他业务组件页面隔离', () => {
  const modalPageSource = readRelativeSource(
    '../../src/views/component_library/business/generic-modal.vue',
  )
  const tablePageSource = readRelativeSource(
    '../../src/views/component_library/business/index.vue',
  )
  const drawerPageSource = readRelativeSource(
    '../../src/views/component_library/business/generic-drawer.vue',
  )

  assert.match(modalPageSource, /defineOptions\(\{ name: 'ComponentLibraryGenericModal' \}\)/u)
  assert.match(modalPageSource, /import GenericModalShowcase from '.\/components\/GenericModalShowcase\.vue'/u)
  assert.match(modalPageSource, /title="通用模态框"/u)
  assert.match(modalPageSource, /route-path="\/component-library\/business\/generic-modal"/u)
  assert.match(modalPageSource, /<GenericModalShowcase\s*\/>/u)
  assert.doesNotMatch(modalPageSource, /Generic(Table|Drawer)Showcase/u)
  assert.doesNotMatch(tablePageSource, /GenericModalShowcase/u)
  assert.doesNotMatch(drawerPageSource, /GenericModalShowcase/u)
})

test('模态框展示覆盖尺寸、稳定状态、长内容滚动和关闭守卫且不直接使用底层模态框', () => {
  const source = readRelativeSource(
    '../../src/views/component_library/business/components/GenericModalShowcase.vue',
  )

  assert.match(source, /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u)
  assert.match(source, /<QsGenericModal/u)
  assert.doesNotMatch(source, /<FaModal|<AModal/u)
  assert.match(source, /'sm', 'md', 'lg', 'xl', '2xl', '3xl'/u)
  assert.match(source, /'ready', 'long-content', 'loading', 'error'/u)
  assert.match(source, /data-testid="generic-modal-long-content"/u)
  assert.match(source, /v-for="item in longContentItems"/u)
  assert.match(source, /Header 与 Footer 保持固定，仅正文区域滚动/u)
  assert.match(source, /:loading=/u)
  assert.match(source, /:submitting=/u)
  assert.match(source, /:error=/u)
  assert.match(source, /#header-leading/u)
  assert.match(source, /#header-extra/u)
  assert.match(source, /#error-actions/u)
  assert.match(source, /#footer/u)
  assert.match(source, /before-close/u)
  assert.match(source, /data-testid="generic-modal-trigger"/u)
  assert.match(source, /data-testid="generic-modal-close-reason"/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
})
