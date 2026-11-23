import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 组件结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const ROOT = new URL(
  '../../src/components/business/QsSalesOrderProductsEditorModal/',
  import.meta.url,
)

async function readSources(): Promise<{ modal: string, panel: string }> {
  const [modal, panel] = await Promise.all([
    readFile(new URL('index.vue', ROOT), 'utf8'),
    readFile(new URL('Panel.vue', ROOT), 'utf8'),
  ])
  return { modal, panel }
}

test('销售产品修改弹窗是薄壳，布局与交互由纯组件面板承担', async () => {
  const { modal, panel } = await readSources()

  assert.match(modal, /defineOptions\(\{ name: 'QsSalesOrderProductsEditorModal' \}\)/u)
  assert.match(modal, /import QsGenericModal/u)
  assert.match(modal, /import QsSalesOrderProductsEditorPanel from '\.\/Panel\.vue'/u)
  assert.match(modal, /title="修改销售订单产品"/u)
  assert.match(modal, /sm:!max-w-\[90rem\]/u)
  assert.match(panel, /defineOptions\(\{ name: 'QsSalesOrderProductsEditorPanel' \}\)/u)
  assert.match(panel, /import QsOrderProductLineEditor/u)
  assert.match(panel, /aria-label="销售订单信息"/u)
  assert.match(panel, /<QsOrderProductLineEditor/u)
  assert.match(panel, /aria-label="价格变化"/u)

  for (const source of [modal, panel]) {
    assert.doesNotMatch(source, /@\/api|useApp\w*Store|fetch\(|axios/u)
  }
  const orderPanel = panel.indexOf('aria-label="销售订单信息"')
  const editor = panel.indexOf('<QsOrderProductLineEditor')
  const pricePanel = panel.indexOf('aria-label="价格变化"')
  assert.ok(orderPanel >= 0)
  assert.ok(editor > orderPanel)
  assert.ok(pricePanel > editor)
  assert.doesNotMatch(panel, /lg:grid-cols-\[minmax\(0,4fr\)_minmax\(0,8fr\)\]/u)
  assert.match(panel, /activePurchasedQuantity/u)
  assert.match(panel, /存在有效采购单/u)
  assert.match(panel, /:model-value="lines"/u)
  assert.match(panel, /:minimum-quantity-by-key/u)
  assert.match(panel, /:removal-disabled-by-key/u)
})

test('面板区分普通确认与唯一的定金下调加强确认', async () => {
  const { modal, panel } = await readSources()

  assert.match(panel, /function requestReview/u)
  assert.match(panel, /requiresDepositReduction/u)
  assert.match(panel, /确认调整定金并保存/u)
  assert.match(panel, /原定金/u)
  assert.match(panel, /新定金/u)
  assert.match(panel, /定金减少/u)
  assert.match(panel, /emit\('validationError'/u)
  // 提交中态由宿主弹窗持有，面板通过 submitting 属性锁定编辑与操作行。
  assert.match(modal, /:submitting="submitting"/u)
  assert.match(panel, /:disabled="submitting"/u)
  assert.doesNotMatch(panel, /第三层|再次确认定金/u)
})

test('销售产品达到已采购数量后继续减少时转为页面轻提示', async () => {
  const { panel } = await readSources()

  assert.match(panel, /function handleQuantityMinimumReached\(_lineKey: string, minimumQuantity: number\): void/u)
  assert.match(panel, /`该产品数量不能低于已采购数量 \$\{minimumQuantity\} 件`/u)
  assert.match(panel, /@quantity-minimum-reached="handleQuantityMinimumReached"/u)
})
