import type { CurrencyDescriptor } from '../../src/components/base/currency'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 销售订单列表纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildSalesOrderCustomerCopyText,
  formatSalesOrderSummaryAmount,
} from '../../src/views/operations/sales-orders/sales-order-list.logic'

const currencies: readonly CurrencyDescriptor[] = [
  { code: 'TWD', enabled: true, minorUnit: 2, name: '新台币', symbol: 'NT$' },
  { code: 'MYR', enabled: true, minorUnit: 2, name: '马来西亚令吉', symbol: 'RM' },
]

test('客户信息复制为固定三行，并移除完整地址中的全部“中国台湾”', () => {
  assert.equal(buildSalesOrderCustomerCopyText({
    customerName: '林测试',
    customerPhone: '0912345678',
    customerFullAddress: '中国台湾台湾新北市中国台湾板桥区测试路1号',
  }), [
    '客户姓名：林测试',
    '客户电话：0912345678',
    '客户地址：台湾新北市板桥区测试路1号',
  ].join('\n'))
})

test('汇总矩阵金额保留精确格式与币种符号，但不重复展示行级币种代码', () => {
  assert.equal(formatSalesOrderSummaryAmount('510000', 'TWD', currencies), 'NT$510,000.00')
  assert.equal(formatSalesOrderSummaryAmount('81000.005', 'MYR', currencies), 'RM81,000.01')
  assert.equal(formatSalesOrderSummaryAmount('123.45', 'USD', currencies), '123.45')
  assert.equal(formatSalesOrderSummaryAmount(null, 'TWD', currencies), '—')
})
