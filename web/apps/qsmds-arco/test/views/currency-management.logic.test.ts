import type { CurrencyDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 纯逻辑契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildCreateCurrencyRequest,
  buildCurrencyListQuery,
  buildUpdateCurrencyRequest,
  createCurrencyFormModel,
  getCurrencyMutationFailure,
  hasCurrencyFormChanges,
  resolveCurrencyActions,
  validateCurrencyForm,
} from '../../src/views/system/basic-data/currencies/currency-management.logic'

const TWD: CurrencyDto = {
  id: '00000000-0000-4000-8000-000000000002',
  code: 'TWD',
  name: '新台币',
  englishName: 'New Taiwan Dollar',
  symbol: 'NT$',
  minorUnit: 2,
  enabled: false,
  isBase: false,
  sortOrder: 20,
  exchangeRateConfigured: false,
  version: 3,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
}

test('货币列表查询只发送当前服务端分页、搜索与状态契约', () => {
  assert.deepEqual(buildCurrencyListQuery({
    page: 2,
    pageSize: 50,
    search: '  twd  ',
    status: 'DISABLED',
  }), {
    page: 2,
    pageSize: 50,
    query: 'twd',
    status: 'DISABLED',
  })

  assert.deepEqual(buildCurrencyListQuery({
    page: 0,
    pageSize: 500,
    search: '   ',
    status: 'UNKNOWN',
  }), {
    page: 1,
    pageSize: 20,
  })
})

test('创建货币规范化三位代码并保持可空文本省略语义', () => {
  const model = createCurrencyFormModel('create', null)
  Object.assign(model, {
    code: 'twd',
    englishName: '  New Taiwan Dollar  ',
    minorUnit: '2',
    name: '  新台币  ',
    sortOrder: '20',
    symbol: '  NT$  ',
  })

  assert.deepEqual(validateCurrencyForm(model, 'create'), {})
  assert.deepEqual(buildCreateCurrencyRequest(model), {
    code: 'TWD',
    englishName: 'New Taiwan Dollar',
    minorUnit: 2,
    name: '新台币',
    sortOrder: 20,
    symbol: 'NT$',
  })

  model.englishName = ' '
  model.symbol = ''
  assert.deepEqual(buildCreateCurrencyRequest(model), {
    code: 'TWD',
    minorUnit: 2,
    name: '新台币',
    sortOrder: 20,
  })
})

test('系统金额小数位严格限制 0 到 4 且排序必须是非负整数', () => {
  const model = createCurrencyFormModel('create', null)
  Object.assign(model, {
    code: 'USD',
    minorUnit: '5',
    name: '美元',
    sortOrder: '-1',
  })

  assert.deepEqual(validateCurrencyForm(model, 'create'), {
    minorUnit: '系统金额小数位必须是 0 到 4 的整数',
    sortOrder: '排序必须是 0 到 2147483647 的整数',
  })
})

test('编辑请求不允许改 Code 与小数位并始终携带 expectedVersion', () => {
  const model = createCurrencyFormModel('edit', TWD)
  model.name = '新臺幣'
  model.englishName = ''

  assert.equal(hasCurrencyFormChanges(model, TWD), true)
  assert.deepEqual(buildUpdateCurrencyRequest(model, TWD), {
    englishName: null,
    expectedVersion: 3,
    name: '新臺幣',
    sortOrder: 20,
    symbol: 'NT$',
  })
  assert.equal(Object.hasOwn(buildUpdateCurrencyRequest(model, TWD), 'code'), false)
  assert.equal(Object.hasOwn(buildUpdateCurrencyRequest(model, TWD), 'minorUnit'), false)
})

test('CNY 基准币允许编辑展示字段但不暴露启停动作', () => {
  const cny = { ...TWD, code: 'CNY', enabled: true, isBase: true }

  assert.deepEqual(resolveCurrencyActions(cny, {
    canDisable: true,
    canEnable: true,
    canUpdate: true,
  }), {
    canDisable: false,
    canEdit: true,
    canEnable: false,
    hasAny: true,
    readonlyReason: '基准币只读',
  })
})

test('启用前缺少汇率的服务端错误保留稳定错误码并就地展示', () => {
  assert.deepEqual(getCurrencyMutationFailure({
    kind: 'http',
    status: 422,
    body: {
      code: 'CURRENCY_EXCHANGE_RATE_REQUIRED',
      message: '请先配置当前汇率再启用该货币',
      requestId: 'request-1',
    },
  }), {
    code: 'CURRENCY_EXCHANGE_RATE_REQUIRED',
    fieldErrors: {},
    message: '请先配置当前汇率再启用该货币',
    requestId: 'request-1',
    unknownResult: false,
  })
})

test('网络失败标记为结果未知且不得触发 mutation 自动重放', () => {
  assert.deepEqual(getCurrencyMutationFailure({
    kind: 'network',
    message: 'Network Error',
  }), {
    code: undefined,
    fieldErrors: {},
    message: 'Network Error',
    requestId: undefined,
    unknownResult: true,
  })
})
