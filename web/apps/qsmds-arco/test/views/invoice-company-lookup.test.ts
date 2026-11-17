import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数。
import test from 'node:test'
import { buildCompanyLookupUrl, COMPANY_LOOKUP_ORIGIN } from '../../src/views/workbenches/invoices/invoice-company-lookup.logic'

test('工商查询链接固定 https 主机并对查询值整体编码', () => {
  assert.equal(COMPANY_LOOKUP_ORIGIN, 'https://www.web393.com')
  // 台湾公司名含中文与括号，必须整体编码，不能拼出第二个查询参数。
  assert.equal(
    buildCompanyLookupUrl('大坑古厝白馬有限公司'),
    'https://www.web393.com/Lq.aspx?q=%E5%A4%A7%E5%9D%91%E5%8F%A4%E5%8E%9D%E7%99%BD%E9%A6%AC%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8',
  )
  // 统编是纯数字，原样进入查询串。
  assert.equal(buildCompanyLookupUrl('42927875'), 'https://www.web393.com/Lq.aspx?q=42927875')
  // 空格、&、? 等保留字符必须编码，避免注入额外参数。
  assert.equal(buildCompanyLookupUrl('A&B ?'), 'https://www.web393.com/Lq.aspx?q=A%26B%20%3F')
  // 首尾空白不影响结果；空值退回查询首页。
  assert.equal(buildCompanyLookupUrl('  42927875  '), 'https://www.web393.com/Lq.aspx?q=42927875')
  assert.equal(buildCompanyLookupUrl('   '), 'https://www.web393.com/Lq.aspx')
  // 主机恒定，不接受任何调用方输入拼接主机。
  for (const value of ['https://evil.example', '//evil.example', '../../etc/passwd']) {
    assert.ok(buildCompanyLookupUrl(value).startsWith('https://www.web393.com/Lq.aspx?q='))
  }
})
