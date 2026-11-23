import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 一次性交接逻辑用 Node 内置 runner 验证。
import test from 'node:test'

import {
  setPendingRechargePaste,
  takePendingRechargePaste,
} from '../../src/views/workbenches/network-ads/advertising-recharges/create-handoff'

test('交接取出一次后立即清空，避免重复弹出新增弹窗', () => {
  setPendingRechargePaste('LB-QS-01\n广告账户编号：1894829141682450')

  assert.equal(
    takePendingRechargePaste(),
    'LB-QS-01\n广告账户编号：1894829141682450',
  )
  assert.equal(takePendingRechargePaste(), null)
})

test('未写入直接取出返回 null', () => {
  assert.equal(takePendingRechargePaste(), null)
})

test('后写入覆盖前一次的值', () => {
  setPendingRechargePaste('LB-QS-01\n广告账户编号：1')
  setPendingRechargePaste('LB-QS-02\n广告账户编号：2')

  assert.equal(takePendingRechargePaste(), 'LB-QS-02\n广告账户编号：2')
})
