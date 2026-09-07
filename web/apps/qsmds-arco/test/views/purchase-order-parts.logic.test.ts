import type { OrderProductLineModel } from '../../src/components/business/QsOrderProductLineEditor/types'
import type { PartConfiguration } from '../../src/components/business/QsPartConfigurator/types'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 货件适配使用 Node.js 内置 runner 验证。
import test from 'node:test'
import {
  buildPurchaseOrderParts,
  freezePurchaseOrderPartReview,
  mapPurchaseOrderPartProducts,
  reconcilePurchaseOrderParts,
} from '../../src/views/operations/purchase-orders/purchase-order-parts.logic'

const firstKey = '11111111-1111-4111-8111-111111111111'
const secondKey = '22222222-2222-4222-8222-222222222222'
function line(key: string, quantity: string): OrderProductLineModel {
  return { key, quantity, lineType: 'CUSTOM', productId: null, productNo: null, name: '同名产品', description: '备注', mainImage: null, standardUnitPriceAmount: '10', actualUnitPriceAmount: '10' }
}
const lines = [line('a', '5'), line('b', '2')]
const parts: PartConfiguration[] = [
  { key: firstKey, items: [{ productKey: 'a', quantity: 2 }, { productKey: 'b', quantity: 2 }] },
  { key: secondKey, items: [{ productKey: 'a', quantity: 3 }] },
]

test('按稳定产品行标识分箱合箱，并映射为最终采购行号而非产品名', () => {
  const built = buildPurchaseOrderParts(lines, parts)
  assert.equal(built.valid, true)
  if (!built.valid) {
    return
  }
  assert.deepEqual(built.parts, [
    { key: firstKey, items: [{ lineNumber: 1, quantity: 2 }, { lineNumber: 2, quantity: 2 }] },
    { key: secondKey, items: [{ lineNumber: 1, quantity: 3 }] },
  ])
  const reordered = buildPurchaseOrderParts([lines[1]!, lines[0]!], parts)
  assert.equal(reordered.valid, true)
  if (reordered.valid) {
    assert.deepEqual(reordered.parts[1]?.items, [{ lineNumber: 2, quantity: 3 }])
  }
})

test('未配置、跨行抵消总数、超量和不存在的行均不能生成提交配置', () => {
  for (const invalidParts of [
    [],
    [{ key: firstKey, items: [{ productKey: 'a', quantity: 7 }] }],
    [{ key: firstKey, items: [{ productKey: 'a', quantity: 6 }, { productKey: 'b', quantity: 1 }] }],
    [{ key: firstKey, items: [{ productKey: 'missing', quantity: 7 }] }],
  ]) { assert.equal(buildPurchaseOrderParts(lines, invalidParts).valid, false) }
})

test('减少数量只清除超量产品的分配，保留其他产品与货件稳定标识', () => {
  const reconciled = reconcilePurchaseOrderParts([line('a', '3'), line('b', '2')], parts)
  assert.equal(reconciled.changed, true)
  assert.deepEqual(reconciled.parts, [{ key: firstKey, items: [{ productKey: 'b', quantity: 2 }] }])
  assert.deepEqual(parts[1]?.items, [{ productKey: 'a', quantity: 3 }], '不得修改原配置')
})

test('删除产品退回其分配并移除空货件；数量增加保留已配置数量', () => {
  assert.deepEqual(reconcilePurchaseOrderParts([line('b', '2')], parts).parts, [
    { key: firstKey, items: [{ productKey: 'b', quantity: 2 }] },
  ])
  const increased = reconcilePurchaseOrderParts([line('a', '6'), line('b', '2')], parts)
  assert.equal(increased.changed, false)
  assert.equal(increased.parts, parts)
  const built = buildPurchaseOrderParts([line('a', '6'), line('b', '2')], parts)
  assert.equal(built.valid, false)
  if (!built.valid) {
    assert.match(built.message, /1/)
  }
})

test('只映射本次采购产品并拒绝非法整件数量，改名备注价格不清空分配', () => {
  assert.deepEqual(mapPurchaseOrderPartProducts(lines).map(item => [item.key, item.quantity]), [['a', 5], ['b', 2]])
  for (const quantity of ['', '1.5', '-1', '1e3', '2147483648']) {
    assert.equal(buildPurchaseOrderParts([line('a', quantity)], [{ key: firstKey, items: [{ productKey: 'a', quantity: 1 }] }]).valid, false)
  }
  assert.equal(reconcilePurchaseOrderParts(lines.map(item => ({ ...item, name: '改名', description: '新备注', actualUnitPriceAmount: '20' })), parts).changed, false)
})

test('提交核对快照脱离可编辑草稿，未知结果期间产品与货件均保持不变', () => {
  const editableLines = [line('a', '5')]
  const editableParts = [{ key: firstKey, items: [{ productKey: 'a', quantity: 5 }] }]
  const snapshot = freezePurchaseOrderPartReview(editableLines, editableParts)
  editableLines[0] = line('a', '2')
  editableParts[0]!.items[0]!.quantity = 2
  assert.equal(snapshot.products[0]?.quantity, 5)
  assert.equal(snapshot.parts[0]?.items[0]?.quantity, 5)
  assert.equal(Object.isFrozen(snapshot.products[0]), true)
  assert.equal(Object.isFrozen(snapshot.parts[0]?.items[0]), true)
})
