import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 采购订单详情组件使用 Node.js 内置 runner 校验只读展示契约。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('QsPurchaseOrderDesc 使用独立只读 ViewModel，且不依赖表单、接口 DTO 或页面状态', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsPurchaseOrderDesc/index.vue',
  )
  const typesSource = readRelativeSource(
    '../../src/components/business/QsPurchaseOrderDesc/types.ts',
  )

  assert.match(source, /defineOptions\(\{ name: 'QsPurchaseOrderDesc' \}\)/u)
  assert.match(source, /defineProps<QsPurchaseOrderDescProps>\(\)/u)
  assert.match(typesSource, /export interface QsPurchaseOrderDescViewModel/u)
  assert.match(typesSource, /readonly amounts: Readonly<QsPurchaseOrderDescAmountsViewModel>/u)
  assert.match(typesSource, /readonly lines: readonly QsPurchaseOrderDescLineViewModel\[\]/u)
  assert.match(typesSource, /readonly statuses: readonly QsPurchaseOrderDescStatusViewModel\[\]/u)
  assert.match(typesSource, /readonly currencies: readonly CurrencyDescriptor\[\]/u)
  assert.doesNotMatch(
    `${source}\n${typesSource}`,
    /@\/api|purchase-order-create|PurchaseOrderDetailDto|useApp\w*Store|defineEmits/u,
  )
})

test('详情按采购业务顺序展示基础、来源、产品、金额和唛头备注', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsPurchaseOrderDesc/index.vue',
  )
  const slots = [
    'purchase-order-desc-basic',
    'purchase-order-desc-source',
    'purchase-order-desc-lines',
    'purchase-order-desc-purchase',
    'purchase-order-desc-notes',
  ]

  let previousIndex = -1
  for (const slot of slots) {
    const index = source.indexOf(`data-slot="${slot}"`)
    assert.ok(index > previousIndex, `${slot} 应按业务顺序出现`)
    previousIndex = index
  }

  assert.match(source, /data-slot="qs-purchase-order-desc"/u)
  assert.match(
    source,
    /data-slot="qs-purchase-order-desc"[\s\S]*?class="[^"]*rounded-xl[^"]*"/u,
  )
  assert.doesNotMatch(
    source,
    /data-slot="qs-purchase-order-desc"[\s\S]*?class="[^"]*rounded-2xl[^"]*"/u,
  )
  assert.match(source, /<section[\s\S]*:aria-labelledby=/u)
  assert.match(source, /<dl/u)
  assert.match(source, /<dt/u)
  assert.match(source, /<dd/u)
})

test('产品主图保留，价格信息按销售详情样式只展示真实采购价、数量和本行小计', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsPurchaseOrderDesc/index.vue',
  )
  const zhCn = readRelativeSource(
    '../../src/locales/lang/purchase-order-desc/zh-cn.json',
  )

  assert.match(source, /import AmountDisplay from '@\/components\/base\/AmountDisplay\/index\.vue'/u)
  assert.match(source, /import ImageGroup from '@\/components\/base\/ImageGroup\/index\.vue'/u)
  assert.match(source, /line\.mainImage/u)
  assert.match(source, /line\.description/u)
  assert.match(source, /purchaseOrderDesc\.fields\.lineRemark/u)
  assert.doesNotMatch(source, /line\.referencePurchaseUnitPriceAmount/u)
  assert.match(source, /line\.actualPurchaseUnitPriceAmount/u)
  assert.match(source, /line\.lineSubtotalAmount/u)
  assert.match(
    source,
    /grid-cols-\[minmax\(0,1fr\)_auto\] items-end/u,
    '采购价格带必须复用销售详情的左右两列布局',
  )
  assert.match(source, /qs-type-meta text-muted-foreground m-0 flex flex-wrap gap-x-1 items-baseline/u)
  assert.match(source, /class="!text-xs !leading-4"/u)
  assert.match(source, /<div class="text-right min-w-0">/u)
  assert.match(zhCn, /"actualPurchaseUnitPrice": "真实采购价"/u)
  assert.match(zhCn, /"lineRemark": "备注："/u)
  assert.match(source, /model\.amounts\.purchaseTotalAmount/u)
  assert.match(source, /model\.amounts\.depositDueAmount/u)
  assert.match(source, /model\.amounts\.balanceDueAmount/u)
  assert.match(source, /model\.amounts\.paidAmount/u)
  assert.match(source, /model\.amounts\.outstandingAmount/u)
  assert.doesNotMatch(source, /Number\(|parseFloat\(|parseInt\(|new Decimal/u)
})

test('状态标签、空态、主题和操作插槽保持稳定', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsPurchaseOrderDesc/index.vue',
  )
  const zhCn = readRelativeSource(
    '../../src/locales/lang/purchase-order-desc/zh-cn.json',
  )
  const zhTw = readRelativeSource(
    '../../src/locales/lang/purchase-order-desc/zh-tw.json',
  )
  const en = readRelativeSource(
    '../../src/locales/lang/purchase-order-desc/en.json',
  )

  assert.match(source, /statusToneClass/u)
  assert.match(source, /model\.statuses/u)
  assert.match(source, /purchaseOrderDesc\.empty\.text/u)
  assert.match(source, /purchaseOrderDesc\.empty\.lines/u)
  assert.match(source, /defineSlots<[\s\S]*actions/u)
  assert.match(source, /<slot name="actions"/u)
  assert.match(source, /bg-background/u)
  assert.match(source, /text-foreground/u)
  assert.match(source, /border-border/u)
  assert.doesNotMatch(
    source,
    /linear-gradient|radial-gradient|#[\da-f]{3,8}|purple|violet|indigo|fuchsia/iu,
  )
  for (const locale of [zhCn, zhTw, en]) {
    assert.match(locale, /"purchaseOrderDesc"/u)
    assert.match(locale, /"sections"/u)
    assert.match(locale, /"purchase"/u)
  }
})

test('中文文档说明导入、ViewModel、金额和响应式边界', () => {
  const readme = readRelativeSource(
    '../../src/components/business/QsPurchaseOrderDesc/README.md',
  )

  assert.match(readme, /QsPurchaseOrderDesc/u)
  assert.match(readme, /@\/components\/business\/QsPurchaseOrderDesc\/index\.vue/u)
  assert.match(readme, /ViewModel/u)
  assert.match(readme, /AmountDisplay/u)
  assert.match(readme, /ImageGroup/u)
  assert.match(readme, /actions/u)
  assert.match(readme, /响应式/u)
  assert.match(readme, /不负责.*计算/u)
  assert.match(readme, /不负责.*提交/u)
})
