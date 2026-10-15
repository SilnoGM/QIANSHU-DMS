import assert from 'node:assert/strict'
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
  }
})
