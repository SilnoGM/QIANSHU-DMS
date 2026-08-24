import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售订单列表纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import { buildSalesOrderCustomerCopyText } from '../../src/views/operations/sales-orders/sales-order-list.logic'

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
