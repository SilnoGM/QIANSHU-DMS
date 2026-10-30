import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 页面接入契约使用 Node.js 内置 runner 验证。
import test from 'node:test'

const PAGE = new URL('../../src/views/operations/goods-storage/index.vue', import.meta.url)
const CARD = new URL('../../src/components/business/QsShipmentStorageCard/index.vue', import.meta.url)

test('运营寄仓页改为卡片网格，保留筛选、详情抽屉和申请调货占位', async () => {
  const source = await readFile(PAGE, 'utf8')

  assert.match(source, /QsShipmentStorageCard/u)
  assert.match(source, /v-for="row in rows"/u)
  assert.match(source, /:record="row"/u)
  assert.match(source, /@detail="openDetail\(row\)"/u)
  assert.match(source, /@apply="toast\.info\('申请调货功能开发中'\)"/u)
  assert.match(source, /claimRequestDisabledReason\(row\)/u)
  assert.match(source, /<FaPagination/u)
  assert.match(source, /<QsGenericDrawer/u)
  assert.doesNotMatch(source, /<QsGenericTable\b/u)
  assert.match(source, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 33rem\), 1fr\)\);/u)
})

test('寄仓卡片是纯展示组件，操作只通过事件交给页面', async () => {
  const source = await readFile(CARD, 'utf8')

  assert.match(source, /defineEmits<\{\s*detail: \[\]\s*apply: \[\]\s*\}>\(\)/u)
  assert.match(source, /emit\('detail'\)/u)
  assert.match(source, /emit\('apply'\)/u)
  assert.doesNotMatch(source, /@\/api\/modules|useAppAuth|useRoute|shipmentStorageApi/u)
})
