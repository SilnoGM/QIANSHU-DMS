import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 金额组件纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  EMPTY_AMOUNT_TEXT,
  formatCurrencyAmount,
} from '../../src/components/base/AmountDisplay/format'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('金额格式化明确区分人民币、台币、林吉特和美元', () => {
  assert.equal(formatCurrencyAmount('12846.37', 'CNY'), '¥12,846.37 CNY')
  assert.equal(formatCurrencyAmount('384590', 'TWD'), 'NT$384,590.00 TWD')
  assert.equal(formatCurrencyAmount('27518.4', 'MYR'), 'RM27,518.40 MYR')
  assert.equal(formatCurrencyAmount('-864.72', 'USD'), '-$864.72 USD')
})

test('金额格式化统一使用两位小数并执行十进制 half-up 舍入', () => {
  assert.equal(formatCurrencyAmount('0', 'CNY'), '¥0.00 CNY')
  assert.equal(formatCurrencyAmount('.5', 'USD'), '$0.50 USD')
  assert.equal(formatCurrencyAmount('12.344', 'CNY'), '¥12.34 CNY')
  assert.equal(formatCurrencyAmount('12.345', 'CNY'), '¥12.35 CNY')
  assert.equal(formatCurrencyAmount('-12.345', 'CNY'), '-¥12.35 CNY')
  assert.equal(formatCurrencyAmount('-0.004', 'USD'), '$0.00 USD')
  assert.equal(formatCurrencyAmount('-0.005', 'USD'), '-$0.01 USD')
})

test('十进制字符串在安全整数范围外仍保持精确显示', () => {
  assert.equal(
    formatCurrencyAmount('9007199254740993.21', 'USD'),
    '$9,007,199,254,740,993.21 USD',
  )
  assert.equal(
    formatCurrencyAmount('9999999999999999.995', 'TWD'),
    'NT$10,000,000,000,000,000.00 TWD',
  )
})

test('空值、非法值和非有限 number 统一显示占位符', () => {
  for (const value of [null, undefined, '', '   ', '1,000', 'CNY 12', '12.3.4', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatCurrencyAmount(value, 'CNY'), EMPTY_AMOUNT_TEXT)
  }

  assert.equal(formatCurrencyAmount(' 0012.30 ', 'MYR'), 'RM12.30 MYR')
})

test('AmountDisplay 是无业务依赖的行内展示组件', () => {
  const source = readRelativeSource(
    '../../src/components/base/AmountDisplay/index.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'AmountDisplay' \}\)/u)
  assert.match(source, /formatCurrencyAmount/u)
  assert.match(source, /:data-currency="currency"/u)
  assert.match(source, /:aria-label="ariaLabel"/u)
  assert.match(source, /font-mono/u)
  assert.match(source, /text-right/u)
  assert.match(source, /justify-end/u)
  assert.match(source, /tabular-nums/u)
  assert.match(source, /whitespace-nowrap/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
})

test('基础组件页面展示四币种与边界状态，并由展示壳在有资产时替换空状态', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/basic/index.vue',
  )
  const shellSource = readRelativeSource(
    '../../src/views/component_library/shared/ComponentCatalogPage.vue',
  )

  assert.match(pageSource, /import AmountDisplay from '@\/components\/base\/AmountDisplay\/index\.vue'/u)
  assert.match(pageSource, /stage-label="两个组件已展示"/u)
  assert.match(pageSource, /<AmountDisplay/u)
  for (const currency of ['CNY', 'TWD', 'MYR', 'USD']) {
    assert.match(pageSource, new RegExp(`currency: '${currency}'`, 'u'))
  }

  assert.match(shellSource, /const slots = useSlots\(\)/u)
  assert.match(shellSource, /v-if="slots\.default"/u)
  assert.match(shellSource, /<slot\s*\/>/u)
  assert.match(shellSource, /v-else[\s\S]*?<FaEmpty/u)
})
