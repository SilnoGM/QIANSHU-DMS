import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 金额输入组件的纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  MoneyValidationError,
  normalizeMoneyString,
  sumMoneyValues,
  validateMoneyString,
} from '../../src/components/base/MoneyInput/logic'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('严格金额字符串可规范化为空值或固定精度十进制文本', () => {
  assert.deepEqual(validateMoneyString(null), {
    normalizedValue: null,
    valid: true,
  })
  assert.deepEqual(validateMoneyString('0'), {
    normalizedValue: '0.00',
    valid: true,
  })
  assert.deepEqual(validateMoneyString('1234.5'), {
    normalizedValue: '1234.50',
    valid: true,
  })
  assert.deepEqual(validateMoneyString('-12.30', { allowNegative: true }), {
    normalizedValue: '-12.30',
    valid: true,
  })
  assert.equal(normalizeMoneyString('-0.00', { allowNegative: true }), '0.00')
})

test('金额字符串拒绝空字符串、展示字符、宽松小数与科学计数法', () => {
  const invalidValues = [
    '',
    '.50',
    '123.',
    '01.20',
    '1,234.50',
    '¥12.00',
    '+12',
    '1e3',
    ' 12.00 ',
  ] as const

  for (const value of invalidValues) {
    const result = validateMoneyString(value)
    assert.equal(result.valid, false, value)
    if (!result.valid) {
      assert.equal(result.code, 'INVALID_FORMAT', value)
      assert.equal(result.normalizedValue, null, value)
    }
  }
})

test('金额校验区分小数位、负数和精确上下限错误', () => {
  assert.deepEqual(validateMoneyString('12.345'), {
    code: 'PRECISION_EXCEEDED',
    message: '金额最多支持 2 位小数',
    normalizedValue: null,
    valid: false,
  })
  assert.deepEqual(validateMoneyString('-12.30'), {
    code: 'NEGATIVE_NOT_ALLOWED',
    message: '金额不能为负数',
    normalizedValue: null,
    valid: false,
  })
  assert.deepEqual(validateMoneyString('9007199254740993.19', {
    min: '9007199254740993.20',
  }), {
    code: 'BELOW_MIN',
    message: '金额不能小于 9007199254740993.20',
    normalizedValue: null,
    valid: false,
  })
  assert.deepEqual(validateMoneyString('9007199254740993.22', {
    max: '9007199254740993.21',
  }), {
    code: 'ABOVE_MAX',
    message: '金额不能大于 9007199254740993.21',
    normalizedValue: null,
    valid: false,
  })
})

test('列汇总使用 Decimal 保持小数与安全整数范围外精度', () => {
  assert.equal(
    sumMoneyValues([
      '0.10',
      '0.20',
      null,
      '9007199254740993.21',
    ], {
      allowNegative: true,
      precision: 2,
    }),
    '9007199254740993.51',
  )
  assert.equal(sumMoneyValues([], { precision: 2 }), '0.00')
  assert.equal(sumMoneyValues(['12.30', '-2.30'], {
    allowNegative: true,
    precision: 2,
  }), '10.00')
})

test('列汇总遇到非法金额时明确失败而不是静默按零处理', () => {
  assert.throws(
    () => sumMoneyValues(['12.30', '1e3'], { precision: 2 }),
    (error: unknown) => error instanceof MoneyValidationError
      && error.code === 'INVALID_FORMAT'
      && error.value === '1e3',
  )
})

test('MoneyInput 基于 FaInput 提供字符串模型、币种语义和无障碍校验状态', () => {
  const source = readRelativeSource(
    '../../src/components/base/MoneyInput/index.vue',
  )

  assert.match(source, /defineOptions\(\{[\s\S]*?name: 'MoneyInput'[\s\S]*?inheritAttrs: false/u)
  assert.match(source, /defineModel<MoneyAmount>/u)
  assert.match(source, /<FaInput/u)
  assert.match(source, /inputmode="decimal"/u)
  assert.match(source, /:aria-invalid="ariaInvalid"/u)
  assert.match(source, /:data-validation-code="validationCode"/u)
  assert.match(source, /validateMoneyString/u)
  assert.match(source, /normalizeMoneyString/u)
  assert.match(source, /emitValidation/u)
  assert.match(source, /\bfont-mono\b/u)
  assert.match(source, /\btabular-nums\b/u)
  assert.match(source, /\btext-right\b/u)
  assert.match(source, /CURRENCY_SYMBOLS\[currency\]/u)
  assert.doesNotMatch(source, /type="number"|FaNumberField|@\/api|useApp\w*Store/u)
})

test('金额输入独立页面串联输入、显示、严格校验与精确汇总', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/basic/money-input.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/basic/components/MoneyInputShowcase.vue',
  )
  const readmeSource = readRelativeSource(
    '../../src/components/base/MoneyInput/README.md',
  )

  assert.match(pageSource, /defineOptions\(\{ name: 'ComponentLibraryMoneyInput' \}\)/u)
  assert.match(pageSource, /import MoneyInputShowcase from '.\/components\/MoneyInputShowcase\.vue'/u)
  assert.match(pageSource, /title="金额输入"/u)
  assert.match(pageSource, /route-path="\/component-library\/basic\/money-input"/u)
  assert.doesNotMatch(pageSource, /@\/api|useApp\w*Store/u)

  assert.match(showcaseSource, /import MoneyInput from '@\/components\/base\/MoneyInput\/index\.vue'/u)
  assert.match(showcaseSource, /import AmountDisplay from '@\/components\/base\/AmountDisplay\/index\.vue'/u)
  assert.match(showcaseSource, /sumMoneyValues/u)
  assert.match(showcaseSource, /<MoneyInput/u)
  assert.match(showcaseSource, /<AmountDisplay/u)
  assert.doesNotMatch(showcaseSource, /@\/api|useApp\w*Store/u)

  assert.match(readmeSource, /string \| null/u)
  assert.match(readmeSource, /decimal\.js/u)
  assert.match(readmeSource, /INVALID_FORMAT/u)
  assert.match(readmeSource, /MoneyInput[\s\S]*AmountDisplay[\s\S]*sumMoneyValues/u)
})
