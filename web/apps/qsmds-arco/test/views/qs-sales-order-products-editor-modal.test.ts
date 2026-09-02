import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 组件结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const ROOT = new URL(
  '../../src/components/business/QsSalesOrderProductsEditorModal/',
  import.meta.url,
)

test('销售产品修改弹窗保持纯组件边界并采用 90rem 纵向三段布局', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(source, /defineOptions\(\{ name: 'QsSalesOrderProductsEditorModal' \}\)/u)
  assert.match(source, /import QsGenericModal/u)
  assert.match(source, /import QsOrderProductLineEditor/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|fetch\(|axios/u)
  assert.match(source, /title="修改销售订单产品"/u)
  assert.match(source, /sm:!max-w-\[90rem\]/u)
  const orderPanel = source.indexOf('aria-label="销售订单信息"')
  const editor = source.indexOf('<QsOrderProductLineEditor')
  const pricePanel = source.indexOf('aria-label="价格变化"')
  assert.ok(orderPanel >= 0)
  assert.ok(editor > orderPanel)
  assert.ok(pricePanel > editor)
  assert.doesNotMatch(source, /lg:grid-cols-\[minmax\(0,4fr\)_minmax\(0,8fr\)\]/u)
  assert.match(source, /activePurchasedQuantity/u)
  assert.match(source, /存在有效采购单/u)
  assert.match(source, /:model-value="lines"/u)
  assert.match(source, /:minimum-quantity-by-key/u)
  assert.match(source, /:removal-disabled-by-key/u)
})

test('弹窗区分普通确认与唯一的定金下调加强确认', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(source, /function requestReview/u)
  assert.match(source, /requiresDepositReduction/u)
  assert.match(source, /确认调整定金并保存/u)
  assert.match(source, /原定金/u)
  assert.match(source, /新定金/u)
  assert.match(source, /定金减少/u)
  assert.match(source, /emit\('validationError'/u)
  assert.match(source, /:submitting="submitting"/u)
  assert.doesNotMatch(source, /第三层|再次确认定金/u)
})
