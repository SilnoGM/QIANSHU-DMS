import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑使用 Node.js 内置 runner 验证。
import test from 'node:test'

import {
  resolveStorageCardLocation,
  resolveStorageCardMarks,
  resolveStorageCardProducts,
} from '../../src/components/business/QsShipmentStorageCard/logic'

function product(lineId: string, productName: string) {
  return {
    lineId,
    lineNumber: 1,
    productNo: `PROD/${lineId}`,
    productName,
    quantity: 1,
    mainImage: null,
  }
}

test('产品摘要只保留第一个产品，并同时给出总数与剩余数', () => {
  assert.deepEqual(resolveStorageCardProducts({ previews: [] }), {
    product: null,
    totalCount: 0,
    extraCount: 0,
  })
  assert.deepEqual(resolveStorageCardProducts({ previews: [product('1', '爬梯')] }), {
    product: product('1', '爬梯'),
    totalCount: 1,
    extraCount: 0,
  })
  assert.deepEqual(resolveStorageCardProducts({
    previews: [product('1', '爬梯'), product('2', '固定架'), product('3', '破碎锤')],
  }), {
    product: product('1', '爬梯'),
    totalCount: 3,
    extraCount: 2,
  })
})

test('装柜唛头最多展示两个，空值与空数组统一显示破折号', () => {
  assert.deepEqual(resolveStorageCardMarks([]), {
    visibleText: '—',
    fullText: '—',
    hiddenCount: 0,
  })
  assert.deepEqual(resolveStorageCardMarks([' ', '']), {
    visibleText: '—',
    fullText: '—',
    hiddenCount: 0,
  })
  assert.deepEqual(resolveStorageCardMarks(['A-01']), {
    visibleText: 'A-01',
    fullText: 'A-01',
    hiddenCount: 0,
  })
  assert.deepEqual(resolveStorageCardMarks(['A-01', 'A-02', 'A-03', ' A-04 ']), {
    visibleText: 'A-01、A-02',
    fullText: 'A-01、A-02、A-03、A-04',
    hiddenCount: 2,
  })
})

test('寄仓位置按内地/海外前缀展示，仓库名缺失时回退到稳定值', () => {
  assert.deepEqual(resolveStorageCardLocation({
    locationScope: 'OVERSEAS',
    warehouseLabel: '瑞锋-林口仓',
    warehouseValue: 'RF_LK',
  }), { scope: '海外', warehouse: '瑞锋-林口仓' })
  assert.deepEqual(resolveStorageCardLocation({
    locationScope: 'MAINLAND',
    warehouseLabel: null,
    warehouseValue: 'SZ_B5',
  }), { scope: '内地', warehouse: 'SZ_B5' })
})
