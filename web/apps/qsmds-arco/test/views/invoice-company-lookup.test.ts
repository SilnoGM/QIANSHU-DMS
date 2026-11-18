import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数。
import test from 'node:test'
import { buildCompanyLookupUrl, COMPANY_LOOKUP_ORIGIN, isCompanyLookupTaxId } from '../../src/views/workbenches/invoices/invoice-company-lookup.logic'

test('工商查询链接固定 https 主机并按统编拼路径', () => {
  assert.equal(COMPANY_LOOKUP_ORIGIN, 'https://company.g0v.ronny.tw')
  assert.equal(buildCompanyLookupUrl('42927875'), 'https://company.g0v.ronny.tw/id/42927875')
  // 首尾空白不影响结果；空值退回站点首页。
  assert.equal(buildCompanyLookupUrl('  42927875  '), 'https://company.g0v.ronny.tw/id/42927875')
  assert.equal(buildCompanyLookupUrl('   '), 'https://company.g0v.ronny.tw')
  // 主机恒定，不接受任何调用方输入拼接主机；路径段整体编码。
  for (const value of ['https://evil.example', '//evil.example', '../../etc/passwd']) {
    assert.ok(buildCompanyLookupUrl(value).startsWith('https://company.g0v.ronny.tw/id/'))
  }
  assert.equal(buildCompanyLookupUrl('a b'), 'https://company.g0v.ronny.tw/id/a%20b')
})

test('只有真实 8 位统编可查询，个人占位 00000000 不查', () => {
  assert.equal(isCompanyLookupTaxId('42927875'), true)
  assert.equal(isCompanyLookupTaxId(' 42927875 '), true)
  assert.equal(isCompanyLookupTaxId('00000000'), false)
  assert.equal(isCompanyLookupTaxId(''), false)
  assert.equal(isCompanyLookupTaxId('123'), false)
  assert.equal(isCompanyLookupTaxId('4292787a'), false)
})
