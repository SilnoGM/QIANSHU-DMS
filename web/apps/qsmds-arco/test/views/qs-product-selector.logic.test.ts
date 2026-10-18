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
  groupProductSelectorItems,
  mergeProductSelectorItems,
  removeProductFromSession,
  selectProductForSession,
} from '../../src/components/business/QsProductSelector/logic'

function product(id: string): ProductSelectorItem {
  return {
    id,
    productNo: `SKU-${id}`,
    name: `产品 ${id}`,
    categoryName: '收纳包',
    productHeadName: '城市旅行',
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
  }), 'TWD\u0000收纳\u0000SUPPLIER_A\u0000\u0000')
  assert.equal(createProductSelectorQueryKey({
    currencyCode: 'TWD',
    categoryName: '收纳',
    page: 1,
    pageSize: 20,
  }), 'TWD\u0000\u0000\u0000收纳\u0000')
  assert.notEqual(createProductSelectorQueryKey({
    currencyCode: 'TWD',
    page: 1,
    pageSize: 20,
  }), createProductSelectorQueryKey({
    currencyCode: 'TWD',
    unclassified: true,
    page: 1,
    pageSize: 20,
  }))
  assert.equal(canApplyProductSelectorResponse({
    activeQueryKey: 'new',
    activeVersion: 3,
    requestQueryKey: 'old',
    requestVersion: 2,
    aborted: false,
  }), false)
})

test('采购订单可以使用 CNY 构造稳定查询身份', () => {
  assert.equal(createProductSelectorQueryKey({
    currencyCode: 'CNY',
    keyword: '  采购包材 ',
    supplierValue: 'SUPPLIER_CN_01',
    page: 1,
    pageSize: 20,
  }), 'CNY\u0000采购包材\u0000SUPPLIER_CN_01\u0000\u0000')
})

test('按分类与产品头分组，同名产品头跨分类不合并', () => {
  const groups = groupProductSelectorItems([
    { ...product('A'), categoryName: '微耕机', productHeadName: '四驱四轮' },
    { ...product('B'), categoryName: '微耕机', productHeadName: '四驱四轮' },
    { ...product('C'), categoryName: '运输车', productHeadName: '四驱四轮' },
    { ...product('D'), categoryName: null, productHeadName: null },
  ])

  assert.equal(groups.length, 3)
  assert.deepEqual(groups.map(group => group.items.map(item => item.id)), [
    ['A', 'B'],
    ['C'],
    ['D'],
  ])
  assert.deepEqual(groups.map(group => [
    group.categoryName,
    group.productHeadName,
  ]), [
    ['微耕机', '四驱四轮'],
    ['运输车', '四驱四轮'],
    [null, null],
  ])
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
