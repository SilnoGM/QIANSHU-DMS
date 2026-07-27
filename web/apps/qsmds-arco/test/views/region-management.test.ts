import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面组合契约使用 Node.js 内置 runner。
import test from 'node:test'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('地区管理查询页使用单一 FaPageMain 和现有业务组件', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')

  assert.equal(source.match(/<FaPageMain\b/gu)?.length, 1)
  assert.match(source, /<FaPageHeader\b/u)
  assert.match(source, /<RegionScopeTree\b/u)
  assert.match(source, /<QsGenericDrawer\b/u)
  assert.match(source, /<QsGenericTable\b/u)
  assert.doesNotMatch(source, /<Fa(?:Table|Pagination|Card)\b|<A[A-Z]\w*\b/u)
  assert.doesNotMatch(source, /(?:gradient|#[\dA-Fa-f]{3,8}\b|rgba?\()/u)
})

test('桌面为 18rem 范围树加弹性列表，移动端使用底部抽屉', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')
  const drawerTag = source.match(/<QsGenericDrawer\b[\s\S]*?>/u)?.[0]

  assert.match(source, /md:grid-cols-\[18rem_minmax\(0,1fr\)\]/u)
  assert.match(source, /md:block/u)
  assert.match(source, /md:hidden/u)
  assert.ok(drawerTag)
  assert.match(drawerTag, /\bplacement="bottom"/u)
  assert.match(source, /aria-controls="region-scope-drawer"/u)
  assert.match(source, /:aria-expanded="scopeDrawerVisible"/u)
  assert.match(
    source,
    /<FaButton[\s\S]*?class="max-w-full min-h-11 md:hidden"[\s\S]*?aria-controls="region-scope-drawer"/u,
  )
})

test('地区表格完整受控并由页面持有查询请求边界', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')
  const tableTag = source.match(/<QsGenericTable\b[\s\S]*?>/u)?.[0]

  assert.ok(tableTag)
  assert.match(tableTag, /v-model:page="page"/u)
  assert.match(tableTag, /v-model:page-size="pageSize"/u)
  assert.match(tableTag, /v-model:search="search"/u)
  assert.match(tableTag, /v-model:filters="filters"/u)
  assert.match(tableTag, /v-model:sorting="sorting"/u)
  assert.match(tableTag, /:addable="false"/u)
  assert.match(tableTag, /@pagination-change="handlePaginationChange"/u)
  assert.match(source, /new AbortController\(\)/u)
  assert.match(source, /authEpoch/u)
  assert.match(source, /listRequestVersion/u)
  assert.match(source, /navigationRequestVersion/u)
  assert.doesNotMatch(source, /RegionSelectorProvider|selectorCache/u)
})

test('范围树保留停用节点选择能力并提供文字状态', () => {
  const source = readSource('../../src/views/system/basic-data/regions/region-scope-tree.vue')

  assert.match(source, /<FaTree\b/u)
  assert.match(source, /node-key="id"/u)
  assert.match(source, /自身停用|regionDisplayStatusLabel/u)
  assert.match(source, /继承停用|regionDisplayStatusLabel/u)
  assert.doesNotMatch(source, /:disabled=|disabled:\s*true/u)
})

test('异步导航到达后展开虚拟根并同步当前选择', () => {
  const source = readSource('../../src/views/system/basic-data/regions/region-scope-tree.vue')

  assert.match(
    source,
    /async function synchronizeTreeState\(expandRoot: boolean\)[\s\S]*?if \(expandRoot\) \{[\s\S]*?treeRef\.value\.expand\(\[ROOT_SCOPE_ID\]\)/u,
  )
  assert.match(
    source,
    /watch\(\s*treeData,\s*\(\) => \{[\s\S]*?synchronizeTreeState\(true\)/u,
  )
})

test('移动卡片遵循名称列显隐设置', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')

  assert.match(
    source,
    /<div\s+v-if="hasVisibleTableColumn\(visibleColumns, 'name'\)"\s+class="min-w-0"\s*>/u,
  )
})

test('页面在权限变化时中止旧请求且实际守卫先于响应写入', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')
  const loadNavigationSource = source.match(
    /async function loadNavigation\(\): Promise<void> \{[\s\S]*?\n\}/u,
  )?.[0]
  const loadRegionsSource = source.match(
    /async function loadRegions\(\): Promise<void> \{[\s\S]*?\n\}/u,
  )?.[0]

  assert.ok(loadNavigationSource)
  assert.ok(loadRegionsSource)
  assert.match(
    loadNavigationSource,
    /const response = await regionsApi\.management\.navigation[\s\S]*?if \(!navigationResponseIsCurrent[\s\S]*?return[\s\S]*?navigation\.value = response\.data/u,
  )
  assert.match(
    loadRegionsSource,
    /const response = await regionsApi\.management\.list[\s\S]*?if \(!listResponseIsCurrent[\s\S]*?return[\s\S]*?rows\.value = response\.data\.items/u,
  )
  assert.match(
    source,
    /watch\(\s*\[\(\) => appAccountStore\.authEpoch, canRead\],[\s\S]*?navigationAbortController\?\.abort\(\)[\s\S]*?listAbortController\?\.abort\(\)[\s\S]*?if \(nextCanRead\) \{[\s\S]*?refreshAll\(\)/u,
  )
  assert.match(
    source,
    /canApplyRegionResponse\(\{[\s\S]*?authorized: canRead\.value/u,
  )
})

test('地区页覆盖 reduced motion 与 44px 移动触控目标', () => {
  const pageSource = readSource('../../src/views/system/basic-data/regions/index.vue')
  const treeSource = readSource('../../src/views/system/basic-data/regions/region-scope-tree.vue')

  assert.match(pageSource, /class="region-management-page"/u)
  assert.match(
    pageSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.region-management-page :deep\(\.qs-generic-table \.animate-pulse\)[\s\S]*?animation: none !important/u,
  )
  assert.match(treeSource, /region-scope-loading-placeholder/u)
  assert.match(
    treeSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.region-scope-loading-placeholder[\s\S]*?animation: none !important/u,
  )
  assert.match(
    treeSource,
    /@media \(width <= 767px\)[\s\S]*?:deep\(\[role="treeitem"\] > div > button\)::before[\s\S]*?inset: -0\.875rem/u,
  )
})

test('Task 12 只提供查询与刷新，不提前实现地区写操作', () => {
  const source = [
    readSource('../../src/views/system/basic-data/regions/index.vue'),
    readSource('../../src/views/system/basic-data/regions/regions.logic.ts'),
    readSource('../../src/views/system/basic-data/regions/region-scope-tree.vue'),
  ].join('\n')

  assert.doesNotMatch(
    source,
    /management\.(?:create|update|enable|disable)|RegionFormModal|RegionStatusChangeModal|删除地区/u,
  )
})
