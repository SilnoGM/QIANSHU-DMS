import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 销售订单 View 契约使用 Node.js 内置 runner。
import test from 'node:test'

const ROOT = new URL('../../src/views/operations/sales-orders/', import.meta.url)

test('销售订单列表先通过 QsGenericModal 选择唯一币种，再携带路由参数进入新增页', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(source, /<QsGenericModal/)
  assert.match(source, /选择订单币种/)
  assert.match(source, /TWD/)
  assert.match(source, /MYR/)
  assert.match(source, /name: 'operationsSalesOrderCreate'/)
  assert.match(source, /query: \{ currency: selectedCurrency/u)
  assert.match(source, /<QsGenericTable/)
  assert.match(source, /salesOrdersApi\.list/)
})

test('新增页固定币种并组合日期、当前用户、三级地区、产品明细、金额与凭证', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')

  assert.match(source, /parseSalesOrderCurrency\(route\.query\.currency\)/)
  assert.match(source, /<FaDate/)
  assert.match(source, /:max-value="todayDate"/)
  assert.match(source, /appAccountStore\.displayName/)
  assert.match(source, /<QsRegionSelector/)
  assert.match(source, /<SalesOrderLines/)
  assert.match(source, /<MoneyInput/g)
  assert.match(source, /salesOrdersApi\.uploadTemporaryDocument/)
  assert.match(source, /salesOrdersApi\.create/)
  assert.match(source, /beginSalesOrderSubmission/)
  assert.match(source, /使用相同请求重新确认/)
  assert.match(source, /lg:grid-cols-12/)
  assert.match(source, /lg:col-span-8/)
  assert.match(source, /lg:col-span-4/)
  assert.match(source, /lg:sticky/)
  assert.doesNotMatch(source, /gradient|#[\dA-F]{3,8}/i)
})

test('产品明细同时支持目录产品与仅本单临时产品，数量和真实售价均明确可编辑', async () => {
  const source = await readFile(new URL('sales-order-lines.vue', ROOT), 'utf8')

  assert.match(source, /CATALOG/)
  assert.match(source, /CUSTOM/)
  assert.match(source, /数据库产品/)
  assert.match(source, /仅本订单/)
  assert.match(source, /标准价/)
  assert.match(source, /真实售价/)
  assert.match(source, /产品数量/)
  assert.match(source, /step="1"/)
  assert.match(source, /min="1"/)
  assert.match(source, /<MoneyInput/)
})
