import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 页面接入契约使用 Node.js 内置 runner 验证。
import test from 'node:test'

const PAGE = new URL('../../src/views/operations/goods-storage/index.vue', import.meta.url)
const CARD = new URL('../../src/components/business/QsShipmentStorageCard/index.vue', import.meta.url)
const THUMB = new URL('../../src/components/business/QsProductThumbnail/index.vue', import.meta.url)
const CLAIM_MODAL = new URL('../../src/views/workbenches/purchase-storage/claim-modal.vue', import.meta.url)

test('运营寄仓页使用卡片网格，并接入调货申请与撤回', async () => {
  const source = await readFile(PAGE, 'utf8')

  assert.match(source, /QsShipmentStorageCard/u)
  assert.match(source, /v-for="row in rows"/u)
  assert.match(source, /:record="row"/u)
  assert.match(source, /@detail="openDetail\(row\)"/u)
  assert.match(source, /@apply="openApplyFromRow\(row\)"/u)
  assert.match(source, /@withdraw="withdrawClaimRequest\(row, \$event\)"/u)
  assert.match(source, /ShipmentStorageClaimModal/u)
  assert.match(source, /canRequestClaim/u)
  assert.match(source, /<FaPagination/u)
  assert.match(source, /<QsGenericDrawer/u)
  assert.doesNotMatch(source, /<QsGenericTable\b/u)
  assert.match(source, /container-type: inline-size/u)
  assert.match(source, /grid-template-columns: minmax\(0, 1fr\);/u)
  assert.match(source, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u)
  assert.doesNotMatch(source, /:only-child/u)
})

test('寄仓卡片是纯展示组件，操作只通过事件交给页面', async () => {
  const source = await readFile(CARD, 'utf8')

  assert.match(source, /defineEmits<\{\s*detail: \[\]\s*apply: \[\]\s*withdraw: \[requestId: string\]\s*\}>\(\)/u)
  assert.match(source, /emit\('detail'\)/u)
  assert.match(source, /emit\('apply'\)/u)
  assert.match(source, /emit\('withdraw', claimRequest\?\.id/u)
  assert.doesNotMatch(source, /@\/api\/modules|useAppAuth|useRoute|shipmentStorageApi/u)
})

test('卡片按进行中申请展示申请人、锁定态和撤回入口', async () => {
  const source = await readFile(CARD, 'utf8')

  assert.match(source, /claimRequestLocked/u)
  assert.match(source, /调货申请中，已锁定/u)
  assert.match(source, /撤销申请/u)
  assert.match(source, /claimRequest\?\.id/u)
})

test('复制入口使用可点击文字，产品缺编号时回退到自定义产品', async () => {
  const source = await readFile(CARD, 'utf8')

  assert.match(source, /QsCopyableText/u)
  assert.doesNotMatch(source, /CopyCellButton/u)
  assert.match(source, /自定义产品/u)
  assert.match(source, /text-primary font-medium">1 项产品/u)
  assert.match(source, /bg-emerald-500\/10/u)
  assert.match(source, /location\.scopeClass/u)
})

test('卡片按实际宽度收敛唛头数量和来源人员', async () => {
  const source = await readFile(CARD, 'utf8')

  assert.match(source, /ResizeObserver/u)
  assert.match(source, /markVisibleCount/u)
  assert.match(source, /markMeasureRef/u)
  assert.match(source, /salesPersonHidden/u)
  assert.match(source, /measureSourcePair/u)
})

test('产品名单行省略，图片复用共享缩略图，产品与成本之间保留间距', async () => {
  const [source, thumbnail] = await Promise.all([
    readFile(CARD, 'utf8'),
    readFile(THUMB, 'utf8'),
  ])

  assert.match(source, /QsProductThumbnail/u)
  assert.match(source, /block truncate/u)
  assert.match(source, /column-gap: 1rem/u)
  assert.match(thumbnail, /useFaImagePreview/u)
  assert.match(thumbnail, /cursor-zoom-in/u)
  assert.match(thumbnail, /markFailed/u)
  assert.match(thumbnail, /bg-red-500\/10/u)
})

test('详情抽屉补齐完整产品、转入时间和成本合计', async () => {
  const source = await readFile(PAGE, 'utf8')

  assert.match(source, /detail\.lineSummary\.previews/u)
  assert.match(source, /QsProductThumbnail/u)
  assert.match(source, /转入寄仓/u)
  assert.match(source, /成本合计/u)
})

test('调货弹窗覆盖申请、审核和直接认领三种模式', async () => {
  const source = await readFile(CLAIM_MODAL, 'utf8')

  assert.match(source, /mode\?: 'apply' \| 'direct' \| 'review'/u)
  assert.match(source, /createClaimRequest/u)
  assert.match(source, /approveClaimRequest/u)
  assert.match(source, /rejectClaimRequest/u)
  assert.match(source, /rejectReason/u)
  assert.match(source, /同意调货/u)
  assert.match(source, /提交申请/u)
})
