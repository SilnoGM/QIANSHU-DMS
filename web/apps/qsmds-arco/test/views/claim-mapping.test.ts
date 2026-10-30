import type { SalesOrderLineDto, ShipmentStorageProductPreviewDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web 映射算法使用 Node.js 内置 runner 验证。
import test from 'node:test'

import { buildClaimMapping, hasCustomTargetLine, normalizeClaimProductName } from '../../src/views/workbenches/purchase-storage/claim-mapping'

function allocation(overrides: Partial<ShipmentStorageProductPreviewDto> = {}): ShipmentStorageProductPreviewDto {
  return {
    lineId: 'purchase-line-1',
    lineNumber: 1,
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    productName: '挖掘機',
    productDescription: null,
    sourceSalesProductName: '挖掘機',
    normalizedNames: ['挖掘機'],
    quantity: 1,
    mainImage: null,
    ...overrides,
  }
}

function targetLine(overrides: Partial<SalesOrderLineDto> = {}): SalesOrderLineDto {
  return {
    id: 'sales-line-1',
    lineNumber: 1,
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    productName: '挖掘機',
    productAttributes: [],
    description: null,
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: '10.00',
    quantity: 1,
    lineTotalAmount: '10.00',
    ...overrides,
  }
}

test('目录产品按 productId 匹配，同名不同 ID 不能自动映射', () => {
  const source = allocation({
    lineType: 'CATALOG',
    productId: 'product-1',
    productName: '产品甲',
    normalizedNames: [],
  })
  const sameName = targetLine({
    lineType: 'CATALOG',
    productId: 'product-2',
    productName: '产品甲',
  })
  const mapping = buildClaimMapping([source], [sameName])

  assert.equal(mapping.complete, false)
  assert.deepEqual(mapping.rows, [])
  assert.deepEqual(mapping.unmatched, [{
    purchaseOrderLineId: 'purchase-line-1',
    productName: '产品甲',
    remaining: 1,
  }])

  const matched = buildClaimMapping([source], [{ ...sameName, productId: 'product-1' }])
  assert.equal(matched.complete, true)
  assert.equal(matched.rows[0]?.mismatch, false)
})

test('自定义产品同名自动分配，异名需人工选择目标行后确认', () => {
  const sameName = buildClaimMapping([allocation()], [targetLine()])
  assert.equal(sameName.complete, true)
  assert.equal(sameName.requiresConfirmation, false)
  assert.equal(sameName.rows[0]?.mismatch, false)

  const renamedLine = targetLine({ productName: '挖掘機（含配件）' })
  const renamedWithoutChoice = buildClaimMapping([allocation()], [renamedLine])
  assert.equal(renamedWithoutChoice.complete, false)
  assert.deepEqual(renamedWithoutChoice.rows, [])

  const renamed = buildClaimMapping(
    [allocation()],
    [renamedLine],
    { 'purchase-line-1': renamedLine.id },
  )
  assert.equal(renamed.complete, true)
  assert.equal(renamed.requiresConfirmation, true)
  assert.deepEqual(renamed.rows.map(row => [row.quantity, row.mismatch]), [[1, true]])
})

test('同一库存分配行可拆到多条目标行，未匹配数量保持可见', () => {
  const source = allocation({ quantity: 3 })
  const mapping = buildClaimMapping([source], [
    targetLine({ id: 'line-1', quantity: 2 }),
    targetLine({ id: 'line-2', quantity: 1, lineNumber: 2 }),
  ])
  assert.equal(mapping.complete, true)
  assert.deepEqual(mapping.rows.map(row => [row.targetLineId, row.quantity]), [
    ['line-1', 2],
    ['line-2', 1],
  ])

  const short = buildClaimMapping([source], [targetLine({ quantity: 2 })])
  assert.equal(short.complete, false)
  assert.deepEqual(short.unmatched, [{
    purchaseOrderLineId: 'purchase-line-1',
    productName: '挖掘機',
    remaining: 1,
  }])
})

test('来源采购行未解析时禁止自动映射', () => {
  const mapping = buildClaimMapping(
    [allocation({ lineType: 'UNRESOLVED', normalizedNames: [] })],
    [targetLine()],
  )
  assert.equal(mapping.complete, false)
  assert.deepEqual(mapping.rows, [])
})

test('产品名称规范化与服务端口径一致', () => {
  assert.equal(normalizeClaimProductName('  Ｃｕｓｔｏｍ   Item '), 'custom item')
})

test('目标订单只有目录行时没有自定义目标行可选', () => {
  assert.equal(hasCustomTargetLine([targetLine({
    lineType: 'CATALOG',
    productId: 'product-1',
    productName: '目录产品',
  })]), false)
  assert.equal(hasCustomTargetLine([targetLine()]), true)
})
