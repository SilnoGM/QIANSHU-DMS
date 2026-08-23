import type {
  ExistingCatalogLine,
  ProductSelectionChange,
  ProductSelectorItem,
} from '../../src/components/business/QsProductSelector/types'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import {
  canApplyProductSelectorResponse,
  confirmProductIncrement,
  createExistingCatalogLineIndex,
  createProductSelectorQueryKey,
  createSelectedProductItems,
  mergeProductSelectorItems,
  removeProductFromSession,
  selectProductForSession,
} from '../../src/components/business/QsProductSelector/logic'

function product(id: string): ProductSelectorItem {
  return {
    id,
    productNo: `SKU-${id}`,
    name: `产品 ${id}`,
    supplierValue: 'SUPPLIER_A',
    attributes: [],
    standardUnitPriceAmount: '12.5000',
    currencyCode: 'TWD',
    mainImage: null,
  }
}

test('产品选择分页按稳定 ID 合并，并拒绝旧查询覆盖当前筛选', () => {
  assert.deepEqual(
    mergeProductSelectorItems(
      [product('A'), product('B')],
      [product('B'), product('C')],
      false,
    ).map(item => item.id),
    ['A', 'B', 'C'],
  )
  assert.equal(createProductSelectorQueryKey({
    currencyCode: 'TWD',
    keyword: '  收纳 ',
    supplierValue: 'SUPPLIER_A',
    page: 1,
    pageSize: 20,
  }), 'TWD\u0000收纳\u0000SUPPLIER_A')
  assert.equal(canApplyProductSelectorResponse({
    activeQueryKey: 'new',
    activeVersion: 3,
    requestQueryKey: 'old',
    requestVersion: 2,
    aborted: false,
  }), false)
})

test('打开会话时已有数据库产品完整回显到已选列表', () => {
  const existing: ExistingCatalogLine[] = [{
    key: 'line-a',
    productId: 'A',
    productNo: 'SKU-A',
    name: '产品 A',
    quantity: '3',
  }]

  assert.deepEqual(createSelectedProductItems(existing, []), [{
    origin: 'EXISTING',
    productId: 'A',
    productNo: 'SKU-A',
    name: '产品 A',
    quantity: '3',
  }])
})

test('已存在产品每次二次确认均累加待增加数量，取消不改原明细', () => {
  const existing: ExistingCatalogLine[] = [{
    key: 'line-a',
    productId: 'A',
    productNo: 'SKU-A',
    name: '产品 A',
    quantity: '3',
  }]
  const index = createExistingCatalogLineIndex(existing)
  const first = selectProductForSession([], product('A'), index)
  assert.deepEqual(first.changes, [])
  assert.deepEqual(first.incrementCandidate, {
    kind: 'EXISTING',
    lineKey: 'line-a',
    productId: 'A',
  })

  const confirmedOnce = confirmProductIncrement(
    first.changes,
    first.incrementCandidate!,
  )
  const second = selectProductForSession(confirmedOnce, product('A'), index)
  const confirmedTwice = confirmProductIncrement(
    second.changes,
    second.incrementCandidate!,
  )
  assert.deepEqual(confirmedTwice, [{
    kind: 'INCREMENT',
    lineKey: 'line-a',
    productId: 'A',
    delta: 2,
  }])
  assert.equal(createSelectedProductItems(existing, confirmedTwice)[0]?.quantity, '5')
  assert.equal(existing[0]!.quantity, '3')
})

test('新产品保持唯一已选项，再次选择后可二次确认增加数量', () => {
  const index = createExistingCatalogLineIndex([])
  const added = selectProductForSession([], product('B'), index)
  assert.deepEqual(added.changes.map((change: ProductSelectionChange) => change.kind), ['ADD'])
  assert.equal(added.changes[0]?.kind === 'ADD' && added.changes[0].quantity, 1)

  const duplicate = selectProductForSession(added.changes, product('B'), index)
  assert.deepEqual(duplicate.incrementCandidate, {
    kind: 'ADD',
    lineKey: null,
    productId: 'B',
  })
  const incremented = confirmProductIncrement(
    duplicate.changes,
    duplicate.incrementCandidate!,
  )
  assert.equal(incremented[0]?.kind === 'ADD' && incremented[0].quantity, 2)
  assert.deepEqual(createSelectedProductItems([], incremented).map(item => (
    [item.productId, item.quantity]
  )), [['B', '2']])
})

test('删除已有产品生成移除变更并从已选列表消失，重新选择会撤销删除', () => {
  const existing: ExistingCatalogLine[] = [{
    key: 'line-a',
    productId: 'A',
    productNo: 'SKU-A',
    name: '产品 A',
    quantity: '3',
  }]
  const index = createExistingCatalogLineIndex(existing)
  const removed = removeProductFromSession([], 'A', index)
  assert.deepEqual(removed, [{
    kind: 'REMOVE',
    lineKey: 'line-a',
    productId: 'A',
  }])
  assert.deepEqual(createSelectedProductItems(existing, removed), [])

  const restored = selectProductForSession(removed, product('A'), index)
  assert.deepEqual(restored.changes, [])
  assert.equal(restored.incrementCandidate, null)
  assert.equal(createSelectedProductItems(existing, restored.changes).length, 1)
})

test('删除会话中新选产品只撤销 ADD，不产生不存在行的 REMOVE', () => {
  const index = createExistingCatalogLineIndex([])
  const added = selectProductForSession([], product('B'), index)
  assert.deepEqual(removeProductFromSession(added.changes, 'B', index), [])
})
