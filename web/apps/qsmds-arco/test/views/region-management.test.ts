import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面组合契约使用 Node.js 内置 runner。
import test from 'node:test'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('地区管理查询页使用无权面板与三个独立业务面板', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')
  const pageHeader = source.match(/<FaPageHeader\b[\s\S]*?<\/FaPageHeader>/u)?.[0]

  // 无权态单独一个面板，正常态为范围树、范围摘要和地区表格三个面板。
  assert.equal(source.match(/<FaPageMain\b/gu)?.length, 4)
  assert.match(source, /data-testid="region-management-workspace"/u)
  assert.match(source, /data-testid="region-scope-panel"/u)
  assert.match(source, /data-testid="region-scope-summary-panel"/u)
  assert.match(source, /data-testid="region-table-panel"/u)
  assert.ok(pageHeader)
  assert.equal(pageHeader.match(/<FaButton\b/gu)?.length, 1)
  assert.match(pageHeader, /@click="openCreate"/u)
  assert.doesNotMatch(pageHeader, /refresh-cw|>\s*刷新\s*</u)
  assert.match(source, /<RegionScopeTree\b/u)
  assert.match(source, /<QsGenericDrawer\b/u)
  assert.match(source, /<QsGenericTable\b/u)
  assert.doesNotMatch(source, /<Fa(?:Table|Pagination|Card)\b|<A[A-Z]\w*\b/u)
  assert.doesNotMatch(source, /(?:gradient|#[\dA-Fa-f]{3,8}\b|rgba?\()/u)
})

test('桌面为加宽范围树加两个右侧面板，移动端使用底部抽屉', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')
  const drawerTag = source.match(/<QsGenericDrawer\b[\s\S]*?>/u)?.[0]

  assert.match(source, /md:grid-cols-\[20rem_minmax\(0,1fr\)\]/u)
  assert.match(source, /2xl:grid-cols-\[22rem_minmax\(0,1fr\)\]/u)
  assert.match(source, /gap-4[\s\S]{0,160}xl:gap-5/u)
  assert.match(source, /md:row-span-2/u)
  assert.match(source, /md:flex/u)
  assert.match(source, /md:hidden/u)
  assert.doesNotMatch(source, /md:pr-5|md:border-r/u)
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
    /watch\(\s*\[\(\) => appAccountStore\.authEpoch, canRead\],[\s\S]*?navigationAbortController\?\.abort\(\)[\s\S]*?listAbortController\?\.abort\(\)[\s\S]*?if \(!nextCanRead\) \{[\s\S]*?return[\s\S]*?refreshAll\(\)/u,
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

test('地区维护按四项权限组合，并在没有行级写权限时明确显示仅查看', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')

  for (const permission of [
    'regions:create',
    'regions:update',
    'regions:enable',
    'regions:disable',
  ]) {
    assert.match(source, new RegExp(permission, 'u'))
  }
  assert.match(source, /resolveRegionAdminActions/u)
  assert.match(source, /<template #actions="\{ row: region \}">/u)
  assert.match(source, /仅查看/u)
  assert.doesNotMatch(source, /management\.delete|删除地区|regions:delete/u)
})

test('页面组合纯受控表单与启停弹窗，API 与副作用仍由业务页持有', () => {
  const source = [
    readSource('../../src/views/system/basic-data/regions/index.vue'),
  ].join('\n')

  assert.match(source, /import RegionFormModal from '.\/region-form-modal\.vue'/u)
  assert.match(source, /import RegionStatusChangeModal from '.\/region-status-change-modal\.vue'/u)
  assert.match(source, /regionsApi\.management\.create/u)
  assert.match(source, /regionsApi\.management\.update/u)
  assert.match(source, /regionsApi\.management\.enable/u)
  assert.match(source, /regionsApi\.management\.disable/u)
  assert.match(source, /<RegionFormModal\b/u)
  assert.match(source, /<RegionStatusChangeModal\b/u)
})

test('mutation 只对 network 做最终状态对账并在成功后联动 selector cache 与 Toast', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')

  assert.match(source, /failure\.unknownResult/u)
  assert.match(source, /reconcileUnknownCreate/u)
  assert.match(source, /reconcileUnknownUpdate/u)
  assert.match(source, /reconcileUnknownStatus/u)
  assert.match(source, /invalidateRegionSelectorCache\(\{ broadcast: true \}\)/u)
  assert.match(source, /useQsToast\(\)/u)
  assert.match(source, /操作结果未知，请刷新后确认/u)
  assert.match(
    source,
    /formSubmitting\.value = false[\s\S]*?await nextTick\(\)[\s\S]*?formVisible\.value = false/u,
  )
  assert.match(
    source,
    /statusSubmitting\.value = false[\s\S]*?await nextTick\(\)[\s\S]*?statusVisible\.value = false/u,
  )
})

test('桌面与移动卡片复用动作插槽，按钮可访问名称包含目标地区', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')

  assert.match(source, /<template #actions="\{ row: region \}">/u)
  assert.match(source, /:aria-label="`编辑地区 \$\{region\.name\}`"/u)
  assert.match(source, /:aria-label="`启用地区 \$\{region\.name\}`"/u)
  assert.match(source, /:aria-label="`停用地区 \$\{region\.name\}`"/u)
  assert.match(source, /min-h-11[^"]*md:min-h-8/u)
})

test('动态撤销 regions:read 时立即隐藏维护上下文并阻止新的写请求', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')

  assert.match(
    source,
    /function openCreate\(\): void \{\s*if \(!canRead\.value \|\| !canCreate\.value\)/u,
  )
  assert.match(
    source,
    /function openEdit\(region: RegionDto\): void \{\s*if \(!canRead\.value \|\| !regionActions\(region\)\.canEdit\)/u,
  )
  assert.match(
    source,
    /function openStatusChange\([\s\S]*?if \(\s*!canRead\.value/u,
  )
  assert.match(
    source,
    /async function handleFormSubmit[\s\S]*?if \(\s*!canRead\.value/u,
  )
  assert.match(
    source,
    /async function handleStatusSubmit[\s\S]*?if \(\s*!canRead\.value/u,
  )
  assert.match(
    source,
    /function clearMutationContexts\(\): void \{[\s\S]*?formVisible\.value = false[\s\S]*?statusVisible\.value = false[\s\S]*?formTarget\.value = null[\s\S]*?statusTarget\.value = null/u,
  )
  assert.match(
    source,
    /if \(identityChanged \|\| !nextCanRead\) \{[\s\S]*?clearMutationContexts\(\)/u,
  )
  assert.match(source, /<RegionFormModal\s+v-if="canRead"/u)
  assert.match(source, /<RegionStatusChangeModal\s+v-if="canRead"/u)
})

test('authEpoch 切换身份时即使新身份可读也必须清空旧弹窗目标', () => {
  const source = readSource('../../src/views/system/basic-data/regions/index.vue')

  assert.match(
    source,
    /\(\[nextAuthEpoch, nextCanRead\], \[previousAuthEpoch\]\) => \{/u,
  )
  assert.match(
    source,
    /const identityChanged = nextAuthEpoch !== previousAuthEpoch/u,
  )
  assert.match(
    source,
    /if \(identityChanged \|\| !nextCanRead\) \{[\s\S]*?clearMutationContexts\(\)/u,
  )
  assert.match(
    source,
    /if \(!nextCanRead\) \{[\s\S]*?return[\s\S]*?refreshAll\(\)/u,
  )
})
