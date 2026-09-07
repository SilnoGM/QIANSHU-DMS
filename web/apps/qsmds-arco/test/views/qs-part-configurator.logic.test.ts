import type { PartConfiguration, PartConfiguratorProduct } from '../../src/components/business/QsPartConfigurator/types'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 货件数量守恒使用 Node.js 内置 runner。
import test from 'node:test'
import {
  appendPartConfiguration,
  formatPartLabel,
  getPartAllocationState,
  getPendingPartProducts,
  MAX_PART_CONFIGURATIONS,
  MAX_PART_ITEMS,
  MAX_PART_QUANTITY,
  removePartConfiguration,
  removePartConfigurationItem,
  validatePartConfigurations,
} from '../../src/components/business/QsPartConfigurator/logic'

const products: readonly PartConfiguratorProduct[] = [{
  key: 'line-a',
  productNo: 'SKU-A',
  name: '产品 A',
  description: '备注 A',
  quantity: 5,
  mainImage: null,
}, {
  key: 'line-b',
  productNo: null,
  name: '产品 B',
  description: '',
  quantity: 3,
  mainImage: null,
}]
const partA = '00000000-0000-4000-8000-000000000001'
const partB = '00000000-0000-4000-8000-000000000002'

function append(parts: readonly PartConfiguration[], items: PartConfiguration['items'], key: string): readonly PartConfiguration[] {
  const result = appendPartConfiguration(products, parts, items, key)
  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.parts
}

test('A5 可以拆为 2 + 3，后者可与 B3 合为一件并完成精确覆盖', () => {
  const first = append([], [{ productKey: 'line-a', quantity: 2 }], partA)
  assert.equal(getPartAllocationState(products, first).remainingByProduct.get('line-a'), 3)
  assert.equal(validatePartConfigurations(products, first).valid, false)
  const complete = append(first, [{ productKey: 'line-a', quantity: 3 }, { productKey: 'line-b', quantity: 3 }], partB)
  assert.deepEqual(validatePartConfigurations(products, complete), { valid: true, remainingQuantity: 0, errors: [] })
  assert.equal(first.length, 1)
  assert.equal(first[0]!.items[0]!.quantity, 2, '追加必须保持原数组不变')
})

test('删除整件退回全部数量，显示序号变动不改变剩余货件 key', () => {
  const initial = append(append([], [{ productKey: 'line-a', quantity: 2 }], partA), [{ productKey: 'line-a', quantity: 3 }, { productKey: 'line-b', quantity: 3 }], partB)
  const after = removePartConfiguration(initial, partA)
  assert.deepEqual(after.map(part => part.key), [partB])
  assert.equal(getPartAllocationState(products, after).remainingByProduct.get('line-a'), 2)
  assert.equal(getPartAllocationState(products, after).remainingByProduct.get('line-b'), 0)
  assert.equal(formatPartLabel(0), '货件-01')
  assert.equal(formatPartLabel(100), '货件-101')
})

test('删除单项只退回该数量，删除最后一项自动移除空货件', () => {
  const initial = append([], [{ productKey: 'line-a', quantity: 5 }, { productKey: 'line-b', quantity: 3 }], partA)
  const after = removePartConfigurationItem(initial, partA, 'line-a')
  assert.equal(getPartAllocationState(products, after).remainingByProduct.get('line-a'), 5)
  assert.equal(getPartAllocationState(products, after).remainingByProduct.get('line-b'), 0)
  assert.equal(after[0]!.key, partA)
  assert.deepEqual(removePartConfigurationItem(after, partA, 'line-b'), [])
  assert.equal(initial[0]!.items.length, 2)
})

test('产品全部装入后退出待配置列表，删除整件或单项后恢复对应剩余产品', () => {
  const complete = append([], [{ productKey: 'line-a', quantity: 5 }, { productKey: 'line-b', quantity: 3 }], partA)
  assert.deepEqual(getPendingPartProducts(products, complete), [])
  assert.deepEqual(getPendingPartProducts(products, removePartConfigurationItem(complete, partA, 'line-a')).map(product => product.key), ['line-a'])
  assert.deepEqual(getPendingPartProducts(products, removePartConfiguration(complete, partA)).map(product => product.key), ['line-a', 'line-b'])
})

test('拒绝零、负数、小数、非有限数、越过 int32 的输入和一次选择重复产品', () => {
  for (const quantity of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_PART_QUANTITY + 1]) {
    assert.equal(appendPartConfiguration(products, [], [{ productKey: 'line-a', quantity }], partA).ok, false)
  }
  assert.equal(appendPartConfiguration(products, [], [], partA).ok, false)
  assert.equal(appendPartConfiguration(products, [], [{ productKey: 'line-a', quantity: 1 }, { productKey: 'line-a', quantity: 1 }], partA).ok, false)
})

test('陈旧选择、超量和上游产品变更都明确失败，绝不自动截断或修复', () => {
  const existing = append([], [{ productKey: 'line-a', quantity: 4 }], partA)
  assert.equal(appendPartConfiguration(products, existing, [{ productKey: 'line-a', quantity: 2 }], partB).ok, false)
  assert.equal(appendPartConfiguration(products, existing, [{ productKey: 'unknown', quantity: 1 }], partB).ok, false)
  const reduced = [{ ...products[0]!, quantity: 3 }, products[1]!]
  const validation = validatePartConfigurations(reduced, existing)
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some(error => error.includes('超过')))
  assert.equal(existing[0]!.items[0]!.quantity, 4)
  assert.equal(getPartAllocationState(reduced, existing).remainingByProduct.get('line-a'), -1)
})

test('拒绝空货件、重复或非法 UUID、未知产品和重复 product key', () => {
  const items = [{ productKey: 'line-a', quantity: 1 }]
  for (const parts of [
    [{ key: partA, items: [] }],
    [{ key: 'invalid-key', items }],
    [{ key: partA, items }, { key: partA, items }],
    [{ key: partA, items: [{ productKey: 'missing', quantity: 1 }] }],
  ]) {
    assert.ok(getPartAllocationState(products, parts).errors.length > 0)
  }
  assert.equal(validatePartConfigurations([products[0]!, products[0]!], []).valid, false)
  assert.equal(validatePartConfigurations([{ ...products[0]!, quantity: 0 }], []).valid, false)
  assert.equal(validatePartConfigurations([], []).valid, false)
})

test('接受 int32 最大数量并阻止超过 1000 件，不能把数量当作自动拆件次数', () => {
  const maximumProduct = [{ ...products[0]!, quantity: MAX_PART_QUANTITY }]
  assert.deepEqual(validatePartConfigurations(maximumProduct, [{ key: partA, items: [{ productKey: 'line-a', quantity: MAX_PART_QUANTITY }] }]), {
    valid: true,
    remainingQuantity: 0,
    errors: [],
  })
  const thousand = Array.from({ length: MAX_PART_CONFIGURATIONS }, (_, index) => ({
    key: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    items: [{ productKey: 'line-a', quantity: 1 }],
  }))
  assert.equal(appendPartConfiguration(maximumProduct, thousand, [{ productKey: 'line-a', quantity: 1 }]).ok, false)
  assert.equal(thousand.length, 1000)
})

test('全单最多 10000 项分配，移除一项后可重新合并数量继续配置', () => {
  const manyProducts = Array.from({ length: 100 }, (_, index) => ({ ...products[0]!, key: `line-${index}`, quantity: 101 }))
  const maximumItems = Array.from({ length: 100 }, (_, index) => ({
    key: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    items: manyProducts.map(product => ({ productKey: product.key, quantity: 1 })),
  }))
  assert.equal(maximumItems.reduce((sum, part) => sum + part.items.length, 0), MAX_PART_ITEMS)
  assert.deepEqual(getPartAllocationState(manyProducts, maximumItems).errors, [])
  const overflow = appendPartConfiguration(manyProducts, maximumItems, [{ productKey: 'line-0', quantity: 1 }])
  assert.equal(overflow.ok, false)
  if (!overflow.ok) {
    assert.match(overflow.message, /10000/u)
  }
  const released = removePartConfigurationItem(maximumItems, maximumItems[0]!.key, 'line-0')
  const regrouped = appendPartConfiguration(manyProducts, released, [{ productKey: 'line-0', quantity: 2 }])
  assert.equal(regrouped.ok, true)
  assert.equal(maximumItems[0]!.items.length, 100)
})
