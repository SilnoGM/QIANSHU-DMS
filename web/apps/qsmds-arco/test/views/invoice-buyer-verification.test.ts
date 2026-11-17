import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数。
import test from 'node:test'
import { canVerifyBuyer, resolveVerificationQuery } from '../../src/views/workbenches/invoices/invoice-buyer-verification.logic'

test('核验查询值优先统编，占位号或个人抬头回退名称', () => {
  assert.equal(resolveVerificationQuery('大坑古厝白馬有限公司', '42927875'), '42927875')
  assert.equal(resolveVerificationQuery('大坑古厝白馬有限公司', ' 42927875 '), '42927875')
  // 个人抬头用占位统编时必须用名称查询。
  assert.equal(resolveVerificationQuery('劉宗田', '00000000'), '劉宗田')
  // 统编为空同样回退名称。
  assert.equal(resolveVerificationQuery('  劉宗田  ', ''), '劉宗田')
  // 两者都空返回空串，调用方据此阻止打开查询页。
  assert.equal(resolveVerificationQuery('   ', ''), '')
  assert.equal(resolveVerificationQuery('', '   '), '')
})

test('开关可点击的前提是抬头非空且统编为 8 位数字', () => {
  assert.equal(canVerifyBuyer('大坑古厝白馬有限公司', '42927875'), true)
  assert.equal(canVerifyBuyer('大坑古厝白馬有限公司', ''), false)
  assert.equal(canVerifyBuyer('大坑古厝白馬有限公司', '123'), false)
  assert.equal(canVerifyBuyer('大坑古厝白馬有限公司', '4292787a'), false)
  assert.equal(canVerifyBuyer('  ', '42927875'), false)
})
