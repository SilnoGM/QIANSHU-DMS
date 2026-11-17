import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数。
import test from 'node:test'
import { canVerifyBuyer, isBuyerVerificationRequired } from '../../src/views/workbenches/invoices/invoice-buyer-verification.logic'

test('真实统编需要核验，个人占位 00000000 豁免', () => {
  assert.equal(isBuyerVerificationRequired('42927875'), true)
  assert.equal(isBuyerVerificationRequired(' 42927875 '), true)
  assert.equal(isBuyerVerificationRequired('00000000'), false)
  assert.equal(isBuyerVerificationRequired(''), false)
  assert.equal(isBuyerVerificationRequired('123'), false)
})

test('开关可点击的前提是抬头非空且统编可用于核验', () => {
  assert.equal(canVerifyBuyer('大坑古厝白馬有限公司', '42927875'), true)
  assert.equal(canVerifyBuyer('大坑古厝白馬有限公司', ''), false)
  assert.equal(canVerifyBuyer('大坑古厝白馬有限公司', '123'), false)
  assert.equal(canVerifyBuyer('大坑古厝白馬有限公司', '4292787a'), false)
  assert.equal(canVerifyBuyer('  ', '42927875'), false)
  // 个人抬头没有企业登记记录，开关不可用。
  assert.equal(canVerifyBuyer('劉宗田', '00000000'), false)
})
