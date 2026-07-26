import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 展示页源码契约使用 Node.js 内置 runner。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('通用表格独立页面只挂载表格展示区，并保留金额汇总自定义组件', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/index.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/GenericTableShowcase.vue',
  )

  assert.match(pageSource, /defineOptions\(\{ name: 'ComponentLibraryGenericTable' \}\)/u)
  assert.match(pageSource, /import GenericTableShowcase from '.\/components\/GenericTableShowcase\.vue'/u)
  assert.match(pageSource, /title="通用表格"/u)
  assert.match(pageSource, /route-path="\/component-library\/business\/generic-table"/u)
  assert.match(pageSource, /stage-label="通用表格已展示"/u)
  assert.match(pageSource, /<GenericTableShowcase\s*\/>/u)
  assert.doesNotMatch(pageSource, /DateTimeDisplayShowcase/u)
  assert.match(showcaseSource, /<QsGenericTable/u)
  assert.match(showcaseSource, /component: AmountDisplay/u)
  assert.match(showcaseSource, /currency: 'CNY'/u)
  assert.match(showcaseSource, /import Decimal from 'decimal\.js'/u)
  assert.match(showcaseSource, /amount: string/u)
  assert.match(showcaseSource, /standardAmount: string/u)
  assert.doesNotMatch(showcaseSource, /(?:amount|standardAmount): number/u)
  assert.match(showcaseSource, /new Decimal\('8600\.00'\)/u)
  assert.match(showcaseSource, /new Decimal\('9600\.00'\)/u)
  assert.match(showcaseSource, /\.toFixed\(2\)/u)
  assert.match(showcaseSource, /import \{ sumMoneyValues \} from '@\/components\/base\/MoneyInput\/logic'/u)
  assert.match(showcaseSource, /const summaryValues = computed\(/u)
  assert.match(showcaseSource, /sumMoneyValues\(/u)
  assert.doesNotMatch(showcaseSource, /String\(row\.(?:amount|standardAmount)\)/u)
  assert.match(showcaseSource, /:summary-values="summaryValues"/u)
  assert.doesNotMatch(showcaseSource, /pageRows\.value\.reduce\([\s\S]*?standardAmount/u)
  assert.match(showcaseSource, /new Decimal\(left\.amount\)\.comparedTo\(right\.amount\)/u)
  assert.doesNotMatch(showcaseSource, /Number\((?:left|right)\.amount\)/u)
  assert.match(showcaseSource, /20, 50, 100, 200/u)
  assert.match(showcaseSource, /:action-column="\{ width: 168 \}"/u)
  assert.match(showcaseSource, /#actions="\{ row, rowNumber \}"/u)
  assert.match(showcaseSource, /:aria-label="`查看第 \$\{rowNumber\} 行`"/u)
  assert.match(showcaseSource, /:aria-label="`复核第 \$\{rowNumber\} 行`"/u)
  assert.match(showcaseSource, /#mobile-row/u)
  assert.doesNotMatch(showcaseSource, /@\/api|useApp\w*Store/u)
})

test('双行金额在桌面单元格、汇总和移动卡片中统一末位对齐', () => {
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/GenericTableShowcase.vue',
  )

  assert.equal(
    showcaseSource.match(/content-class="ml-auto flex justify-end text-right"/gu)?.length,
    6,
  )
  assert.doesNotMatch(showcaseSource, /content-class="[^"]*w-\[[^"]*ch[^"]*"/u)
})
