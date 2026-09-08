import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 业务组件结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../src/components/business/QsProductSelector/index.vue',
  import.meta.url,
)

test('QsProductSelector 使用左宽右窄弹窗、滚动列表、供应商目录和局部重复确认', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /<QsGenericModal/u)
  assert.match(source, /选择数据库产品/u)
  assert.match(source, /产品选择不限制币种/u)
  assert.doesNotMatch(source, /只显示具有该币种标准价的产品/u)
  assert.match(source, /lg:grid-cols-\[minmax\(0,3fr\)_minmax\(18rem,2fr\)\]/u)
  assert.match(source, /service_provider\.supplier/u)
  assert.match(source, /共 \{\{ total \}\} 个产品/u)
  assert.match(source, /@scroll="handleResultScroll"/u)
  assert.match(source, /<FaPopover/u)
  assert.match(source, /:auto-focus="true"/u)
  assert.match(source, /产品已存在，是否增加数量？/u)
  assert.match(source, /createSelectedProductItems/u)
  assert.match(source, /v-for="selected in selectedItems"/u)
  assert.match(source, /removeProductFromSession/u)
  assert.match(source, /确认添加/u)
  assert.match(
    source,
    /if \(props\.disabled \|\| \(!replace && \(loading\.value \|\| loadingMore\.value\)\)\) \{[\s\S]*?return[\s\S]*?\}/u,
  )
  assert.match(source, /function closeUntrustedSession/u)
  assert.match(source, /watch\(\(\) => props\.currency, closeUntrustedSession\)/u)
  assert.match(source, /watch\(\(\) => props\.disabled/u)
  assert.doesNotMatch(source, /salesOrdersApi/u)
})

test('QsProductSelector 的全部供应商选项不向 FaSelect 传递空字符串值', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /ALL_SUPPLIERS_OPTION_VALUE/u)
  assert.doesNotMatch(source, /label: '全部供应商', value: ''/u)
  assert.doesNotMatch(source, /:model-value="supplierValue \?\? ''"/u)
})

test('QsProductSelector 加宽桌面弹窗并约束已选产品名称与横向溢出', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /sm:!max-w-\[68rem\]/u)
  assert.match(source, /overflow-x-hidden/u)
  assert.match(source, /<FaTooltip :text="selected\.name">/u)
  assert.match(source, /tabindex="0"[^>]*truncate/u)
  assert.match(source, /v-for="selected in selectedItems"[\s\S]*?min-w-0[\s\S]*?w-full/u)
  assert.match(source, /:aria-label="`移除 \$\{selected\.name\}`"[\s\S]*?class="shrink-0"/u)
})

test('QsProductSelector 支持由订单固定供应商并隐藏可变供应商筛选', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /fixedSupplierValue\?: string/u)
  assert.match(source, /props\.fixedSupplierValue \?\? supplierValue\.value/u)
  assert.match(source, /v-if="fixedSupplierValue === undefined"[\s\S]*?aria-label="供应商筛选"/u)
  assert.match(source, /watch\(\(\) => props\.fixedSupplierValue, closeUntrustedSession\)/u)
})
