import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售订单表单纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  beginSalesOrderSubmission,
  buildCreateSalesOrderRequest,
  calculateSalesOrderLineSubtotal,
  createCatalogSalesOrderLine,
  createCustomSalesOrderLine,
  createSalesOrderDocumentAutoTitle,
  createSalesOrderFormModel,
  createSalesOrderSubmissionState,
  customizeSalesOrderDocumentTitle,
  formatSalesOrderDocumentTitleTimestamp,
  getSalesOrderApiFailure,
  normalizeSalesOrderAddressDetail,
  parseSalesOrderCurrency,
  refreshSalesOrderDocumentAutoTitle,
  replayUnknownSalesOrderSubmission,
  resolveSalesOrderCreateStepForErrors,
  resolveSalesOrderIssuerLabel,
  resolveSalesOrderSubmissionFailure,
  validateSalesOrderCreateStep,
} from '../../src/views/operations/sales-orders/sales-order-create.logic'

const IDS = {
  country: '11111111-1111-4111-8111-111111111111',
  province: '22222222-2222-4222-8222-222222222222',
  city: '33333333-3333-4333-8333-333333333333',
  product: '44444444-4444-4444-8444-444444444444',
}

function validModel() {
  const model = createSalesOrderFormModel('TWD', '2026-08-20')
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

test('新增销售订单默认使用空产品明细，用户添加后才创建产品行', () => {
  const model = createSalesOrderFormModel('TWD', '2026-08-20')

  assert.deepEqual(model.lines, [])
  assert.equal(createCatalogSalesOrderLine('catalog').actualUnitPriceAmount, '0.00')
  assert.equal(createCustomSalesOrderLine('custom').actualUnitPriceAmount, '0.00')
})

test('出单人优先显示当前用户显示名，缺失时回退用户名', () => {
  assert.equal(resolveSalesOrderIssuerLabel(' 超级管理员 ', 'system_admin'), '超级管理员')
  assert.equal(resolveSalesOrderIssuerLabel('   ', ' system_admin '), 'system_admin')
  assert.equal(resolveSalesOrderIssuerLabel('', ''), '当前用户资料不可用')
})

test('正式保存校验失败时回到最早包含错误的填写步骤', () => {
  assert.equal(resolveSalesOrderCreateStepForErrors({ orderDate: '请选择日期' }), 0)
  assert.equal(resolveSalesOrderCreateStepForErrors({ 'customer.phone': '请输入电话' }), 1)
  assert.equal(resolveSalesOrderCreateStepForErrors({
    'lines.0.productId': '请选择产品',
    'documents.0.title': '标题无效',
  }), 2)
  assert.equal(resolveSalesOrderCreateStepForErrors({ remark: '备注过长' }), 3)
  assert.equal(resolveSalesOrderCreateStepForErrors({ unknownField: '未知字段错误' }), null)
  assert.equal(resolveSalesOrderCreateStepForErrors({}), null)
})

test('客户步骤只返回当前步骤错误，防重复失败时不能继续', () => {
  const model = validModel()
  model.addressDetail = '中国台湾 台湾 高雄市 苓雅区中正一路100号'
  model.agreedTotalAmount = '99'
  model.balanceDueAmount = '69'

  const invalid = validateSalesOrderCreateStep(model, 1, 2)
  assert.equal(invalid.valid, false)
  if (!invalid.valid) {
    assert.deepEqual(invalid.fieldErrors, {
      'customer.addressDetail': '详细地址请勿重复填写已选地区',
    })
  }

  model.addressDetail = '苓雅区中正一路100号'
  model.customerName = '王小明'
  model.lines[0]!.productId = null
  const valid = validateSalesOrderCreateStep(model, 1, 2)
  assert.deepEqual(valid, { valid: true })
})

test('产品与销售步骤分别硬拦截明细总价和定金尾款不一致', () => {
  const model = validModel()
  model.addressDetail = '中国台湾 台湾 高雄市 苓雅区中正一路100号'
  model.agreedTotalAmount = '99'
  model.balanceDueAmount = '69'

  let result = validateSalesOrderCreateStep(model, 2, 2)
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.deepEqual(result.fieldErrors, {
      agreedTotalAmount: '手填销售总价必须与产品明细汇总一致',
    })
  }

  model.agreedTotalAmount = '100'
  result = validateSalesOrderCreateStep(model, 2, 2)
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.deepEqual(result.fieldErrors, {
      balanceDueAmount: '定金与尾款之和必须等于销售总价',
    })
  }

  model.balanceDueAmount = '70'
  assert.deepEqual(validateSalesOrderCreateStep(model, 2, 2), { valid: true })
})

test('凭证自动标题保留上传时间，联动客户与类型，手工编辑后停止覆盖', () => {
  const timestamp = formatSalesOrderDocumentTitleTimestamp(
    new Date(2026, 7, 21, 15, 30, 45, 123),
  )
  assert.equal(timestamp, '20260821153045123')
  assert.equal(
    createSalesOrderDocumentAutoTitle(' 王小明 ', 'DEPOSIT_VOUCHER', timestamp),
    '王小明-定金凭证-20260821153045123',
  )
  assert.equal(
    createSalesOrderDocumentAutoTitle('　Ａ王　', 'OTHER', timestamp),
    'A王-其他-20260821153045123',
  )
  assert.equal(
    createSalesOrderDocumentAutoTitle('', 'OTHER', timestamp),
    '未填写客户-其他-20260821153045123',
  )

  const document = {
    mediaAssetId: '55555555-5555-4555-8555-555555555555',
    mediaType: 'IMAGE' as const,
    mimeType: 'image/png',
    sizeBytes: '128',
    originalFilename: 'voucher.png',
    key: 'document-1',
    documentType: 'OTHER' as const,
    title: createSalesOrderDocumentAutoTitle('王小明', 'OTHER', timestamp),
    remark: '',
    autoTitleTimestamp: timestamp,
    titleManuallyEdited: false,
  }
  const model = validModel()
  model.documents = [document]
  const requestResult = buildCreateSalesOrderRequest(model, 2)
  assert.equal(requestResult.valid, true)
  if (requestResult.valid) {
    assert.deepEqual(requestResult.request.documents, [{
      mediaAssetId: document.mediaAssetId,
      documentType: 'OTHER',
      title: document.title,
      remark: null,
    }])
  }

  const refreshed = refreshSalesOrderDocumentAutoTitle(
    document,
    '李小明',
    'DELIVERY_RECEIPT',
  )
  assert.equal(refreshed.title, '李小明-签收单-20260821153045123')
  assert.equal(refreshed.autoTitleTimestamp, timestamp)

  const customized = customizeSalesOrderDocumentTitle(refreshed, '客户指定标题')
  const preserved = refreshSalesOrderDocumentAutoTitle(customized, '陈小明', 'OTHER')
  assert.equal(preserved.documentType, 'OTHER')
  assert.equal(preserved.title, '客户指定标题')
  assert.equal(preserved.titleManuallyEdited, true)

  const cleared = customizeSalesOrderDocumentTitle(refreshed, '')
  assert.equal(refreshSalesOrderDocumentAutoTitle(cleared, '陈小明').title, '')
})

test('凭证自动标题截断超长客户名并完整保留类型和时间戳后缀', () => {
  const timestamp = '20260821153045123'
  const title = createSalesOrderDocumentAutoTitle('王'.repeat(200), 'OTHER', timestamp)

  assert.equal([...title].length, 128)
  assert.equal(title.endsWith(`-其他-${timestamp}`), true)
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

test('详细地址保留原文字形，并硬拦截地区全名、简称与台湾繁体前缀', () => {
  assert.equal(
    normalizeSalesOrderAddressDetail(' 苓雅区\t中正一路\u3000100\u00A0号 3 楼 '),
    '苓雅区中正一路100号3楼',
  )
  assert.equal(
    normalizeSalesOrderAddressDetail(' 台灣\t新竹縣\u3000測試區 22 號 '),
    '台灣新竹縣測試區22號',
  )
  const model = validModel()
  model.regionNames = ['中国台湾', '台湾', '新竹县']
  for (const duplicated of [
    '中国台湾 台湾 新竹县 测试区测试22号',
    '台湾 新竹县 测试区测试22号',
    '台湾 新竹 测试区测试22号',
    '新竹县 测试区测试22号',
    '新竹 测试区测试22号',
    '中國臺灣 臺灣 新竹縣 測試區測試22號',
    '台灣 新竹縣 測試區測試22號',
    '臺灣 新竹 測試區測試22號',
    '新竹縣 測試區測試22號',
  ]) {
    model.addressDetail = duplicated
    const result = validateSalesOrderCreateStep(model, 1, 2)
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(
        result.fieldErrors['customer.addressDetail'],
        '详细地址请勿重复填写已选地区',
      )
    }
  }

  for (const [simplifiedCity, traditionalCity] of [
    ['连江县', '連江縣'],
    ['金门县', '金門縣'],
    ['宜兰县', '宜蘭縣'],
    ['云林县', '雲林縣'],
    ['嘉义县', '嘉義縣'],
    ['屏东县', '屏東縣'],
    ['花莲县', '花蓮縣'],
    ['桃园市', '桃園市'],
  ] as const) {
    model.regionNames = ['中国台湾', '台湾', simplifiedCity]
    model.addressDetail = `${traditionalCity}測試區測試22號`
    const result = validateSalesOrderCreateStep(model, 1, 2)
    assert.equal(result.valid, false)
  }

  model.regionNames = ['中国台湾', '台湾', '新竹县']
  for (const allowed of [
    '测试区测试22号',
    '測試區測試22號',
    '测试区台湾新竹县22号',
    '台湾新竹市测试区测试22号',
  ]) {
    model.addressDetail = allowed
    assert.deepEqual(validateSalesOrderCreateStep(model, 1, 2), { valid: true })
  }

  model.addressDetail = '桃園路 22 號'
  const preserved = buildCreateSalesOrderRequest(model, 2)
  assert.equal(preserved.valid, true)
  if (preserved.valid) {
    assert.equal(
      preserved.request.customer.addressDetail,
      '桃園路22號',
    )
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
        actualUnitPriceAmount: '50.00',
        quantity: 2,
      },
      {
        lineType: 'CUSTOM',
        name: '仅本单礼盒',
        description: '附丝带',
        actualUnitPriceAmount: '20.00',
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

test('本单售价接受零和最多两位小数，第三位小数在构造请求前硬拦截', () => {
  const model = validModel()
  for (const [price, total] of [
    ['0', '0'],
    ['1', '2'],
    ['1.2', '2.4'],
    ['1.23', '2.46'],
  ] as const) {
    model.lines[0]!.actualUnitPriceAmount = price
    model.agreedTotalAmount = total
    model.depositDueAmount = '0'
    model.balanceDueAmount = total
    assert.equal(buildCreateSalesOrderRequest(model, 2).valid, true)
  }

  model.lines[0]!.actualUnitPriceAmount = '1.234'
  model.agreedTotalAmount = '2.46'
  model.balanceDueAmount = '2.46'
  const invalid = buildCreateSalesOrderRequest(model, 2)
  assert.equal(invalid.valid, false)
  if (!invalid.valid) {
    assert.equal(
      invalid.fieldErrors['lines.0.actualUnitPriceAmount'],
      '请输入有效的真实售价',
    )
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
    assert.equal(result.fieldErrors.balanceDueAmount, '定金与尾款之和必须等于销售总价')
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
  assert.throws(
    () => replayUnknownSalesOrderSubmission(unknown, {
      authEpoch: 3,
      requestVersion: 3,
    }),
    /身份域变化后不能重放旧的销售订单请求/u,
  )
})
