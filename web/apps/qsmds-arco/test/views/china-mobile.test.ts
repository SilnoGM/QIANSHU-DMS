import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildChinaMobileE164,
  normalizeMobileInput,
  parseStoredMobileE164,
  validateChinaMobileNational,
} from '../../src/utils/china-mobile'

test('存量 +86 号码回显为 11 位并识别合法号段', () => {
  assert.deepEqual(parseStoredMobileE164('+8613800138000'), {
    national: '13800138000',
    unsupported: false,
  })
  assert.deepEqual(parseStoredMobileE164('+8615224205635'), {
    national: '15224205635',
    unsupported: false,
  })
  assert.deepEqual(parseStoredMobileE164(null), {
    national: '',
    unsupported: false,
  })
  assert.deepEqual(parseStoredMobileE164(''), {
    national: '',
    unsupported: false,
  })
})

test('存量非 +86、长度异常或号段异常标记为不支持且不猜测转换', () => {
  for (const value of [
    '+886912345678',
    '+12025550123',
    '+861380013800',
    '+86138001380000',
    '+8612800138000',
  ]) {
    const parsed = parseStoredMobileE164(value)
    assert.equal(parsed.unsupported, true, value)
  }

  assert.deepEqual(parseStoredMobileE164('+886912345678'), {
    national: '',
    unsupported: true,
  })
  assert.deepEqual(parseStoredMobileE164('+8612800138000'), {
    national: '12800138000',
    unsupported: true,
  })
})

test('11 位号码拼接为 +86 E.164，空值保持为空', () => {
  assert.equal(buildChinaMobileE164('13800138000'), '+8613800138000')
  assert.equal(buildChinaMobileE164(''), null)
})

test('输入归一化支持 +86/86 前缀、常见分隔符与非数字提示', () => {
  assert.deepEqual(normalizeMobileInput('+8613800138000'), {
    digits: '13800138000',
    issue: null,
  })
  assert.deepEqual(normalizeMobileInput('8613800138000'), {
    digits: '13800138000',
    issue: null,
  })
  assert.deepEqual(normalizeMobileInput('+86 138-0013-8000'), {
    digits: '13800138000',
    issue: null,
  })
  assert.deepEqual(normalizeMobileInput('138 0013 8000'), {
    digits: '13800138000',
    issue: null,
  })
  assert.deepEqual(normalizeMobileInput('138x0013x8000'), {
    digits: '13800138000',
    issue: 'digits',
  })
  assert.deepEqual(normalizeMobileInput('138001380001'), {
    digits: '13800138000',
    issue: 'length',
  })
  assert.deepEqual(normalizeMobileInput('+886912345678'), {
    digits: '',
    issue: 'foreign',
  })
  assert.deepEqual(normalizeMobileInput(''), {
    digits: '',
    issue: null,
  })
})

test('11 位号段校验拒绝非 1 开头、1 后第二位 0-2 与长度异常', () => {
  assert.equal(validateChinaMobileNational(''), null)
  assert.equal(validateChinaMobileNational('13800138000'), null)
  assert.equal(validateChinaMobileNational('19912345678'), null)
  assert.equal(validateChinaMobileNational('14912345678'), null)
  assert.equal(validateChinaMobileNational('1380013800'), 'length')
  assert.equal(validateChinaMobileNational('138001380001'), 'length')
  assert.equal(validateChinaMobileNational('23800138000'), 'segment')
  assert.equal(validateChinaMobileNational('12800138000'), 'segment')
  assert.equal(validateChinaMobileNational('11800138000'), 'segment')
  assert.equal(validateChinaMobileNational('1380013800a'), 'digits')
})
