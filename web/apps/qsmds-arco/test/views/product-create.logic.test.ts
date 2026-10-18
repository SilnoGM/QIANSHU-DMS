import type { CreateProductRequestDto, ProductListItemDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 产品创建纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  abandonUnknownProductCreate,
  appendProductAttribute,
  beginProductCreateSubmission,
  buildCreateProductRequest,
  canApplyProductCreateResponse,
  createProductAttributeRow,
  createProductCreateFormModel,
  createProductCreateSubmissionState,
  getProductCreateApiFailure,
  hasProductCreateChanges,
  isProductCreateAbortError,
  moveProductAttribute,
  removeProductAttribute,
  replayUnknownProductCreate,
  resolveProductCreateFailure,
  resolveProductCreateSuccess,
  updateProductAttribute,
} from '../../src/views/admin/product-management/create/product-create.logic'

const FIRST_KEY = '3e076569-95f2-4fce-8341-70bad4013da6'
const SECOND_KEY = '79f357f3-f5f2-46cd-9b7b-f17f6be590b6'

function validModel() {
  const model = createProductCreateFormModel()
  model.name = '  Cafe\u0301 收纳包  '
  model.supplierValue = ' supplier-a '
  model.twdSalePriceAmount = '88.5'
  model.myrSalePriceAmount = '12.50'
  model.purchaseCostAmount = '10'
  model.categoryName = ' 微耕机 '
  model.productHeadName = ' 旱地履带 '
  model.attributes.push(createProductAttributeRow('row-1', ' 颜色 ', ' 黑色 '))
  return model
}

function validRequest(): CreateProductRequestDto {
  const result = buildCreateProductRequest(validModel(), {
    myrSalePricePrecision: 2,
    purchaseCostPrecision: 2,
    twdSalePricePrecision: 2,
  })
  assert.equal(result.valid, true)
  return result.request
}

test('默认 model 符合创建契约，属性 row key 稳定且 dirty 比较不忽略任何可写字段', () => {
  const model = createProductCreateFormModel()
  assert.deepEqual(model, {
    attributes: [],
    categoryName: null,
    myrSalePriceAmount: null,
    name: '',
    productHeadName: null,
    purchaseCostAmount: null,
    purchaseCostCurrency: 'CNY',
    status: 'ACTIVE',
    supplierValue: null,
    twdSalePriceAmount: null,
  })
  assert.equal(hasProductCreateChanges(model), false)

  const row = createProductAttributeRow('stable-row', '颜色', '黑色')
  model.attributes.push(row)
  row.title = '尺寸'
  assert.equal(row.key, 'stable-row')
  assert.equal(hasProductCreateChanges(model), true)

  model.attributes = []
  model.purchaseCostCurrency = 'USD'
  assert.equal(hasProductCreateChanges(model), true)
})

test('属性编辑保持稳定 key、不变更新与顺序，并严格限制 50 项', () => {
  const first = createProductAttributeRow('row-1', '颜色', '黑色')
  const second = createProductAttributeRow('row-2', '尺寸', 'XL')
  const rows = [first, second]
  const updated = updateProductAttribute(rows, 0, 'value', '白色')
  const moved = moveProductAttribute(updated, 0, 'down')
  const removed = removeProductAttribute(moved, 0)

  assert.deepEqual(updated, [
    { key: 'row-1', title: '颜色', value: '白色' },
    second,
  ])
  assert.notEqual(updated, rows)
  assert.notEqual(updated[0], first)
  assert.deepEqual(moved.map(row => row.key), ['row-2', 'row-1'])
  assert.deepEqual(removed.map(row => row.key), ['row-1'])
  assert.equal(moveProductAttribute(rows, 0, 'up'), rows)
  assert.equal(moveProductAttribute(rows, 1, 'down'), rows)
  assert.equal(removeProductAttribute(rows, -1), rows)

  const maximum = Array.from({ length: 50 }, (_value, index) =>
    createProductAttributeRow(`row-${index}`))
  assert.equal(appendProductAttribute(maximum, () => 'overflow'), maximum)
  assert.deepEqual(appendProductAttribute([], () => 'new-row'), [{
    key: 'new-row',
    title: '',
    value: '',
  }])
})

test('DTO builder 执行 trim/NFC、严格 MoneyInput 校验并丢弃 Vue row key', () => {
  const result = buildCreateProductRequest(validModel(), {
    myrSalePricePrecision: 2,
    purchaseCostPrecision: 2,
    twdSalePricePrecision: 2,
  })

  assert.deepEqual(result, {
    request: {
      attributes: [{ title: '颜色', value: '黑色' }],
      categoryName: '微耕机',
      myrSalePrice: { amount: '12.50', currency: 'MYR' },
      name: 'Café 收纳包',
      productHeadName: '旱地履带',
      purchaseCost: { amount: '10.00', currency: 'CNY' },
      status: 'ACTIVE',
      supplierValue: 'supplier-a',
      twdSalePrice: { amount: '88.50', currency: 'TWD' },
    },
    valid: true,
  })

  const invalid = validModel()
  invalid.status = 'ACTIVE'
  invalid.supplierValue = null
  invalid.twdSalePriceAmount = '01.20'
  invalid.attributes[0]!.title = '   '
  assert.deepEqual(buildCreateProductRequest(invalid, {
    myrSalePricePrecision: 2,
    purchaseCostPrecision: 2,
    twdSalePricePrecision: 2,
  }), {
    fieldErrors: {
      'attributes.0.title': '属性标题不能为空',
      'supplierValue': '请选择供应商',
      'twdSalePrice.amount': '请输入正确的金额，例如 1234.50',
    },
    valid: false,
  })
})

test('创建时分类与产品头必填', () => {
  const model = validModel()
  model.categoryName = null
  model.productHeadName = null

  assert.deepEqual(buildCreateProductRequest(model, {
    myrSalePricePrecision: 2,
    purchaseCostPrecision: 2,
    twdSalePricePrecision: 2,
  }), {
    fieldErrors: {
      categoryName: '请选择分类',
      productHeadName: '请选择产品头',
    },
    valid: false,
  })
})

test('金额使用 Catalog minorUnit 且不转 number，覆盖 null、精度与 26 位整数边界', () => {
  const model = validModel()
  model.twdSalePriceAmount = null
  model.myrSalePriceAmount = '1.234'
  model.purchaseCostAmount = '999999999999999999999999999.99'
  const result = buildCreateProductRequest(model, {
    myrSalePricePrecision: 2,
    purchaseCostPrecision: 2,
    twdSalePricePrecision: 0,
  })
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.equal(result.fieldErrors['myrSalePrice.amount'], '金额最多支持 2 位小数')
    assert.equal(result.fieldErrors['purchaseCost.amount'], '金额不能大于 99999999999999999999999999.99')
    assert.equal(result.fieldErrors['twdSalePrice.amount'], undefined)
  }
})

test('字段错误 parser 只接受精确白名单路径并保留安全 requestId', () => {
  const failure = getProductCreateApiFailure({
    body: {
      code: 'VALIDATION_FAILED',
      fieldErrors: {
        'attributes.0.title': ['第一个标题错误'],
        'attributes.49.value': ['第五十个值错误'],
        'attributes.50.title': ['越界'],
        'attributes.__proto__.title': ['攻击路径'],
        'purchaseCost.currency': ['货币错误'],
        'twdSalePrice.amount': ['金额错误'],
        'name': ['名称错误'],
        'unknown': ['未知'],
      },
      message: '请求参数校验失败',
      requestId: 'request-safe',
    },
    kind: 'http',
    status: 422,
  })

  assert.deepEqual(failure, {
    code: 'VALIDATION_FAILED',
    fieldErrors: {
      'attributes.0.title': '第一个标题错误',
      'attributes.49.value': '第五十个值错误',
      'purchaseCost.currency': '货币错误',
      'twdSalePrice.amount': '金额错误',
      'name': '名称错误',
    },
    hasUnmappedFieldErrors: true,
    message: '请求参数校验失败',
    requestId: 'request-safe',
    unknownResult: false,
  })
})

test('首次提交延迟生成 Key 并深冻结 snapshot，确定失败解锁且下次使用新 Key', () => {
  let keyCalls = 0
  const keys = [FIRST_KEY, SECOND_KEY]
  const keyFactory = () => keys[keyCalls++]!
  const request = validRequest()
  const editing = createProductCreateSubmissionState()
  assert.equal(keyCalls, 0)

  const submitting = beginProductCreateSubmission(editing, request, {
    authEpoch: 7,
    requestVersion: 1,
  }, keyFactory)
  assert.equal(keyCalls, 1)
  assert.equal(submitting.phase, 'submitting')
  assert.equal(submitting.idempotencyKey, FIRST_KEY)
  assert.equal(Object.isFrozen(submitting.snapshot), true)
  assert.equal(Object.isFrozen(submitting.snapshot.attributes), true)
  assert.equal(Object.isFrozen(submitting.snapshot.attributes[0]), true)
  request.name = '被修改'
  request.attributes[0]!.title = '被修改'
  assert.equal(submitting.snapshot.name, 'Café 收纳包')
  assert.equal(submitting.snapshot.attributes[0]!.title, '颜色')

  const deterministic = resolveProductCreateFailure(submitting, {
    code: 'VALIDATION_FAILED',
    fieldErrors: { name: '名称错误' },
    hasUnmappedFieldErrors: false,
    message: '请求参数校验失败',
    requestId: 'request-1',
    unknownResult: false,
  })
  assert.equal(deterministic.phase, 'editing')
  assert.equal('idempotencyKey' in deterministic, false)

  const second = beginProductCreateSubmission(deterministic, validRequest(), {
    authEpoch: 7,
    requestVersion: 2,
  }, keyFactory)
  assert.equal(second.idempotencyKey, SECOND_KEY)
  assert.equal(keyCalls, 2)
})

test('network/5xx 进入 unknown 并保留同 Key/Payload，只能人工重放或显式放弃', () => {
  const request = validRequest()
  const submitting = beginProductCreateSubmission(
    createProductCreateSubmissionState(),
    request,
    { authEpoch: 9, requestVersion: 3 },
    () => FIRST_KEY,
  )
  const networkFailure = getProductCreateApiFailure({
    kind: 'network',
    message: '网络连接失败，请稍后重试',
  })
  const unknown = resolveProductCreateFailure(submitting, networkFailure)
  assert.equal(unknown.phase, 'unknown')
  assert.equal(unknown.idempotencyKey, FIRST_KEY)
  assert.equal(unknown.snapshot, submitting.snapshot)

  const replay = replayUnknownProductCreate(unknown, {
    authEpoch: 9,
    requestVersion: 4,
  })
  assert.equal(replay.phase, 'submitting')
  assert.equal(replay.idempotencyKey, FIRST_KEY)
  assert.equal(replay.snapshot, unknown.snapshot)

  const unknownAgain = resolveProductCreateFailure(replay, getProductCreateApiFailure({
    body: { code: 'INTERNAL_ERROR', message: '服务异常', requestId: 'request-5' },
    kind: 'http',
    status: 500,
  }))
  assert.equal(unknownAgain.phase, 'unknown')
  assert.equal(abandonUnknownProductCreate(unknownAgain).phase, 'editing')
})

test('成功状态保留返回 Product，迟到响应同时受身份、权限、请求版本与 Abort 约束', () => {
  const submitting = beginProductCreateSubmission(
    createProductCreateSubmissionState(),
    validRequest(),
    { authEpoch: 4, requestVersion: 8 },
    () => FIRST_KEY,
  )
  const product = { productNo: 'PRODUCT-0001' } as ProductListItemDto
  const success = resolveProductCreateSuccess(submitting, product)
  assert.equal(success.phase, 'success')
  assert.equal(success.product.productNo, 'PRODUCT-0001')

  const current = {
    aborted: false,
    authorized: true,
    authEpoch: 4,
    currentAuthEpoch: 4,
    latestRequestVersion: 8,
    requestVersion: 8,
  }
  assert.equal(canApplyProductCreateResponse(current), true)
  assert.equal(canApplyProductCreateResponse({ ...current, aborted: true }), false)
  assert.equal(canApplyProductCreateResponse({ ...current, authorized: false }), false)
  assert.equal(canApplyProductCreateResponse({ ...current, currentAuthEpoch: 5 }), false)
  assert.equal(canApplyProductCreateResponse({ ...current, latestRequestVersion: 9 }), false)
  assert.equal(isProductCreateAbortError(new DOMException('aborted', 'AbortError')), true)
  assert.equal(isProductCreateAbortError({ code: 'ERR_CANCELED' }), true)
  assert.equal(isProductCreateAbortError({ name: 'CanceledError' }), true)
  assert.equal(isProductCreateAbortError(new Error('failed')), false)
})
