import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 销售订单详情组件使用 Node.js 内置 runner 校验只读展示契约。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('QsSalesOrderDesc 使用独立只读 ViewModel，且不依赖创建表单或接口 DTO', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsSalesOrderDesc/index.vue',
  )
  const typesSource = readRelativeSource(
    '../../src/components/business/QsSalesOrderDesc/types.ts',
  )

  assert.match(source, /defineOptions\(\{ name: 'QsSalesOrderDesc' \}\)/u)
  assert.match(source, /import type \{[\s\S]*QsSalesOrderDescProps[\s\S]*\} from '.\/types'/u)
  assert.match(source, /defineProps<QsSalesOrderDescProps>\(\)/u)
  assert.match(typesSource, /export interface QsSalesOrderDescViewModel/u)
  assert.match(typesSource, /readonly currencyCode: string/u)
  assert.match(typesSource, /readonly customer: Readonly<QsSalesOrderDescCustomerViewModel>/u)
  assert.match(typesSource, /readonly lines: readonly QsSalesOrderDescLineViewModel\[\]/u)
  assert.match(typesSource, /readonly documents: readonly QsSalesOrderDescDocumentViewModel\[\]/u)
  assert.match(typesSource, /readonly currencies: readonly CurrencyDescriptor\[\]/u)
  assert.doesNotMatch(typesSource, /standardUnitPriceAmount|readonly remark:/u)
  assert.doesNotMatch(
    `${source}\n${typesSource}`,
    /@\/api|sales-order-create|SalesOrderFormModel|useApp\w*Store/u,
  )
})

test('详情按五个业务区块固定排序并使用可关联的语义标题', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsSalesOrderDesc/index.vue',
  )
  const slots = [
    'sales-order-desc-basic',
    'sales-order-desc-customer',
    'sales-order-desc-lines',
    'sales-order-desc-sales',
    'sales-order-desc-documents',
  ]

  let previousIndex = -1
  for (const slot of slots) {
    const index = source.indexOf(`data-slot="${slot}"`)
    assert.ok(index > previousIndex, `${slot} 应按业务顺序出现`)
    previousIndex = index
  }

  assert.match(source, /data-slot="qs-sales-order-desc"/u)
  assert.match(
    source,
    /data-slot="qs-sales-order-desc"[\s\S]*?class="[^"]*rounded-xl[^"]*"/u,
    '共享订单详情组件外层必须使用与页面详情区域一致的 rounded-xl',
  )
  assert.doesNotMatch(
    source,
    /data-slot="qs-sales-order-desc"[\s\S]*?class="[^"]*rounded-2xl[^"]*"/u,
  )
  assert.match(source, /<section[\s\S]*:aria-labelledby=/u)
  assert.match(source, /<h3[\s\S]*:id=/u)
  assert.match(source, /<dl/u)
  assert.match(source, /<dt/u)
  assert.match(source, /<dd/u)
  assert.doesNotMatch(source, /<FaDescriptions/u)
})

test('产品和销售信息统一复用 AmountDisplay，并突出总价、定金和尾款', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsSalesOrderDesc/index.vue',
  )

  assert.match(source, /import AmountDisplay from '@\/components\/base\/AmountDisplay\/index\.vue'/u)
  assert.match(source, /data-slot="sales-order-desc-line"/u)
  assert.match(source, /line\.lineType/u)
  assert.match(source, /line\.productName/u)
  assert.match(source, /line\.productNo/u)
  assert.match(source, /line\.actualUnitPriceAmount/u)
  assert.match(source, /line\.quantity/u)
  assert.match(source, /line\.lineSubtotalAmount/u)
  assert.match(source, /model\.amounts\.lineSubtotalAmount/u)
  assert.match(source, /data-slot="sales-order-desc-total"/u)
  assert.match(source, /model\.amounts\.agreedTotalAmount/u)
  assert.match(source, /data-slot="sales-order-desc-deposit"/u)
  assert.match(source, /model\.amounts\.depositDueAmount/u)
  assert.match(source, /data-slot="sales-order-desc-balance"/u)
  assert.match(source, /model\.amounts\.balanceDueAmount/u)
  assert.equal(
    [...source.matchAll(/class="!text-xs sm:!text-base"/gu)].length,
    2,
  )
  assert.doesNotMatch(source, /line\.standardUnitPriceAmount/u)
  assert.doesNotMatch(source, /Number\(|parseFloat\(|parseInt\(/u)
})

test('附件缩略图复用 ImageGroup，文件元数据有稳定降级且操作区由插槽提供', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsSalesOrderDesc/index.vue',
  )

  assert.match(source, /import ImageGroup from '@\/components\/base\/ImageGroup\/index\.vue'/u)
  assert.match(source, /<ImageGroup/u)
  assert.match(source, /document\.thumbnailSrc/u)
  assert.match(source, /document\.previewSrc/u)
  assert.match(source, /document\.originalFilename/u)
  assert.match(source, /i-lucide:(?:file-text|file|video)/u)
  assert.match(source, /sm:grid-cols-2/u)
  assert.match(source, /defineSlots<[\s\S]*actions/u)
  assert.match(source, /<slot name="actions"/u)
  assert.doesNotMatch(source, /defineEmits|type="submit"|<FaButton|<button/u)
})

test('空态、主题和 i18n 契约保持稳定', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsSalesOrderDesc/index.vue',
  )
  const zhCn = readRelativeSource(
    '../../src/locales/lang/sales-order-desc/zh-cn.json',
  )
  const zhTw = readRelativeSource(
    '../../src/locales/lang/sales-order-desc/zh-tw.json',
  )
  const en = readRelativeSource(
    '../../src/locales/lang/sales-order-desc/en.json',
  )

  assert.match(source, /const \{ t \} = useI18n\(\)/u)
  assert.match(source, /salesOrderDesc\.empty\.text/u)
  assert.match(source, /salesOrderDesc\.empty\.lines/u)
  assert.match(source, /salesOrderDesc\.empty\.documents/u)
  assert.match(source, /bg-background/u)
  assert.match(source, /text-foreground/u)
  assert.match(source, /text-muted-foreground/u)
  assert.match(source, /border-border/u)
  assert.doesNotMatch(
    source,
    /linear-gradient|radial-gradient|#[\da-f]{3,8}|purple|violet|indigo|fuchsia/iu,
  )
  for (const locale of [zhCn, zhTw, en]) {
    assert.match(locale, /"salesOrderDesc"/u)
    assert.match(locale, /"sections"/u)
    assert.match(locale, /"documents"/u)
  }
})

test('中文文档说明显式导入、响应式布局和纯展示边界', () => {
  const readme = readRelativeSource(
    '../../src/components/business/QsSalesOrderDesc/README.md',
  )

  assert.match(readme, /QsSalesOrderDesc/u)
  assert.match(readme, /@\/components\/business\/QsSalesOrderDesc\/index\.vue/u)
  assert.match(readme, /ViewModel/u)
  assert.match(readme, /AmountDisplay/u)
  assert.match(readme, /ImageGroup/u)
  assert.match(readme, /actions/u)
  assert.match(readme, /响应式/u)
  assert.match(readme, /Object URL/u)
  assert.match(readme, /不负责.*校验/u)
  assert.match(readme, /不负责.*提交/u)
})
