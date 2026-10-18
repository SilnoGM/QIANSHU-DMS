import type { ProductListItemDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 产品编辑纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildProductUpdateRequest,
  createProductEditFormModel,
  getProductUpdateFailure,
  hasProductEditChanges,
  reconcileProductUpdateResult,
} from '../../src/views/admin/product-management/edit/product-edit.logic'

function product(overrides: Partial<ProductListItemDto> = {}): ProductListItemDto {
  return {
    attributes: [{ title: '颜色', value: '红色' }],
    categoryId: 'category-1',
    categoryName: '微耕机',
    productHeadId: 'head-1',
    productHeadName: '旱地履带',
    createdAt: '2026-08-13T01:00:00.000Z',
    createdBy: null,
    id: '11111111-1111-4111-8111-111111111111',
    media: {
      images: [],
      mainImage: null,
      videos: [],
    },
    myrSalePrice: { amount: null, currency: 'MYR' },
    name: '原产品',
    productNo: 'P202608130001',
    purchaseCost: { amount: '5.5', currency: 'CNY' },
    status: 'INACTIVE',
    supplier: {
      label: null,
      state: 'UNKNOWN',
      tone: null as never,
      value: 'HISTORICAL',
    },
    twdSalePrice: { amount: '10', currency: 'TWD' },
    updatedAt: '2026-08-13T01:00:00.000Z',
    updatedBy: null,
    version: 3,
    ...overrides,
  }
}

const precisions = {
  myrSalePricePrecision: 2,
  purchaseCostPrecision: 2,
  twdSalePricePrecision: 2,
}

test('详情转换为编辑模型并保留未知历史供应商与稳定属性 key', () => {
  let index = 0
  const model = createProductEditFormModel(product(), () => `row-${++index}`)

  assert.deepEqual(model, {
    attributes: [{ key: 'row-1', title: '颜色', value: '红色' }],
    categoryName: '微耕机',
    myrSalePriceAmount: null,
    name: '原产品',
    productHeadName: '旱地履带',
    purchaseCostAmount: '5.5',
    purchaseCostCurrency: 'CNY',
    status: 'INACTIVE',
    supplierValue: 'HISTORICAL',
    twdSalePriceAmount: '10',
  })
  assert.equal(hasProductEditChanges(model, product(), precisions), false)
})

test('只提交规范化后真实变化字段和 expectedVersion', () => {
  const source = product()
  const model = createProductEditFormModel(source, () => 'row-1')
  model.name = ' 新产品 '
  model.categoryName = ' 新分类 '
  model.productHeadName = ' 新产品头 '
  model.purchaseCostAmount = '7.2'
  model.attributes[0]!.value = ' 蓝色 '

  assert.deepEqual(buildProductUpdateRequest(model, source, precisions), {
    request: {
      attributes: [{ title: '颜色', value: '蓝色' }],
      categoryName: '新分类',
      expectedVersion: 3,
      name: '新产品',
      productHeadName: '新产品头',
      purchaseCost: { amount: '7.20', currency: 'CNY' },
    },
    valid: true,
  })
})

test('格式差异不制造 Patch，空差异显式返回 unchanged', () => {
  const source = product()
  const model = createProductEditFormModel(source, () => 'row-1')
  model.name = ' 原产品 '
  model.twdSalePriceAmount = '10.00'
  model.purchaseCostAmount = '5.50'

  assert.deepEqual(buildProductUpdateRequest(model, source, precisions), {
    unchanged: true,
    valid: true,
  })
  assert.equal(hasProductEditChanges(model, source, precisions), false)
})

test('网络或 5xx 标记为需 GET 对账，409 单独进入冲突态', () => {
  assert.deepEqual(getProductUpdateFailure({
    body: {
      code: 'PRODUCT_STATE_CHANGED',
      message: '产品已变化',
      requestId: 'request-409',
    },
    kind: 'http',
    status: 409,
  }), {
    code: 'PRODUCT_STATE_CHANGED',
    fieldErrors: {},
    message: '产品已变化',
    phase: 'conflict',
    requestId: 'request-409',
  })
  assert.equal(getProductUpdateFailure({ kind: 'network' }).phase, 'reconciling')
  assert.equal(getProductUpdateFailure({ kind: 'http', status: 500 }).phase, 'reconciling')
  assert.equal(getProductUpdateFailure({ kind: 'http', status: 422 }).phase, 'editing')
})

test('GET 对账只在 version+1 且提交字段全部匹配时收敛成功', () => {
  const request = {
    expectedVersion: 3,
    name: '新产品',
    purchaseCost: { amount: '7.20', currency: 'CNY' },
  } as const
  const updated = product({
    name: '新产品',
    purchaseCost: { amount: '7.2', currency: 'CNY' },
    version: 4,
  })

  assert.equal(reconcileProductUpdateResult(request, updated), 'success')
  assert.equal(reconcileProductUpdateResult(request, {
    ...updated,
    version: 5,
  }), 'unknown')
  assert.equal(reconcileProductUpdateResult(request, {
    ...updated,
    name: '其他修改',
  }), 'unknown')
})
