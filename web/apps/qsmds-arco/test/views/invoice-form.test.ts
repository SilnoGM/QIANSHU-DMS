import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数与三语文案。
import test from 'node:test'
import en from '../../src/locales/lang/invoice-requests/en.json'
import zhCn from '../../src/locales/lang/invoice-requests/zh-cn.json'
import zhTw from '../../src/locales/lang/invoice-requests/zh-tw.json'
import { formatLineAmount } from '../../src/views/workbenches/invoices/invoice-form.logic'

test('行金额展示文本带千分位，空值用「—」占位', () => {
  assert.equal(formatLineAmount(null), '—')
  assert.equal(formatLineAmount(0), '0')
  assert.equal(formatLineAmount(90000), '90,000')
  assert.equal(formatLineAmount(283500), '283,500')
  assert.equal(formatLineAmount(1234567890), '1,234,567,890')
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
    'invoiceRequest.cost.section',
    'invoiceRequest.cost.serviceFeeRate',
    'invoiceRequest.cost.mailingFee',
    'invoiceRequest.cost.estimatedCost',
    'invoiceRequest.cost.hint',
    'invoiceRequest.cost.rateUnavailable',
    'invoiceRequest.placeholder.productName',
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
