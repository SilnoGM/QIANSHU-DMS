import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面骨架使用 Node.js 内置 runner 检查静态组合契约。
import test from 'node:test'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const pageSource = readSource(
  '../../src/views/system/basic-data/dictionaries/index.vue',
)
const itemTableSource = readSource(
  '../../src/views/system/basic-data/dictionaries/dictionary-item-table.vue',
)

test('字典管理只使用一层 Fa 页面容器与非对称主从骨架', () => {
  assert.equal(pageSource.match(/<FaPageHeader\b/gu)?.length, 1)
  assert.equal(pageSource.match(/<FaPageMain\b/gu)?.length, 1)
  assert.match(pageSource, /md:grid-cols-\[18rem_minmax\(0,1fr\)\]/u)
  assert.match(pageSource, /Noto Sans SC|qs-type-/u)
  assert.doesNotMatch(pageSource, /(?:violet|purple|indigo|fuchsia)/iu)
  assert.doesNotMatch(pageSource, /\p{Extended_Pictographic}/gu)
  assert.doesNotMatch(pageSource, /sm:min-h-9/u)
})

test('Type 列表组件组合服务端搜索、状态筛选、分页与原生按钮语义', () => {
  const source = readSource(
    '../../src/views/system/basic-data/dictionaries/dictionary-type-list.vue',
  )

  assert.match(source, /<FaInput\b/u)
  assert.match(source, /const searchDraft = ref\(props\.search\)/u)
  assert.match(source, /emit\('search', searchDraft\.value\)/u)
  assert.doesNotMatch(source, /const searchModel = computed/u)
  assert.match(source, /<FaSelect\b/u)
  assert.match(source, /<FaPagination\b/u)
  assert.match(source, /<FaTag\b/u)
  assert.match(source, /border-primary\/30 bg-primary\/10 text-primary/u)
  assert.match(source, /border-border bg-muted text-muted-foreground/u)
  assert.match(source, /<ul[^>]*aria-label="字典类型"/u)
  assert.doesNotMatch(source, /<button[^>]+role="listitem"/u)
  assert.match(source, /系统尚未配置字典类型/u)
  assert.match(source, /没有匹配当前条件的字典类型/u)
  assert.match(pageSource, /<FaTag[\s\S]{0,400}selectedType\.enabled/u)
})

test('页面读取权限与身份 epoch 共同形成受保护数据边界', () => {
  assert.match(pageSource, /auth\('dictionaries:read'\)/u)
  assert.match(
    pageSource,
    /watch\(\s*\[\(\) => appAccountStore\.authEpoch, canRead\]/u,
  )
  assert.match(pageSource, /resolveDictionaryAccessTransition/u)
  assert.match(pageSource, /shouldAbortQueries/u)
  assert.match(pageSource, /shouldClearProtectedData/u)
  assert.match(pageSource, /shouldCloseOverlays/u)
})

test('Type 与 Item 使用独立 AbortController 和单调 request version', () => {
  for (const prefix of ['type', 'item']) {
    assert.match(pageSource, new RegExp(`let ${prefix}AbortController`, 'u'))
    assert.match(pageSource, new RegExp(`let ${prefix}RequestVersion`, 'u'))
    assert.match(pageSource, new RegExp(`${prefix}AbortController\\?\\.abort\\(\\)`, 'u'))
  }
  assert.match(pageSource, /canApplyDictionaryQueryResponse/u)
  assert.match(pageSource, /canApplyDictionaryItemResponse/u)
  assert.match(pageSource, /isDictionaryAbortError/u)
  assert.match(pageSource, /dictionariesApi\.types\.list\(/u)
  assert.match(pageSource, /dictionariesApi\.items\.list\(/u)
  assert.match(pageSource, /onBeforeUnmount/u)
})

test('切换 Type 先作废旧 Item 请求且选择只保存在页面本地状态', () => {
  assert.match(
    pageSource,
    /function selectDictionaryType[\s\S]{0,500}abortItemQuery\(\)[\s\S]{0,300}createDictionarySelection/u,
  )
  assert.doesNotMatch(pageSource, /\?code=/u)
  assert.doesNotMatch(pageSource, /route\.query|router\.(?:push|replace)/u)
  assert.match(pageSource, /selectDictionaryType\(nextTypeId, false\)/u)
  assert.match(pageSource, /if \(closeDrawer\) \{\s*typeDrawerOpen\.value = false/u)
  assert.match(
    pageSource,
    /if \(typeId === selectedTypeId\.value\)[\s\S]{0,180}return/u,
  )
})

test('撤权与身份切换会清空受保护数据并关闭真实底部 Drawer', () => {
  assert.match(pageSource, /function clearProtectedData/u)
  assert.match(pageSource, /dictionaryTypes\.value = \[\]/u)
  assert.match(pageSource, /dictionaryItems\.value = \[\]/u)
  assert.match(pageSource, /typeDrawerOpen\.value = false/u)
  assert.match(pageSource, /<QsGenericDrawer\b/u)
  assert.match(pageSource, /v-model="typeDrawerOpen"/u)
  assert.match(pageSource, /placement="bottom"/u)
  assert.match(pageSource, /aria-controls="dictionary-type-drawer"/u)
  assert.match(pageSource, /:aria-expanded="typeDrawerOpen"/u)
  assert.match(pageSource, /id="dictionary-type-drawer"/u)
})

test('Type 创建编辑启停按四项权限双重守卫并使用领域 Modal', () => {
  for (const permission of [
    'dictionaries:create',
    'dictionaries:update',
    'dictionaries:enable',
    'dictionaries:disable',
  ]) {
    assert.match(pageSource, new RegExp(`auth\\('${permission}'\\)`, 'u'))
  }

  assert.match(pageSource, /import DictionaryTypeFormModal/u)
  assert.match(pageSource, /import DictionaryStatusChangeModal/u)
  assert.match(pageSource, /<DictionaryTypeFormModal\b/u)
  assert.match(pageSource, /<DictionaryStatusChangeModal\b/u)
  assert.equal(
    pageSource.match(/:submission-blocked="managementState\.mutation === 'error'"/gu)?.length,
    3,
  )
  assert.match(pageSource, /dictionariesApi\.types\.create/u)
  assert.match(pageSource, /dictionariesApi\.types\.update/u)
  assert.match(pageSource, /dictionariesApi\.types\.enable/u)
  assert.match(pageSource, /dictionariesApi\.types\.disable/u)
  assert.match(pageSource, /resolveDictionaryTypeActions/u)
})

test('可信成功与可能已提交的网络未知结果都精确失效 Catalog', () => {
  assert.match(pageSource, /DICTIONARY_TYPE_STATE_CHANGED/u)
  assert.match(pageSource, /reconcileUnknownTypeCreate/u)
  assert.match(pageSource, /reconcileUnknownTypeMutation/u)
  assert.match(pageSource, /dictionariesApi\.types\.get/u)
  assert.match(pageSource, /invalidateDictionaryCatalogCache\(\{[\s\S]*?broadcast: true,[\s\S]*?code,[\s\S]*?\}\)/u)
  assert.match(pageSource, /canApplyDictionaryMutationResult/u)
  assert.equal(
    pageSource.match(/invalidateMutationCatalog\(context, response\.data\.code\)/gu)?.length,
    2,
  )
  assert.match(
    pageSource,
    /invalidateMutationCatalog\(context, response\.data\.code\)[\s\S]{0,160}mutationResultIsCurrent/u,
  )
  assert.equal(
    pageSource.match(/invalidatePossiblyChangedCatalog\(\s*context,/gu)?.length,
    4,
  )
  assert.equal(
    pageSource.match(/invalidateMutationCatalog\(context, confirmed\.code\)/gu)?.length,
    2,
  )
  assert.match(
    pageSource,
    /const confirmed = submission\.mode === 'edit'[\s\S]{0,500}invalidateMutationCatalog\(context, confirmed\.code\)/u,
  )
  assert.doesNotMatch(
    pageSource,
    /catch[\s\S]{0,500}dictionariesApi\.types\.(?:create|update|enable|disable)/u,
  )
})

test('Task 14 使用 QsGenericTable 完成 Item 查询、桌面列与移动卡片组合', () => {
  assert.match(pageSource, /import DictionaryItemTable/u)
  assert.match(pageSource, /<DictionaryItemTable\b/u)
  assert.match(itemTableSource, /import QsGenericTable/u)
  assert.match(itemTableSource, /<QsGenericTable\b/u)
  assert.match(pageSource, /v-model:page="itemPage"/u)
  assert.match(pageSource, /v-model:page-size="itemPageSize"/u)
  assert.match(pageSource, /v-model:search="itemSearch"/u)
  assert.match(pageSource, /v-model:filters="itemFilters"/u)
  assert.match(pageSource, /v-model:sorting="itemSorting"/u)
  assert.match(itemTableSource, /#cell-value/u)
  assert.match(itemTableSource, /#cell-ownStatus/u)
  assert.match(itemTableSource, /#cell-effectiveStatus/u)
  assert.match(itemTableSource, /#mobile-row/u)
  assert.match(itemTableSource, /effectiveEnabled/u)
  assert.match(itemTableSource, /resolveDictionaryItemEmptyKind/u)
  assert.match(itemTableSource, /:page-size-options="\[20, 50, 100\]"/u)
  assert.match(itemTableSource, /:addable="canCreate"/u)
  assert.match(itemTableSource, /add-label="新增条目"/u)
  assert.match(itemTableSource, /@filter-change=/u)
  assert.match(itemTableSource, /@pagination-change=/u)
  assert.match(itemTableSource, /@sorting-change=/u)
  assert.match(itemTableSource, /hasVisibleTableColumn/u)
  assert.match(itemTableSource, /import CopyCellButton/u)
  assert.match(itemTableSource, /\[&_button\]:size-11/u)
  assert.doesNotMatch(itemTableSource, /md:min-h-8/u)
  assert.doesNotMatch(itemTableSource, /(?:border|bg|text)-warning/u)
  assert.doesNotMatch(itemTableSource, /<FaSwitch|<ASwitch|<Switch\b/iu)
})

test('Task 14 Item 创建编辑启停复用权限、版本与领域 Modal', () => {
  assert.match(pageSource, /import DictionaryItemFormModal/u)
  assert.match(pageSource, /<DictionaryItemFormModal\b/u)
  assert.match(pageSource, /<DictionaryStatusChangeModal\b/u)
  assert.match(pageSource, /dictionariesApi\.items\.create/u)
  assert.match(pageSource, /dictionariesApi\.items\.update/u)
  assert.match(pageSource, /dictionariesApi\.items\.enable/u)
  assert.match(pageSource, /dictionariesApi\.items\.disable/u)
  assert.match(pageSource, /expectedVersion/u)
  assert.match(
    pageSource,
    /submission\.data\.expectedVersion !== operationTarget\.version/u,
  )
  assert.match(pageSource, /dictionaryItemUpdateHasChanges/u)
  assert.match(pageSource, /matchesDictionaryItemUpdateResult/u)
  assert.match(pageSource, /refreshStateChangedItem/u)
  assert.match(pageSource, /refreshItemStatusConstraint/u)
  assert.match(
    pageSource,
    /dictionaryItems\.value = \[\][\s\S]{0,120}itemTotal\.value = 0[\s\S]{0,160}setItemQuery\(\{ type: 'failure' \}\)/u,
  )
  assert.match(
    pageSource,
    /failure\.code === 'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED'/u,
  )
  assert.match(pageSource, /openCreateItem/u)
  assert.match(pageSource, /openEditItem/u)
  assert.match(pageSource, /openItemStatusChange/u)
})

test('Task 14 仍不越界实现公共选择器、删除或 Task 15 历史值适配', () => {
  assert.doesNotMatch(pageSource, /QsDictionarySelect/u)
  assert.doesNotMatch(pageSource, /dictionariesApi\.items\.delete/u)
  assert.doesNotMatch(pageSource, /deleteDictionaryItem|removeDictionaryItem/u)
  assert.doesNotMatch(pageSource, /historicalValue|unknownValueAdapter/u)
})
