import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面筛选项契约使用 Node.js 内置 runner。
import test from 'node:test'

import { buildStorageQuery, STORAGE_SCOPE_OPTIONS } from '../../src/views/workbenches/shipment-storage/logic'

test('寄仓位置筛选不使用空字符串值，全部位置使用 ALL 哨兵', () => {
  assert.ok(STORAGE_SCOPE_OPTIONS.every(option => option.value !== ''))
  assert.equal(STORAGE_SCOPE_OPTIONS[0]?.value, 'ALL')
})

test('ALL 哨兵在请求前转换为未设置', () => {
  assert.deepEqual(buildStorageQuery({
    page: 1,
    pageSize: 20,
    keyword: ' ',
    status: 'ALL',
    locationScope: 'ALL',
    warehouseValue: 'ALL',
  }), {
    page: 1,
    pageSize: 20,
    keyword: undefined,
    status: undefined,
    locationScope: undefined,
    warehouseValue: undefined,
  })
})

test('具体位置与仓库保留筛选值', () => {
  assert.deepEqual(buildStorageQuery({
    page: 2,
    pageSize: 50,
    keyword: 'PKG',
    status: 'IN_STORAGE',
    locationScope: 'OVERSEAS',
    warehouseValue: 'RF_TZ',
  }), {
    page: 2,
    pageSize: 50,
    keyword: 'PKG',
    status: 'IN_STORAGE',
    locationScope: 'OVERSEAS',
    warehouseValue: 'RF_TZ',
  })
})
