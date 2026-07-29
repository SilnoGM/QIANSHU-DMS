import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面与纯逻辑契约复用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildExchangeRateListQuery,
  buildExchangeRateSubmission,
  formatConversionExample,
  getExchangeRateApiFailure,
  validateForeignUnitsPerCny,
} from '../../src/views/system/basic-data/exchange-rates/exchange-rates.logic'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('汇率查询只提交非空搜索、配置状态与分页条件', () => {
  assert.deepEqual(buildExchangeRateListQuery({
    filters: { status: 'CONFIGURED' },
    page: 2,
    pageSize: 50,
    search: '  台币  ',
  }), {
    page: 2,
    pageSize: 50,
    query: '台币',
    status: 'CONFIGURED',
  })

  assert.deepEqual(buildExchangeRateListQuery({
    filters: { status: 'INVALID' },
    page: -1,
    pageSize: 999,
    search: '  ',
  }), {
    page: 1,
    pageSize: 20,
  })
})

test('汇率值始终按十进制字符串校验和提交', () => {
  assert.equal(validateForeignUnitsPerCny(''), '请输入换算比例')
  assert.equal(validateForeignUnitsPerCny('0'), '换算比例必须大于 0')
  assert.equal(validateForeignUnitsPerCny('1e3'), '换算比例只能使用普通十进制数字')
  assert.equal(validateForeignUnitsPerCny('1.1234567890123'), '换算比例最多支持 12 位小数')
  assert.equal(validateForeignUnitsPerCny('0004.8000'), '')

  assert.deepEqual(buildExchangeRateSubmission({
    currencyId: 'currency-twd',
    exchangeRateId: null,
    foreignUnitsPerCny: ' 0004.8000 ',
    version: null,
  }), {
    mode: 'create',
    value: {
      currencyId: 'currency-twd',
      foreignUnitsPerCny: '4.8000',
    },
  })

  assert.deepEqual(buildExchangeRateSubmission({
    currencyId: 'currency-usd',
    exchangeRateId: 'rate-usd',
    foreignUnitsPerCny: '0.138',
    version: 7,
  }), {
    exchangeRateId: 'rate-usd',
    mode: 'edit',
    value: {
      expectedVersion: 7,
      foreignUnitsPerCny: '0.138',
    },
  })
})

test('换算说明不把需求示例作为表单默认值', () => {
  assert.equal(
    formatConversionExample('TWD', '4.8'),
    '例如：100 TWD ÷ 4.8 = 20.833333 CNY',
  )
  assert.equal(formatConversionExample('USD', ''), '填写比例后显示换算示例')

  const modalSource = readSource(
    '../../src/views/system/basic-data/exchange-rates/exchange-rate-form-modal.vue',
  )
  assert.doesNotMatch(modalSource, /foreignUnitsPerCny:\s*['"]4\.8['"]/u)
  assert.match(modalSource, /外币金额\s*÷\s*比例\s*=\s*人民币/u)
})

test('汇率管理页复用统一页面骨架、表格与权限守卫', () => {
  const source = readSource(
    '../../src/views/system/basic-data/exchange-rates/index.vue',
  )
  const tableTag = source.match(/<QsGenericTable\b[\s\S]*?>/u)?.[0]

  assert.equal(source.match(/<FaPageMain\b/gu)?.length, 1)
  assert.match(source, /<FaPageHeader\b/u)
  assert.ok(tableTag)
  assert.match(tableTag, /v-model:page="page"/u)
  assert.match(tableTag, /v-model:page-size="pageSize"/u)
  assert.match(tableTag, /v-model:search="search"/u)
  assert.match(tableTag, /v-model:filters="filters"/u)
  assert.match(source, /exchange-rates:read/u)
  assert.match(source, /exchange-rates:create/u)
  assert.match(source, /exchange-rates:update/u)
  assert.match(source, /currenciesApi\.exchangeRates\.list/u)
  assert.match(source, /currenciesApi\.exchangeRates\.create/u)
  assert.match(source, /currenciesApi\.exchangeRates\.update/u)
  assert.match(source, /invalidateCurrencyCatalogCache\(\{ broadcast: true \}\)/u)
  assert.doesNotMatch(source, /<Fa(?:Table|Pagination|Card)\b|<A[A-Z]\w*\b/u)
  assert.doesNotMatch(source, /(?:gradient|#[\dA-Fa-f]{3,8}\b|rgba?\()/u)
})

test('页面过滤 CNY、守卫过期响应并清理身份切换上下文', () => {
  const source = readSource(
    '../../src/views/system/basic-data/exchange-rates/index.vue',
  )

  assert.match(source, /item\.currency\.code !== 'CNY'/u)
  assert.match(source, /new AbortController\(\)/u)
  assert.match(source, /authEpoch/u)
  assert.match(source, /listRequestVersion/u)
  assert.match(source, /authorized: canRead\.value/u)
  assert.match(
    source,
    /watch\(\s*\[\(\) => appAccountStore\.authEpoch, canRead\],[\s\S]*?listAbortController\?\.abort\(\)[\s\S]*?clearFormContext\(\)/u,
  )
  assert.match(source, /<ExchangeRateFormModal\s+v-if="canRead"/u)
  assert.match(source, /:row-key="item => item\.currency\.id"/u)
})

test('表格同时呈现配置状态、比例语义和字符串精度', () => {
  const source = readSource(
    '../../src/views/system/basic-data/exchange-rates/index.vue',
  )

  assert.match(source, /foreignUnitsPerCny/u)
  assert.match(source, /1 CNY = X CODE/u)
  assert.match(source, /1 CNY =/u)
  assert.match(source, /外币单位数\s*\/\s*1 CNY/u)
  assert.match(source, /未配置/u)
  assert.match(source, /已配置/u)
  assert.match(source, /qs-type-data-emphasis/u)
  assert.match(source, /当前身份仅可查看/u)
})

test('网络未知结果与过期版本会重新查询并用最新汇率替换表单上下文', () => {
  assert.deepEqual(getExchangeRateApiFailure({
    body: {
      code: 'EXCHANGE_RATE_STATE_CHANGED',
      message: '汇率状态已变化',
      requestId: 'request-1',
    },
    kind: 'http',
  }), {
    code: 'EXCHANGE_RATE_STATE_CHANGED',
    fieldErrors: {},
    message: '汇率状态已变化',
    requestId: 'request-1',
    unknownResult: false,
  })
  assert.equal(getExchangeRateApiFailure({
    kind: 'network',
    message: 'Network Error',
  }).unknownResult, true)

  const pageSource = readSource(
    '../../src/views/system/basic-data/exchange-rates/index.vue',
  )
  const modalSource = readSource(
    '../../src/views/system/basic-data/exchange-rates/exchange-rate-form-modal.vue',
  )
  assert.match(
    pageSource,
    /failure\.unknownResult[\s\S]*?EXCHANGE_RATE_STATE_CHANGED[\s\S]*?await loadExchangeRates\(\)[\s\S]*?formTarget\.value = refreshedTarget/u,
  )
  assert.match(modalSource, /watch\(\s*\(\) => props\.item/u)
})
