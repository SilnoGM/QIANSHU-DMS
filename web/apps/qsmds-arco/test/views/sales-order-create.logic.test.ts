import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售订单表单纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  beginSalesOrderSubmission,
  buildCreateSalesOrderRequest,
  calculateSalesOrderLineSubtotal,
  createCatalogSalesOrderLine,
  createCustomSalesOrderLine,
  createSalesOrderFormModel,
  createSalesOrderSubmissionState,
  getSalesOrderApiFailure,
  normalizeSalesOrderAddressDetail,
  parseSalesOrderCurrency,
  replayUnknownSalesOrderSubmission,
  resolveSalesOrderSubmissionFailure,
} from '../../src/views/operations/sales-orders/sales-order-create.logic'

const IDS = {
  country: '11111111-1111-4111-8111-111111111111',
  province: '22222222-2222-4222-8222-222222222222',
  city: '33333333-3333-4333-8333-333333333333',
  product: '44444444-4444-4444-8444-444444444444',
}

function validModel() {
  const model = createSalesOrderFormModel('TWD', '2026-08-20', () => 'line-1')
  model.customerName = ' 王小明 '
  model.customerPhone = ' 0912345678 '
  model.region = {
    countryRegionId: IDS.country,
    provinceStateId: IDS.province,
    cityId: IDS.city,
  }
  model.regionNames = ['中国台湾', '台湾', '高雄市']
  model.addressDetail = ' 苓雅区 中正一路 100 号 3 楼 '
  model.lines = [{
    ...createCatalogSalesOrderLine('line-1'),
    productId: IDS.product,
    productNo: 'P-001',
    name: '收纳包',
    standardUnitPriceAmount: '60.0000',
    actualUnitPriceAmount: '50',
    quantity: '2',
  }]
  model.agreedTotalAmount = '100'
  model.depositDueAmount = '30'
  model.balanceDueAmount = '70'
  return model
}

test('币种路由只接受单值 TWD/MYR，缺失、数组与其他币种均拒绝', () => {
  assert.equal(parseSalesOrderCurrency('TWD'), 'TWD')
  assert.equal(parseSalesOrderCurrency('MYR'), 'MYR')
  assert.equal(parseSalesOrderCurrency(undefined), null)
  assert.equal(parseSalesOrderCurrency(['TWD']), null)
  assert.equal(parseSalesOrderCurrency('CNY'), null)
})

test('现有地区域的 UUID v5 可用于客户地址快照', () => {
  const model = validModel()
  model.region = {
    countryRegionId: '2e30acdf-7559-5fc2-8e00-c5b069d3df8b',
    provinceStateId: 'ee82c572-f653-51d2-98d4-f11ac5928aa1',
    cityId: '78f9134e-3d72-5f6e-9897-ca7e50004229',
  }

  const result = buildCreateSalesOrderRequest(model, 2)
  assert.equal(result.valid, true)
})

test('详细地址执行 NFKC 和全部 Unicode 空白删除，并硬拦截三级、两级或城市前缀', () => {
  assert.equal(
    normalizeSalesOrderAddressDetail(' 苓雅区\t中正一路\u3000100\u00A0号 3 楼 '),
    '苓雅区中正一路100号3楼',
  )
  const model = validModel()
  for (const duplicated of [
    '中国台湾 台湾 高雄市 苓雅区中正一路100号',
    '台湾 高雄市 苓雅区中正一路100号',
    '高雄市 苓雅区中正一路100号',
  ]) {
    model.addressDetail = duplicated
    const result = buildCreateSalesOrderRequest(model, 2)
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(
        result.fieldErrors['customer.addressDetail'],
        '详细地址请勿重复填写已选地区',
      )
    }
  }
})

test('产品数量只接受正整数，目录产品和订单临时产品映射为不同 DTO', () => {
  const model = validModel()
  model.lines.push({
    ...createCustomSalesOrderLine('line-2'),
    name: ' 仅本单礼盒 ',
    description: ' 附丝带 ',
    actualUnitPriceAmount: '20',
    quantity: '1',
  })
  model.agreedTotalAmount = '120'
  model.balanceDueAmount = '90'

  const result = buildCreateSalesOrderRequest(model, 2)
  assert.equal(result.valid, true)
  if (result.valid) {
    assert.deepEqual(result.request.lines, [
      {
        lineType: 'CATALOG',
        productId: IDS.product,
        actualUnitPriceAmount: '50.0000',
        quantity: 2,
      },
      {
        lineType: 'CUSTOM',
        name: '仅本单礼盒',
        description: '附丝带',
        actualUnitPriceAmount: '20.0000',
        quantity: 1,
      },
    ])
  }

  for (const quantity of ['0', '-1', '1.5', '01', '']) {
    model.lines[0]!.quantity = quantity
    const invalid = buildCreateSalesOrderRequest(model, 2)
    assert.equal(invalid.valid, false)
    if (!invalid.valid) {
      assert.equal(invalid.fieldErrors['lines.0.quantity'], '产品数量必须是正整数')
    }
  }
})

test('真实售价乘数量精确汇总，手填总价或定金尾款不相等时硬拦截', () => {
  const model = validModel()
  assert.equal(calculateSalesOrderLineSubtotal(model.lines, 2), '100.00')

  model.agreedTotalAmount = '99'
  let result = buildCreateSalesOrderRequest(model, 2)
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.equal(result.fieldErrors.agreedTotalAmount, '手填销售总价必须与产品明细汇总一致')
  }

  model.agreedTotalAmount = '100'
  model.balanceDueAmount = '69'
  result = buildCreateSalesOrderRequest(model, 2)
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.equal(result.fieldErrors.balanceDueAmount, '约定定金与尾款之和必须等于销售总价')
  }
})

test('未来出单日期被拦截，有效表单生成去空白客户快照和四位金额 DTO', () => {
  const model = validModel()
  model.orderDate = '2026-08-21'
  let result = buildCreateSalesOrderRequest(model, 2, '2026-08-20')
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.equal(result.fieldErrors.orderDate, '出单日期只能选择今天或历史日期')
  }

  model.orderDate = '2026-08-20'
  result = buildCreateSalesOrderRequest(model, 2, '2026-08-20')
  assert.equal(result.valid, true)
  if (result.valid) {
    assert.deepEqual(result.request.customer, {
      name: '王小明',
      phone: '0912345678',
      countryRegionId: IDS.country,
      provinceStateId: IDS.province,
      cityId: IDS.city,
      addressDetail: '苓雅区中正一路100号3楼',
    })
    assert.equal(result.request.agreedTotalAmount, '100.0000')
    assert.equal(result.request.depositDueAmount, '30.0000')
    assert.equal(result.request.balanceDueAmount, '70.0000')
  }
})

test('正式提交时才延迟生成 Key，网络未知结果保留同 Key 与冻结请求供人工重放', () => {
  const built = buildCreateSalesOrderRequest(validModel(), 2)
  assert.equal(built.valid, true)
  if (!built.valid) {
    return
  }
  let keyCalls = 0
  const key = '3e076569-95f2-4fce-8341-70bad4013da6'
  const submitting = beginSalesOrderSubmission(
    createSalesOrderSubmissionState(),
    built.request,
    { authEpoch: 2, requestVersion: 1 },
    () => {
      keyCalls += 1
      return key
    },
  )
  assert.equal(keyCalls, 1)
  assert.equal(Object.isFrozen(submitting.snapshot), true)
  const failure = getSalesOrderApiFailure({ kind: 'network', message: '网络失败' })
  const unknown = resolveSalesOrderSubmissionFailure(submitting, failure)
  assert.equal(unknown.phase, 'unknown')
  if (unknown.phase !== 'unknown') {
    return
  }
  assert.equal(unknown.idempotencyKey, key)
  const replay = replayUnknownSalesOrderSubmission(unknown, {
    authEpoch: 2,
    requestVersion: 2,
  })
  assert.equal(replay.idempotencyKey, key)
  assert.equal(replay.snapshot, unknown.snapshot)
  assert.equal(keyCalls, 1)
})
