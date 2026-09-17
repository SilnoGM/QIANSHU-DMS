import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 业务组件纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildPurchaseStartRouteQuery,
  createPurchaseStartSelection,
  normalizeCustomSupplierName,
  resetPurchaseStartSupplierDraft,
  validatePurchaseStartDraft,
} from '../../src/components/business/QsPurchaseStartModal/logic'

test('采购入口统一生成互斥供应商字段和可选销售快捷参数', () => {
  assert.deepEqual(buildPurchaseStartRouteQuery({
    customSupplierName: null,
    productMode: 'CATALOG',
    purchaseType: 'SALES_LINKED',
    supplierValue: 'SUPPLIER_A',
  }), {
    productMode: 'CATALOG',
    supplierValue: 'SUPPLIER_A',
    type: 'SALES_LINKED',
  })
  assert.deepEqual(buildPurchaseStartRouteQuery({
    customSupplierName: '临时供应商',
    productMode: 'CUSTOM',
    purchaseType: 'SALES_LINKED',
    supplierValue: null,
  }, {
    id: '11111111-1111-4111-8111-111111111111',
    orderNo: 'SO/2026-001',
  }), {
    customSupplierName: '临时供应商',
    productMode: 'CUSTOM',
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    salesOrderNo: 'SO/2026-001',
    type: 'SALES_LINKED',
  })
})

test('采购开始草稿按产品模式强制供应商来源互斥', () => {
  assert.deepEqual(createPurchaseStartSelection({
    purchaseType: 'SALES_LINKED',
    productMode: 'CATALOG',
    supplierValue: ' SUPPLIER_A ',
    customSupplierName: '不得保留',
  }), {
    purchaseType: 'SALES_LINKED',
    productMode: 'CATALOG',
    supplierValue: 'SUPPLIER_A',
    customSupplierName: null,
  })
  assert.deepEqual(createPurchaseStartSelection({
    purchaseType: 'STOCK',
    productMode: 'CUSTOM',
    supplierValue: '不得保留',
    customSupplierName: '  Ａ厂  ',
  }), {
    purchaseType: 'STOCK',
    productMode: 'CUSTOM',
    supplierValue: null,
    customSupplierName: 'A厂',
  })
})

test('自定义供应商执行 NFKC、trim 与 1 到 128 code points 校验', () => {
  assert.equal(normalizeCustomSupplierName('  Ａ厂  '), 'A厂')
  assert.deepEqual(validatePurchaseStartDraft({
    productMode: 'CUSTOM',
    supplierValue: null,
    customSupplierName: '厂'.repeat(128),
  }), { valid: true, message: null })
  assert.deepEqual(validatePurchaseStartDraft({
    productMode: 'CUSTOM',
    supplierValue: null,
    customSupplierName: '厂'.repeat(129),
  }), { valid: false, message: '供应商名称不能超过 128 个字符' })
  assert.deepEqual(validatePurchaseStartDraft({
    productMode: 'CUSTOM',
    supplierValue: null,
    customSupplierName: '   ',
  }), { valid: false, message: '请填写供应商名称' })
})

test('切换产品模式会清空两个供应商草稿，避免旧来源串入新模式', () => {
  assert.deepEqual(resetPurchaseStartSupplierDraft(), {
    supplierValue: null,
    customSupplierName: '',
  })
  assert.deepEqual(validatePurchaseStartDraft({
    productMode: 'CATALOG',
    supplierValue: null,
    customSupplierName: '',
  }), { valid: false, message: '请选择供应商' })
})

test('自定义采购路由仅传递随机收款草稿键，不携带账户或图片', () => {
  const query = buildPurchaseStartRouteQuery({ purchaseType: 'STOCK', productMode: 'CUSTOM', supplierValue: null, customSupplierName: '本单供应商', paymentDraftKey: 'random-draft-key' })
  assert.equal(query.paymentDraftKey, 'random-draft-key')
  assert.deepEqual(Object.keys(query).sort(), ['customSupplierName', 'paymentDraftKey', 'productMode', 'type'])
})
