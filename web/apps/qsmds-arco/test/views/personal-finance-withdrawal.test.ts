import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 提款金额校验是纯逻辑，使用 Node.js 内置 runner 验证。
import test from 'node:test'
import {
  minimumWithdrawalAmount,
  validateWithdrawalAmount,
} from '../../src/views/operations/personal-finance/fund-accounts/withdrawal.logic'

test('提款金额最小正数按币种精度推导', () => {
  assert.equal(minimumWithdrawalAmount(0), '1')
  assert.equal(minimumWithdrawalAmount(1), '0.1')
  assert.equal(minimumWithdrawalAmount(2), '0.01')
})

test('提款金额空值与非法格式分别给出稳定结果', () => {
  for (const value of [null, '', '   ']) {
    assert.deepEqual(validateWithdrawalAmount(value, 2), {
      error: 'required',
      valid: false,
    })
  }

  for (const value of ['0', '0.00', '-1.00', '1.234', '1,000', 'abc', '1e3']) {
    assert.deepEqual(validateWithdrawalAmount(value, 2), {
      error: 'invalid',
      valid: false,
    })
  }
})

test('提款金额按币种精度规范化且必须大于零', () => {
  assert.deepEqual(validateWithdrawalAmount('0.01', 2), {
    amount: '0.01',
    valid: true,
  })
  assert.deepEqual(validateWithdrawalAmount('100', 2), {
    amount: '100.00',
    valid: true,
  })
  assert.deepEqual(validateWithdrawalAmount('100.5', 2), {
    amount: '100.50',
    valid: true,
  })
  // 零位精度币种的最小正数是一整个单位。
  assert.deepEqual(validateWithdrawalAmount('1', 0), {
    amount: '1',
    valid: true,
  })
  assert.deepEqual(validateWithdrawalAmount('0', 0), {
    error: 'invalid',
    valid: false,
  })
})
