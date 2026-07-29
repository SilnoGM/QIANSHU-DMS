import type { CurrencyDescriptor } from '../../src/components/base/currency'
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

const TEST_CURRENCIES = [
  { code: 'CNY', enabled: true, minorUnit: 2, name: '人民币', symbol: '¥' },
  { code: 'JPY', enabled: true, minorUnit: 0, name: '日元', symbol: 'JP¥' },
  { code: 'BHD', enabled: true, minorUnit: 3, name: '巴林第纳尔', symbol: 'BD' },
  { code: 'CLF', enabled: true, minorUnit: 4, name: '智利记账单位', symbol: 'UF' },
  { code: 'XXX', enabled: true, minorUnit: 1, name: '无符号测试币种', symbol: null },
  { code: 'TWD', enabled: false, minorUnit: 2, name: '新台币', symbol: 'NT$' },
] as const satisfies readonly CurrencyDescriptor[]

test('金额格式化从动态描述符读取符号、精度和停用币种信息', () => {
  assert.equal(formatCurrencyAmount('12846.37', 'CNY', TEST_CURRENCIES), '¥12,846.37 CNY')
  assert.equal(formatCurrencyAmount('384590.5', 'JPY', TEST_CURRENCIES), 'JP¥384,591 JPY')
  assert.equal(formatCurrencyAmount('27518.4', 'BHD', TEST_CURRENCIES), 'BD27,518.400 BHD')
  assert.equal(formatCurrencyAmount('.12345', 'CLF', TEST_CURRENCIES), 'UF0.1235 CLF')
  assert.equal(formatCurrencyAmount('12.34', 'XXX', TEST_CURRENCIES), '12.3 XXX')
  assert.equal(formatCurrencyAmount('864.72', 'TWD', TEST_CURRENCIES), 'NT$864.72 TWD')
})

test('金额格式化按 0 到 4 位 minorUnit 执行十进制 half-up 舍入', () => {
  assert.equal(formatCurrencyAmount('12.4', 'JPY', TEST_CURRENCIES), 'JP¥12 JPY')
  assert.equal(formatCurrencyAmount('12.5', 'JPY', TEST_CURRENCIES), 'JP¥13 JPY')
  assert.equal(formatCurrencyAmount('12.344', 'CNY', TEST_CURRENCIES), '¥12.34 CNY')
  assert.equal(formatCurrencyAmount('12.345', 'CNY', TEST_CURRENCIES), '¥12.35 CNY')
  assert.equal(formatCurrencyAmount('-12.3455', 'BHD', TEST_CURRENCIES), '-BD12.346 BHD')
  assert.equal(formatCurrencyAmount('-0.00004', 'CLF', TEST_CURRENCIES), 'UF0.0000 CLF')
  assert.equal(formatCurrencyAmount('-0.00005', 'CLF', TEST_CURRENCIES), '-UF0.0001 CLF')
})

test('十进制字符串在安全整数范围外仍保持精确显示', () => {
  assert.equal(
    formatCurrencyAmount('9007199254740993.21', 'CNY', TEST_CURRENCIES),
    '¥9,007,199,254,740,993.21 CNY',
  )
  assert.equal(
    formatCurrencyAmount('9999999999999999.995', 'TWD', TEST_CURRENCIES),
    'NT$10,000,000,000,000,000.00 TWD',
  )
})

test('空值、非法值和非有限 number 统一显示占位符', () => {
  for (const value of [null, undefined, '', '   ', '1,000', 'CNY 12', '12.3.4', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatCurrencyAmount(value, 'CNY', TEST_CURRENCIES), EMPTY_AMOUNT_TEXT)
  }

  assert.equal(formatCurrencyAmount(' 0012.30 ', 'CNY', TEST_CURRENCIES), '¥12.30 CNY')
})

test('未知币种不伪造符号或精度，保留原始十进制文本和币种代码', () => {
  assert.equal(formatCurrencyAmount('12.345600', 'XYZ', TEST_CURRENCIES), '12.345600 XYZ')
  assert.equal(formatCurrencyAmount('-0.00009', 'UNKNOWN', TEST_CURRENCIES), '-0.00009 UNKNOWN')
  assert.equal(formatCurrencyAmount('invalid', 'XYZ', TEST_CURRENCIES), EMPTY_AMOUNT_TEXT)
})

test('AmountDisplay 是无业务依赖的行内展示组件', () => {
  const source = readRelativeSource(
    '../../src/components/base/AmountDisplay/index.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'AmountDisplay' \}\)/u)
  assert.match(source, /currencies: readonly CurrencyDescriptor\[\]/u)
  assert.match(source, /formatCurrencyAmount/u)
  assert.match(source, /:data-currency="currency"/u)
  assert.match(source, /:data-currency-resolved=/u)
  assert.match(source, /:aria-label="ariaLabel"/u)
  assert.match(source, /\bqs-type-data-emphasis\b/u)
  assert.doesNotMatch(source, /\bfont-semibold\b/u)
  assert.doesNotMatch(source, /\bfont-medium\b/u)
  assert.doesNotMatch(source, /\btracking-\[/u)
  assert.match(source, /text-right/u)
  assert.match(source, /justify-end/u)
  assert.match(source, /whitespace-nowrap/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
})

test('金额通过 data-emphasis 角色统一消费 Mono 14/20/500 与等宽数字', () => {
  const globalStyles = readRelativeSource(
    '../../src/assets/styles/globals.css',
  )
  const unoConfig = readRelativeSource('../../../../uno.config.ts')
  const amountSource = readRelativeSource(
    '../../src/components/base/AmountDisplay/index.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/GenericTableShowcase.vue',
  )
  const shortcut = unoConfig.match(
    /'qs-type-data-emphasis': '([^']+)'/u,
  )?.[1]

  assert.match(
    globalStyles,
    /--qs-font-text-mono:\s*"Noto Sans Mono",\s*"Noto Sans SC";/u,
  )
  assert.ok(shortcut)
  assert.match(shortcut, /\bfont-mono\b/u)
  assert.match(shortcut, /\[font-size:var\(--qs-type-size-sm,0\.875rem\)\]/u)
  assert.match(shortcut, /\[font-weight:var\(--qs-type-weight-medium,500\)\]/u)
  assert.match(shortcut, /\[line-height:var\(--qs-type-leading-sm,1\.25rem\)\]/u)
  assert.match(shortcut, /\btabular-nums\b/u)
  assert.match(amountSource, /\bqs-type-data-emphasis\b/u)
  assert.match(showcaseSource, /cellClass:\s*'qs-type-data-emphasis'/u)
  // 外层复合行不得把 AmountDisplay 的 500 字重强制提升为 600。
  assert.doesNotMatch(showcaseSource, /\bweight="semibold"/u)
})

test('金额独立页面展示四币种与边界状态，并且不再挂载其他组件展示区', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/basic/index.vue',
  )
  const shellSource = readRelativeSource(
    '../../src/views/component_library/shared/ComponentCatalogPage.vue',
  )

  assert.match(pageSource, /import AmountDisplay from '@\/components\/base\/AmountDisplay\/index\.vue'/u)
  assert.match(pageSource, /defineOptions\(\{ name: 'ComponentLibraryAmountDisplay' \}\)/u)
  assert.match(pageSource, /title="金额显示"/u)
  assert.match(pageSource, /route-path="\/component-library\/basic\/amount-display"/u)
  assert.match(pageSource, /stage-label="金额组件已展示"/u)
  assert.match(pageSource, /SHOWCASE_CURRENCIES/u)
  assert.match(pageSource, /<AmountDisplay/u)
  assert.match(pageSource, /:currencies="SHOWCASE_CURRENCIES"/u)
  assert.doesNotMatch(pageSource, /DateTimeDisplayShowcase|GenericTableShowcase/u)

  assert.match(shellSource, /const slots = useSlots\(\)/u)
  assert.match(shellSource, /v-if="slots\.default"/u)
  assert.match(shellSource, /<slot\s*\/>/u)
  assert.match(shellSource, /v-else[\s\S]*?<FaEmpty/u)
})
