import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面组合契约使用 Node.js 内置 runner。
import test from 'node:test'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('货币管理面板只承载说明、通用表格与可供页头调用的创建动作', () => {
  const source = readSource('../../src/views/system/basic-data/currencies/index.vue')
  const tableStart = source.indexOf('<QsGenericTable')
  const preTableTemplate = source.slice(source.indexOf('<template>'), tableStart)

  assert.notEqual(tableStart, -1)
  assert.doesNotMatch(source, /<FaPageMain\b|<FaPageHeader\b/u)
  assert.doesNotMatch(preTableTemplate, /<FaButton\b|i-lucide:refresh-cw/u)
  assert.match(source, /defineExpose\(\{\s*openCreate,?\s*\}\)/u)
  assert.match(source, /<QsGenericTable\b/u)
  assert.doesNotMatch(source, /<Fa(?:Table|Pagination|Card)\b|gradient|#[\dA-Fa-f]{3,8}\b/u)
})

test('货币列表由服务端负责搜索、状态筛选与分页', () => {
  const source = readSource('../../src/views/system/basic-data/currencies/index.vue')
  const table = source.match(/<QsGenericTable\b[\s\S]*?>/u)?.[0]

  assert.ok(table)
  assert.match(table, /v-model:page="page"/u)
  assert.match(table, /v-model:page-size="pageSize"/u)
  assert.match(table, /v-model:search="search"/u)
  assert.match(table, /v-model:filters="filters"/u)
  assert.match(table, /@pagination-change="handlePaginationChange"/u)
  assert.match(table, /@filter-change="handleFilterChange"/u)
  assert.match(table, /@search="scheduleListRefresh"/u)
  assert.match(source, /currenciesApi\.currencies\.list/u)
  assert.match(source, /new AbortController\(\)/u)
})

test('创建编辑启停都由页面持有副作用并在成功后广播目录失效', () => {
  const source = readSource('../../src/views/system/basic-data/currencies/index.vue')

  assert.match(source, /currenciesApi\.currencies\.create/u)
  assert.match(source, /currenciesApi\.currencies\.update/u)
  assert.match(source, /currenciesApi\.currencies\.enable/u)
  assert.match(source, /currenciesApi\.currencies\.disable/u)
  assert.match(source, /invalidateCurrencyCatalogCache\(\{ broadcast: true \}\)/u)
  assert.match(source, /<CurrencyFormModal\b/u)
  assert.match(source, /<CurrencyStatusChangeModal\b/u)
})

test('页面按四项写权限守卫按钮，并把 CNY 显示为固定基准币', () => {
  const source = readSource('../../src/views/system/basic-data/currencies/index.vue')

  for (const permission of [
    'currencies:create',
    'currencies:update',
    'currencies:enable',
    'currencies:disable',
  ]) {
    assert.match(source, new RegExp(permission, 'u'))
  }
  assert.match(source, /resolveCurrencyActions/u)
  assert.match(source, /row\.original\.isBase/u)
})

test('CNY 仍可编辑名称符号与排序，仅 code、minorUnit 和启停保持固定', () => {
  const pageSource = readSource('../../src/views/system/basic-data/currencies/index.vue')
  const formSource = readSource(
    '../../src/views/system/basic-data/currencies/currency-form-modal.vue',
  )

  assert.doesNotMatch(
    pageSource,
    /!currencyActions\(currency\)\.canEdit \|\| currency\.isBase/u,
  )
  assert.doesNotMatch(
    pageSource,
    /payload\.mode === 'edit' && formTarget\.value\?\.isBase/u,
  )
  assert.doesNotMatch(formSource, /props\.currency\.isBase/u)
  assert.match(formSource, /:disabled="isEditing \|\| submitLocked"/u)
})

test('启用弹窗就地呈现汇率未配置错误且提交 expectedVersion', () => {
  const pageSource = readSource('../../src/views/system/basic-data/currencies/index.vue')
  const modalSource = readSource(
    '../../src/views/system/basic-data/currencies/currency-status-change-modal.vue',
  )

  assert.match(pageSource, /expectedVersion:\s*target\.version/u)
  assert.match(pageSource, /CURRENCY_EXCHANGE_RATE_REQUIRED/u)
  assert.match(modalSource, /请先到“货币汇率”的“当前汇率”标签页配置/u)
  assert.match(modalSource, /errorCode === 'CURRENCY_EXCHANGE_RATE_REQUIRED'/u)
})

test('移动卡片复用列显隐与操作插槽，并提供 44px 触控目标', () => {
  const source = readSource('../../src/views/system/basic-data/currencies/index.vue')

  assert.match(source, /<template #mobile-row=/u)
  assert.match(source, /hasVisibleTableColumn/u)
  assert.match(source, /<template #actions=/u)
  assert.match(source, /min-h-11[^"]*md:min-h-8/u)
})

test('未知写结果与过期版本会重新查询并替换弹窗中的版本上下文', () => {
  const pageSource = readSource('../../src/views/system/basic-data/currencies/index.vue')
  const formSource = readSource(
    '../../src/views/system/basic-data/currencies/currency-form-modal.vue',
  )

  assert.match(
    pageSource,
    /failure\.unknownResult \|\| failure\.code === 'CURRENCY_STATE_CHANGED'[\s\S]*?await loadCurrencies\(\)[\s\S]*?formTarget\.value = refreshedCurrency/u,
  )
  assert.match(
    pageSource,
    /failure\.unknownResult \|\| failure\.code === 'CURRENCY_STATE_CHANGED'[\s\S]*?await loadCurrencies\(\)[\s\S]*?statusTarget\.value = refreshedCurrency/u,
  )
  assert.match(formSource, /watch\(\s*\(\) => props\.currency/u)
})
