import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 组件结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const ROOT = new URL(
  '../../src/components/business/QsSalesOrderAddOnProductsModal/',
  import.meta.url,
)

test('销售加购产品弹窗保持纯组件边界并复用通用模态框与产品编辑器', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(source, /defineOptions\(\{ name: 'QsSalesOrderAddOnProductsModal' \}\)/u)
  assert.match(source, /import QsGenericModal/u)
  assert.match(source, /import QsOrderProductLineEditor/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|fetch\(|axios/u)
  assert.match(source, /title="销售订单加购产品"/u)
  assert.match(source, /class="sm:!max-w-\[90rem\] sm:!w-\[calc\(100%-3rem\)\]"/u)
  assert.match(source, /lg:grid-cols-\[minmax\(0,4fr\)_minmax\(0,8fr\)\]/u)
  assert.match(source, /context\.existingLines/u)
  assert.match(source, /:model-value="lines"/u)
  assert.doesNotMatch(source, /read-only-lines="context\.existingLines"/u)
  assert.match(source, /:maximum-lines="context\.availableLineCapacity"/u)
  assert.match(source, /:fixed-product-supplier-value="supplierValue"/u)
  assert.match(source, /客户加购产品/u)
})

test('销售加购产品弹窗先检查再展示二次确认，锁定期间禁止重复提交', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(source, /function requestReview/u)
  assert.match(source, /reviewing\.value = true/u)
  assert.match(source, /二次确认/u)
  assert.match(source, /新增产品数/u)
  assert.match(source, /金额增量/u)
  assert.match(source, /新约定总价/u)
  assert.match(source, /emit\('confirm'/u)
  assert.match(source, /:submitting="submitting"/u)
  assert.match(source, /:disabled="submitting"/u)
  assert.match(source, /检查并确认加购/u)
})
