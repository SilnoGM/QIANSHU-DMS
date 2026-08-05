import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面组合与纯逻辑契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildCurrencyExchangeRateQuery,
  buildCurrencyExchangeRateTabs,
  resolveCurrencyExchangeRateTab,
} from '../../src/views/system/basic-data/currency-exchange-rate/currency-exchange-rate.logic'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('货币汇率标签按两项读取权限独立收敛', () => {
  assert.deepEqual(
    buildCurrencyExchangeRateTabs({
      canReadCurrencies: true,
      canReadExchangeRates: true,
    }),
    [
      {
        icon: 'i-lucide:coins',
        label: '货币管理',
        value: 'currencies',
      },
      {
        icon: 'i-lucide:arrow-left-right',
        label: '当前汇率',
        value: 'exchange-rates',
      },
    ],
  )
  assert.deepEqual(
    buildCurrencyExchangeRateTabs({
      canReadCurrencies: false,
      canReadExchangeRates: true,
    }).map(tab => tab.value),
    ['exchange-rates'],
  )
  assert.deepEqual(
    buildCurrencyExchangeRateTabs({
      canReadCurrencies: false,
      canReadExchangeRates: false,
    }),
    [],
  )
})

test('路由 Tab 只能落到当前身份可读的业务区域', () => {
  const allPermissions = {
    canReadCurrencies: true,
    canReadExchangeRates: true,
  }
  const exchangeRateOnly = {
    canReadCurrencies: false,
    canReadExchangeRates: true,
  }

  assert.equal(
    resolveCurrencyExchangeRateTab('exchange-rates', allPermissions),
    'exchange-rates',
  )
  assert.equal(
    resolveCurrencyExchangeRateTab('invalid', allPermissions),
    'currencies',
  )
  assert.equal(
    resolveCurrencyExchangeRateTab(undefined, exchangeRateOnly),
    'exchange-rates',
  )
  assert.equal(
    resolveCurrencyExchangeRateTab('currencies', exchangeRateOnly),
    'exchange-rates',
  )
  assert.equal(
    resolveCurrencyExchangeRateTab(undefined, {
      canReadCurrencies: false,
      canReadExchangeRates: false,
    }),
    null,
  )
})

test('货币 Tab 使用规范地址，当前汇率 Tab 使用可刷新 query', () => {
  assert.deepEqual(
    buildCurrencyExchangeRateQuery(
      { source: 'bookmark', tab: 'exchange-rates' },
      'currencies',
    ),
    { source: 'bookmark' },
  )
  assert.deepEqual(
    buildCurrencyExchangeRateQuery(
      { source: 'bookmark', tab: 'invalid' },
      'exchange-rates',
    ),
    { source: 'bookmark', tab: 'exchange-rates' },
  )
})

test('合并页只保留一个页面骨架并使用 FaTabs 懒加载两个业务面板', () => {
  const source = readSource(
    '../../src/views/system/basic-data/currency-exchange-rate/index.vue',
  )
  const tabChangeHandler = source.match(
    /function handleTabChange[\s\S]*?\n\}\n/u,
  )?.[0]

  assert.equal(source.match(/<FaPageHeader\b/gu)?.length, 1)
  assert.equal(source.match(/<FaPageMain\b/gu)?.length, 1)
  assert.equal(source.match(/<FaTabs\b/gu)?.length, 1)
  assert.ok(tabChangeHandler)
  assert.doesNotMatch(tabChangeHandler, /activeTab\.value = nextTab/u)
  assert.match(source, /onActivated\(syncActiveTab\)/u)
  assert.doesNotMatch(
    source,
    /watch\(\s*\[\(\) => route\.query\.tab/u,
  )
  assert.match(source, /title="货币汇率"/u)
  assert.match(source, /data-testid="currency-exchange-rate-tabs"/u)
  assert.match(
    source,
    /defineAsyncComponent\(\s*\(\) => import\('\.\.\/currencies\/index\.vue'\),?\s*\)/u,
  )
  assert.match(
    source,
    /defineAsyncComponent\(\s*\(\) => import\('\.\.\/exchange-rates\/index\.vue'\),?\s*\)/u,
  )
  assert.match(
    source,
    /<template #currencies>\s*<CurrencyManagementPanel[\s\S]{0,160}v-if="activeTab === 'currencies'"[\s\S]{0,120}ref="currencyManagementPanelRef"/u,
  )
  assert.match(
    source,
    /<template #exchange-rates>\s*<ExchangeRateManagementPanel v-if="activeTab === 'exchange-rates'"/u,
  )
  assert.match(source, /@update:model-value="handleTabChange"/u)
  assert.doesNotMatch(source, /currenciesApi|<Fa(?:Table|Pagination|Card)\b/u)
  assert.doesNotMatch(source, /gradient|#[\dA-Fa-f]{3,8}\b|rgba?\(/u)
})

test('新增货币只在货币 Tab 的唯一页头展示标准尺寸操作', () => {
  const source = readSource(
    '../../src/views/system/basic-data/currency-exchange-rate/index.vue',
  )
  const pageHeader = source.match(
    /<FaPageHeader\b[\s\S]*?<\/FaPageHeader>/u,
  )?.[0]

  assert.ok(pageHeader)
  assert.match(pageHeader, /新增货币/u)
  assert.doesNotMatch(pageHeader, /size="sm"/u)
  assert.match(pageHeader, /class="min-h-11 md:min-h-9"/u)
  assert.doesNotMatch(pageHeader, /刷新|i-lucide:refresh-cw/u)
  assert.match(source, /auth\('currencies:create'\)/u)
  assert.match(
    source,
    /activeTab\.value === 'currencies'[\s\S]{0,160}canReadCurrencies\.value[\s\S]{0,160}canCreateCurrencies\.value/u,
  )
  assert.match(source, /useTemplateRef<CurrencyManagementPanelExpose>/u)
  assert.match(source, /currencyManagementPanelRef\.value\?\.openCreate\(\)/u)
})

test('两个业务面板不再各自创建页面骨架', () => {
  for (const relativePath of [
    '../../src/views/system/basic-data/currencies/index.vue',
    '../../src/views/system/basic-data/exchange-rates/index.vue',
  ]) {
    const source = readSource(relativePath)

    assert.doesNotMatch(source, /<FaPageHeader\b|<FaPageMain\b/u)
    assert.match(source, /<QsGenericTable\b/u)
  }
})
