import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 业务组件结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../src/components/business/QsOrderProductLineEditor/index.vue',
  import.meta.url,
)
const TYPES = new URL(
  '../../src/components/business/QsOrderProductLineEditor/types.ts',
  import.meta.url,
)

test('QsOrderProductLineEditor 以空表、两个入口、十列和双汇总承载通用明细', async () => {
  const source = await readFile(SOURCE, 'utf8')
  const openSelectorStart = source.indexOf('function openSelector(): void')
  const openSelectorEnd = source.indexOf('function addTemporaryLine(): void')
  const openSelectorSource = source.slice(openSelectorStart, openSelectorEnd)

  assert.match(source, /添加数据库产品/u)
  assert.match(source, /添加临时产品/u)
  assert.match(source, /<QsProductSelector/u)
  assert.match(source, /:existing-lines="existingCatalogLines"/u)
  assert.match(openSelectorSource, /if \(props\.disabled\)/u)
  assert.doesNotMatch(openSelectorSource, /props\.modelValue\.length >= props\.maximumLines/u)
  assert.match(source, /暂无产品明细/u)
  const headings = [
    '产品来源',
    '产品编号',
    '产品名称',
    '产品主图',
    'labels.referenceUnitPrice',
    'labels.actualUnitPrice',
    '产品数量',
    'labels.actualSubtotal',
    '备注',
    '操作',
  ]
  let position = -1
  for (const heading of headings) {
    const next = source.indexOf(heading, position + 1)
    assert.ok(next > position, `${heading} 应按确认顺序出现`)
    position = next
  }
  assert.match(source, /overflow-x-auto/u)
  assert.match(source, /<FaTooltip/u)
  assert.match(source, /\{\{ labels\.referenceTotal \}\}/u)
  assert.match(source, /\{\{ labels\.actualTotal \}\}/u)
  assert.match(source, /暂无/u)
  assert.match(source, /totals\.missingStandardPriceCount/u)
  assert.match(source, /未计入汇总/u)
  assert.doesNotMatch(source, /<FaCombobox/u)
  assert.doesNotMatch(source, /<FaTextarea/u)
})

test('通用产品明细可按领域适配层开启只读折扣率计算列', async () => {
  const source = await readFile(SOURCE, 'utf8')
  const types = await readFile(new URL(
    '../../src/components/business/QsOrderProductLineEditor/types.ts',
    import.meta.url,
  ), 'utf8')

  assert.match(types, /readonly showDiscountRate\?: boolean/u)
  assert.match(source, /showDiscountRate: false/u)
  assert.match(source, /resolveMoneyDiscountRate/u)
  assert.match(source, /function lineDiscountRate\(/u)
  assert.match(source, /v-if="showDiscountRate"[\s\S]*?>\s*折扣率/u)
  assert.match(source, /v-if="showDiscountRate"[\s\S]*?lineDiscountRate\(line\)\?\.formattedValue \?\? '—'/u)
  assert.match(source, /:colspan="showDiscountRate \? 11 : 10"/u)
  assert.match(source, /function discountRateTextClass\([\s\S]*?below[\s\S]*?text-destructive[\s\S]*?above[\s\S]*?text-primary[\s\S]*?text-foreground/u)
  assert.match(source, /:class="discountRateTextClass\(lineDiscountRate\(line\)\?\.trend\)"/u)
})

test('产品行独立横向滚动，固定汇总以语义色强化两类价格', async () => {
  const source = await readFile(SOURCE, 'utf8')
  const scrollStart = source.indexOf('overflow-x-auto')
  const tableEnd = source.indexOf('</table>', scrollStart)
  const scrollEnd = source.indexOf('</div>', tableEnd)
  const summaryStart = source.indexOf('aria-label="产品金额汇总"')

  assert.ok(scrollStart >= 0, '产品明细必须保留横向滚动容器')
  assert.ok(tableEnd > scrollStart, '产品表格必须位于横向滚动容器内')
  assert.ok(scrollEnd > tableEnd, '横向滚动容器必须在产品表格结束后关闭')
  assert.ok(summaryStart > scrollEnd, '汇总必须位于横向滚动容器外')
  assert.doesNotMatch(source, /<tfoot>/u)
  assert.match(source, /input-class="text-destructive !font-bold"/u)
  assert.match(source, /class="text-primary font-bold"/u)
  assert.match(source, /class="text-destructive font-bold"/u)
  assert.match(source, /class="text-lg text-primary font-bold"/u)
  assert.match(source, /class="text-lg text-destructive font-bold"/u)
})

test('售价与产品名称列保留完整输入空间，汇总在右侧纵向对齐', async () => {
  const source = await readFile(SOURCE, 'utf8')
  const summaryTag = source.match(/<div class="([^"]*)" aria-label="产品金额汇总">/u)

  assert.match(source, /class="font-medium p-3 w-80"[\s\S]*?产品名称/u)
  assert.match(source, /class="max-w-80 block truncate"/u)
  assert.match(source, /class="font-medium p-3 w-72"[\s\S]*?labels\.actualUnitPrice/u)
  assert.ok(summaryTag, '必须保留产品金额汇总语义区域')
  assert.ok(summaryTag[1].split(' ').includes('flex'), '汇总区域必须使用弹性布局')
  assert.ok(summaryTag[1].split(' ').includes('flex-col'), '两组汇总必须上下排列')
  assert.ok(summaryTag[1].split(' ').includes('items-end'), '两组汇总必须整体靠右')
  assert.match(source, /\{\{ labels\.referenceTotal \}\}：/u)
  assert.match(source, /\{\{ labels\.actualTotal \}\}：/u)
  assert.doesNotMatch(source, /aria-label="产品金额汇总"[^>]*sm:grid-cols-2/u)
})

test('产品行垂直居中，并补偿表单错误提示预留空间造成的输入框上偏', async () => {
  const source = await readFile(SOURCE, 'utf8')
  const formItemOffsets = source.match(/class="top-2 relative"/gu) ?? []

  assert.match(source, /class="align-middle border-b border-border last:border-b-0"/u)
  // 第五处属于按领域显式开启的 CUSTOM 参考价输入；默认销售场景仍不会渲染它。
  assert.equal(formItemOffsets.length, 5)
})

test('产品行编辑器仅在调用方开启时允许临时产品填写参考价', async () => {
  const [source, types] = await Promise.all([
    readFile(SOURCE, 'utf8'),
    readFile(TYPES, 'utf8'),
  ])

  assert.match(types, /customReferenceUnitPriceEditable\?: boolean/u)
  assert.match(types, /temporaryLineInitialActualUnitPriceAmount\?: string \| null/u)
  assert.match(types, /fixedProductSupplierValue\?: string/u)
  assert.match(source, /line\.lineType === 'CUSTOM' && customReferenceUnitPriceEditable/u)
  assert.match(source, /standardUnitPriceAmount: \$event/u)
  assert.match(source, /:fixed-supplier-value="fixedProductSupplierValue"/u)
})

test('产品行编辑器允许领域调用方分别关闭数据库和临时产品新增入口', async () => {
  const [source, types] = await Promise.all([
    readFile(SOURCE, 'utf8'),
    readFile(TYPES, 'utf8'),
  ])

  assert.match(types, /catalogProductAddable\?: boolean/u)
  assert.match(types, /catalogLineInitialActualUnitPriceAmount\?: string \| null/u)
  assert.match(types, /customProductAddable\?: boolean/u)
  assert.match(source, /v-if="catalogProductAddable"[\s\S]*?添加数据库产品/u)
  assert.match(source, /v-if="customProductAddable"[\s\S]*?添加临时产品/u)
  assert.match(source, /v-if="catalogProductAddable"[\s\S]*?<QsProductSelector/u)
})
