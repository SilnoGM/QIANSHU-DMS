import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数与三语文案。
import test from 'node:test'
import en from '../../src/locales/lang/invoice-requests/en.json'
import zhCn from '../../src/locales/lang/invoice-requests/zh-cn.json'
import zhTw from '../../src/locales/lang/invoice-requests/zh-tw.json'
import { buildInvoiceSubmitPayload, calculateInvoiceTotals, INVOICE_TOTAL_TOLERANCE_CENTS } from '../../src/views/workbenches/invoices/invoice-form.logic'

test('票面总计：税额作残差，容差 0.5 元', () => {
  assert.equal(INVOICE_TOTAL_TOLERANCE_CENTS, 50)
  const lines = [{ productName: 'X', quantity: '1', unitPrice: '43810' }]

  // 不填总计：维持 5% 口径（43810 × 5% = 2190.5 → 2191 / 46001）。
  const auto = calculateInvoiceTotals(lines)
  assert.deepEqual(
    { sales: auto.salesAmount, tax: auto.taxAmount, total: auto.totalAmount, adjusted: auto.taxAdjusted, invalid: auto.totalInvalid },
    { sales: 43810, tax: 2191, total: 46001, adjusted: false, invalid: false },
  )

  // 票面 46,000：税额 2,190，正在容差边界（0.5 元）。
  const paper = calculateInvoiceTotals(lines, '46000')
  assert.deepEqual(
    { sales: paper.salesAmount, tax: paper.taxAmount, total: paper.totalAmount, adjusted: paper.taxAdjusted, invalid: paper.totalInvalid, computed: paper.computedTotalAmount },
    { sales: 43810, tax: 2190, total: 46000, adjusted: true, invalid: false, computed: 46001 },
  )

  // 差 2 元越界：金额卡回退到自动口径，由输入框标红。
  const invalid = calculateInvoiceTotals(lines, '46002')
  assert.equal(invalid.totalInvalid, true)
  assert.equal(invalid.taxAmount, 2191)
  assert.equal(invalid.totalAmount, 46001)

  // 留空与非法输入。
  assert.equal(calculateInvoiceTotals(lines, '  ').totalInvalid, false)
  assert.equal(calculateInvoiceTotals(lines, 'abc').totalInvalid, true)
  assert.deepEqual(calculateInvoiceTotals([{ productName: 'X', quantity: '', unitPrice: '1' }], '46000').computedTotalAmount, null)
})

test('提交载荷带上票面总计，越界时定位到 totalAmount', () => {
  const base = {
    buyerName: '大坑古厝白馬有限公司',
    buyerTaxId: '42927875',
    invoiceRemark: '',
    internalRemark: '',
    recipientName: '李弇義',
    recipientPhone: '0939298738',
    recipientAddress: '台南市新化區',
    lines: [{ productName: '历史开票导入', quantity: '1', unitPrice: '43810' }],
  }
  const ok = buildInvoiceSubmitPayload({ ...base, totalAmount: '46000' })
  assert.ok('payload' in ok)
  assert.equal(ok.payload.totalAmount, '46000')

  // 留空：不发送该字段，服务端按 5% 计算。
  const blank = buildInvoiceSubmitPayload({ ...base, totalAmount: '  ' })
  assert.ok('payload' in blank)
  assert.equal('totalAmount' in blank.payload, false)

  assert.deepEqual(buildInvoiceSubmitPayload({ ...base, totalAmount: '46002' }), { invalidField: 'totalAmount' })
  assert.deepEqual(buildInvoiceSubmitPayload({ ...base, totalAmount: '0' }), { invalidField: 'totalAmount' })
  // 总计小于销售额必然越界。
  assert.deepEqual(buildInvoiceSubmitPayload({ ...base, totalAmount: '43000' }), { invalidField: 'totalAmount' })
})

test('开票申请三语文案键保持对齐', () => {
  const zhCnKeys = Object.keys(zhCn).sort()
  assert.deepEqual(Object.keys(zhTw).sort(), zhCnKeys)
  assert.deepEqual(Object.keys(en).sort(), zhCnKeys)
})

test('明细区新增文案键与占位符在三语中都存在', () => {
  const messages = [zhCn, zhTw, en] as const
  for (const key of [
    'invoiceRequest.form.unitPriceExTax',
    'invoiceRequest.form.amountHint',
    'invoiceRequest.form.totalPreview',
    'invoiceRequest.form.taxAmountWithRate',
    'invoiceRequest.form.totalAmountHint',
    'invoiceRequest.form.taxToleranceHint',
    'invoiceRequest.form.taxAdjusted',
    'invoiceRequest.error.totalTolerance',
    'invoiceRequest.cost.section',
    'invoiceRequest.cost.serviceFeeRate',
    'invoiceRequest.cost.mailingFee',
    'invoiceRequest.cost.estimatedCost',
    'invoiceRequest.cost.hint',
    'invoiceRequest.cost.rateUnavailable',
    'invoiceRequest.placeholder.productName',
    'invoiceRequest.column.buyer',
    'invoiceRequest.column.recipient',
  ] as const) {
    for (const message of messages) {
      const value = (message as Record<string, string>)[key]
      assert.equal(typeof value, 'string', `${key} 缺少译文`)
      assert.notEqual(value.trim(), '', `${key} 不能为空`)
    }
  }
  for (const message of messages) {
    // 计数按钮依赖 {current}/{limit} 插值，缺占位符会原样显示花括号。
    assert.match((message as Record<string, string>)['invoiceRequest.form.addLine'], /\{current\}\/\{limit\}/u)
    // 预估成本的提示行要带当前汇率插值。
    assert.match((message as Record<string, string>)['invoiceRequest.cost.hint'], /\{rate\}/u)
  }
})

async function readPageSource(): Promise<string> {
  return readFile(new URL('../../src/views/workbenches/invoices/records/create.vue', import.meta.url), 'utf8')
}

test('提交收尾发生在释放提交态之后，且提交中硬阻止离开的语义保留', async () => {
  const source = await readPageSource()
  // 回归保护：曾有顺序缺陷——单已在服务端建成，但「关弹窗/切弹窗/跳转」跑在
  // finally 释放 submitting 之前，被弹窗的程序化关闭守卫（回写开启）与路由
  // 离开守卫（return false）双双静默拦下，表现为弹窗不关、不跳转。
  const finallyIndex = source.indexOf('finally {')
  assert.ok(finallyIndex > -1, 'send() 必须保留 finally 释放 submitting')
  for (const marker of [
    'confirmOpen.value = false',
    'duplicateOpen.value = true',
    'router.push({ name: \'qsOperationsInvoicesRecords\' })',
  ]) {
    const markerIndex = source.indexOf(marker)
    assert.ok(markerIndex > -1, `缺少收尾语句：${marker}`)
    assert.ok(markerIndex > finallyIndex, `收尾必须发生在 finally 之后：${marker}`)
  }
  // R10-3 的「提交进行中硬阻止」必须保留：本次只调整收尾顺序，不放宽守卫。
  assert.match(source, /onBeforeRouteLeave\(\(\) => \{\n {2}if \(submitting\.value\) \{\n {4}return false/u)
})
