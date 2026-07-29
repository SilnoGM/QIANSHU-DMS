import type { CurrencyDescriptor } from '../../src/components/base/currency'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 金额输入组件的纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  findCurrencyDescriptor,
  isCurrencyMinorUnit,
} from '../../src/components/base/currency'
import {
  createMoneyCurrencyOptions,
  EMPTY_MONEY_CURRENCY_VALUE,
  resolveCommonMoneyCurrency,
} from '../../src/components/base/MoneyInput/currency'
import {
  MoneyValidationError,
  normalizeMoneyString,
  sumMoneyValues,
  validateMoneyString,
} from '../../src/components/base/MoneyInput/logic'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const TEST_CURRENCIES = [
  {
    code: 'CNY',
    enabled: true,
    minorUnit: 2,
    name: '人民币',
    symbol: '¥',
  },
  {
    code: 'JPY',
    enabled: true,
    minorUnit: 0,
    name: '日元',
    symbol: 'JP¥',
  },
  {
    code: 'BHD',
    enabled: true,
    minorUnit: 3,
    name: '巴林第纳尔',
    symbol: 'BD',
  },
  {
    code: 'TWD',
    enabled: false,
    minorUnit: 2,
    name: '新台币',
    symbol: 'NT$',
  },
] as const satisfies readonly CurrencyDescriptor[]

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

test('币种描述符支持 0 到 4 位小数，并按调用方选项动态解析', () => {
  for (const minorUnit of [0, 1, 2, 3, 4]) {
    assert.equal(isCurrencyMinorUnit(minorUnit), true)
  }
  for (const minorUnit of [-1, 5, 2.5, '2', null]) {
    assert.equal(isCurrencyMinorUnit(minorUnit), false)
  }

  assert.deepEqual(findCurrencyDescriptor(TEST_CURRENCIES, 'JPY'), TEST_CURRENCIES[1])
  assert.equal(findCurrencyDescriptor(TEST_CURRENCIES, 'USD'), null)
  assert.equal(findCurrencyDescriptor(TEST_CURRENCIES, null), null)
})

test('币种选项由 props 描述符生成，并保留当前停用或未知币种用于真实回显', () => {
  assert.deepEqual(createMoneyCurrencyOptions(TEST_CURRENCIES, 'TWD'), [
    { disabled: true, label: '请选择币种', value: EMPTY_MONEY_CURRENCY_VALUE },
    { label: 'CNY', value: 'CNY' },
    { label: 'JPY', value: 'JPY' },
    { label: 'BHD', value: 'BHD' },
    { disabled: true, label: 'TWD（已停用）', value: 'TWD' },
  ])

  assert.deepEqual(createMoneyCurrencyOptions(TEST_CURRENCIES, 'USD').at(-1), {
    disabled: true,
    label: 'USD（未知币种）',
    value: 'USD',
  })
  assert.equal(
    createMoneyCurrencyOptions(TEST_CURRENCIES, null)[0]?.value,
    EMPTY_MONEY_CURRENCY_VALUE,
  )
})

test('币种汇总只接受同一币种，空集合与混合币种都不伪造汇总币种', () => {
  assert.equal(resolveCommonMoneyCurrency(['CNY', 'CNY', 'CNY']), 'CNY')
  assert.equal(resolveCommonMoneyCurrency(['USD']), 'USD')
  assert.equal(resolveCommonMoneyCurrency([]), null)
  assert.equal(resolveCommonMoneyCurrency(['CNY', 'USD']), null)
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

test('金额校验对运行时非字符串数据返回格式错误而不是抛出 TypeError', () => {
  for (const value of [12, undefined, { amount: '12.00' }]) {
    assert.deepEqual(validateMoneyString(value as never), {
      code: 'INVALID_FORMAT',
      message: '请输入正确的金额，例如 1234.50',
      normalizedValue: null,
      valid: false,
    })
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

test('金额边界配置拒绝运行时非字符串值', () => {
  assert.throws(
    () => validateMoneyString('12.00', { min: 12 as never }),
    {
      message: 'min 必须是小数位不超过 precision 的严格金额字符串',
      name: 'TypeError',
    },
  )
  assert.throws(
    () => validateMoneyString('12.00', { max: 20 as never }),
    {
      message: 'max 必须是小数位不超过 precision 的严格金额字符串',
      name: 'TypeError',
    },
  )
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

test('列汇总按金额位数与行数扩展 Decimal 精度，避免默认 20 位有效数字舍入', () => {
  assert.equal(
    sumMoneyValues(
      Array.from({ length: 200 }).fill('9999999999999999.99'),
      { precision: 2 },
    ),
    '1999999999999999998.00',
  )
  assert.equal(
    sumMoneyValues([
      '0.1234567890123456789012345',
      '0.0000000000000000000000001',
    ], {
      precision: 25,
    }),
    '0.1234567890123456789012346',
  )
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
  const faInputSource = readRelativeSource(
    '../../../../packages/components/src/basic/input/index.vue',
  )

  assert.match(source, /defineOptions\(\{[\s\S]*?name: 'MoneyInput'[\s\S]*?inheritAttrs: false/u)
  assert.match(source, /defineModel<MoneyAmount>/u)
  assert.match(
    source,
    /defineModel<string \| null>\('currency', \{[\s\S]*?default: null/u,
  )
  assert.match(source, /currencies: readonly CurrencyDescriptor\[\]/u)
  assert.match(source, /currentCurrency[\s\S]*?minorUnit/u)
  assert.match(source, /<FaInput/u)
  assert.match(source, /<FaSelect/u)
  assert.match(source, /:options="currencyOptions"/u)
  assert.match(source, /:disabled="disabled \|\| readonly \|\| !hasEnabledCurrencies"/u)
  assert.match(source, /@update:model-value="handleCurrencyUpdate"/u)
  assert.match(source, /role="group"[\s\S]*?aria-label="币种选择"/u)
  assert.match(source, /inputmode="decimal"/u)
  assert.match(source, /:aria-invalid="ariaInvalid"/u)
  assert.match(source, /:data-validation-code="validationCode"/u)
  assert.match(source, /validateMoneyString/u)
  assert.match(source, /normalizeMoneyString/u)
  assert.match(source, /emitValidation/u)
  assert.match(source, /\bfont-mono\b/u)
  assert.match(source, /\btabular-nums\b/u)
  assert.match(source, /\btext-right\b/u)
  assert.match(source, /currentCurrency\?\.symbol \?\? ''/u)
  assert.match(source, /result\.valid && !props\.readonly/u)
  assert.match(
    source,
    /function handleCurrencyUpdate[\s\S]*?currency\.value = nextCurrency\.code[\s\S]*?\n\}/u,
  )
  assert.doesNotMatch(
    source,
    /CurrencyCode|CURRENCY_SYMBOLS|DEFAULT_MONEY_CURRENCY|MONEY_CURRENCY_OPTIONS/u,
  )
  assert.doesNotMatch(source, /\bprecision\?: number/u)
  assert.doesNotMatch(source, /type="number"|FaNumberField|@\/api|useApp\w*Store/u)

  // FaInput 必须只把 id、aria-* 与原生事件下传给真实 input，不能再自动复制到 InputGroup。
  assert.match(
    faInputSource,
    /defineOptions\(\{[\s\S]*?name: 'BuiltInInput'[\s\S]*?inheritAttrs: false/u,
  )
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
  assert.match(showcaseSource, /SHOWCASE_CURRENCIES/u)
  assert.match(showcaseSource, /sumMoneyValues/u)
  assert.match(showcaseSource, /const currency = ref<string \| null>\('CNY'\)/u)
  assert.match(showcaseSource, /v-model:currency="currency"/u)
  assert.match(showcaseSource, /v-model:currency="line\.currency"/u)
  assert.match(showcaseSource, /:currency="currency"/u)
  assert.match(showcaseSource, /:currencies="SHOWCASE_CURRENCIES"/u)
  assert.match(showcaseSource, /resolveCommonMoneyCurrency/u)
  assert.match(showcaseSource, /不同币种不能直接汇总/u)
  assert.match(showcaseSource, /summaryCurrency \?\? '混合币种'/u)
  assert.match(showcaseSource, /v-if="summaryCurrency"/u)
  assert.match(showcaseSource, /<MoneyInput/u)
  assert.match(showcaseSource, /<AmountDisplay/u)
  assert.doesNotMatch(showcaseSource, /@\/api|useApp\w*Store/u)

  assert.match(readmeSource, /string \| null/u)
  assert.match(readmeSource, /decimal\.js/u)
  assert.match(readmeSource, /INVALID_FORMAT/u)
  assert.match(readmeSource, /v-model:currency/u)
  assert.match(readmeSource, /CurrencyDescriptor/u)
  assert.match(readmeSource, /minorUnit/u)
  assert.match(readmeSource, /当前停用币种/u)
  assert.match(readmeSource, /不同币种/u)
  assert.match(readmeSource, /MoneyInput[\s\S]*AmountDisplay[\s\S]*sumMoneyValues/u)
  assert.doesNotMatch(readmeSource, /默认.*CNY/u)
})
