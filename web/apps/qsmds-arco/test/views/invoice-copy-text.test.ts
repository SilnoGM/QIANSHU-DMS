import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数。
import test from 'node:test'
import { buildInvoiceCopyText } from '../../src/views/workbenches/invoices/invoice-status.logic'

const baseRequest = {
  buyerName: '台灣雲端數位科技股份有限公司',
  buyerTaxId: '83920174',
  invoiceRemark: '專案尾款，請於發票備註欄加注合約號：PO-2026-9981',
  recipientName: '林先生',
  recipientPhone: '0912-345-678',
  recipientAddress: '台北市信義區松高路 1 號',
  salesAmount: '270000',
  taxAmount: '13500',
  totalAmount: '283500',
} as const

test('单行明细：不带 [明细行1] 小标题，分组与空行按 2026-10-15 规格', () => {
  const text = buildInvoiceCopyText({
    ...baseRequest,
    lines: [{ lineNo: 1, productName: '機械設備', quantity: 1, unitPrice: '270000', amount: '270000' }],
  })
  assert.equal(text, [
    '【开票信息】',
    '抬头：台灣雲端數位科技股份有限公司',
    '统编：83920174',
    '',
    '品名：機械設備',
    '数量：1',
    '单价：270000',
    '金额：270000',
    '',
    '销售额合计：270000',
    '营业税应税：13500',
    '总计：283500',
    '',
    '发票備註：專案尾款，請於發票備註欄加注合約號：PO-2026-9981',
    '',
    '[发票寄送信息]',
    '姓名：林先生',
    '电话：0912-345-678',
    '地址：台北市信義區松高路 1 號',
  ].join('\n'))
})

test('多行明细：每行带 [明细行N] 小标题并保留空行', () => {
  const text = buildInvoiceCopyText({
    ...baseRequest,
    lines: [
      { lineNo: 1, productName: '焚燒爐', quantity: 1, unitPrice: '90000', amount: '90000' },
      { lineNo: 2, productName: '焚燒爐', quantity: 1, unitPrice: '180000', amount: '180000' },
    ],
  })
  assert.match(text, /统编：83920174\n\n\[明细行1\]\n品名：焚燒爐/u)
  assert.match(text, /金额：90000\n\n\[明细行2\]\n品名：焚燒爐/u)
  assert.match(text, /金额：180000\n\n销售额合计：270000/u)
  assert.equal(text.includes('[明细行1]'), true)
  assert.equal(text.includes('[明细行2]'), true)
})

test('发票备注缺省时留空（冒号后无内容），内部信息不进入文本', () => {
  const text = buildInvoiceCopyText({
    ...baseRequest,
    invoiceRemark: null,
    lines: [{ lineNo: 1, productName: '機械設備', quantity: 1, unitPrice: '270000', amount: '270000' }],
  })
  assert.match(text, /\n发票備註：\n/u)
})
