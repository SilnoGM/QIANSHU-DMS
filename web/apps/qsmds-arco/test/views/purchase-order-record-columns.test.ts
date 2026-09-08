import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购记录列契约使用现有 Node.js runner。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, reactive, ref } from 'vue'

const root = new URL('../../src/views/operations/purchase-orders/', import.meta.url)

test('采购记录三列使用服务端摘要，并保留原有金额、固定列和移动视图', async () => {
  const source = await readFile(new URL('index.vue', root), 'utf8')
  assert.match(source, /id: 'paymentAmountSummary',[\s\S]*?id: 'paymentRecordsSummary',\s+minWidth: 150/u)
  assert.match(source, /id: 'statusSummary',[\s\S]*?id: 'documentRecordsSummary',\s+minWidth: 140/u)
  assert.match(source, /id: 'changeRecordsSummary',\s+minWidth: 140,[\s\S]*?id: 'auditSummary'/u)
  for (const kind of ['payments', 'documents', 'changes']) {
    assert.match(source, new RegExp(`<PurchaseOrderRecordSummaryCell[^>]+kind="${kind}"[^>]+:order="row.original"`, 'u'))
    assert.match(source, new RegExp(`<PurchaseOrderRecordSummaryCell[^>]+kind="${kind}"[^>]+:order="row"`, 'u'))
    assert.match(source, new RegExp(`@open="openRecordsModal\\('${kind}', row.original\\)"`, 'u'))
    assert.match(source, new RegExp(`@open="openRecordsModal\\('${kind}', row\\)"`, 'u'))
  }
  assert.match(source, /<PurchaseOrderRecordsModal/u)
  assert.match(source, /fixed: 'right'/u)
})

test('采购列表按内容横向展开，编号和金额保留安全列宽，操作按钮不折行', async () => {
  const source = await readFile(new URL('index.vue', root), 'utf8')
  const minimumWidths = {
    orderSummary: 260,
    sourceSummary: 260,
    buyerSummary: 140,
    amountSummary: 200,
    termsSummary: 240,
    paymentAmountSummary: 240,
    auditSummary: 260,
  }
  for (const [id, width] of Object.entries(minimumWidths)) {
    assert.match(source, new RegExp(`id: '${id}',\\s+minWidth: ${width}`, 'u'))
  }
  // w-max 让列按真实内容占宽；滚动继续由 QsGenericTable 原有容器承担。
  assert.match(source, /table-class="w-max min-w-full"/u)
  assert.match(source, /:action-column="\{ fixed: 'right', minWidth: actionColumnWidth, title: '操作', width: actionColumnWidth \}"/u)
})

test('操作列随当前页审核中三动作扩宽，普通列表与权限不足仍为200px', async () => {
  const source = await readFile(new URL('index.vue', root), 'utf8')
  const start = source.indexOf('const actionColumnWidth = computed(')
  assert.ok(start >= 0, '列宽应由页面响应式计算')
  const declaration = source.slice(start, source.indexOf('\n\n', start))
  const props = reactive({ viewMode: 'all' })
  const canReview = ref(true)
  const canUpdate = ref(true)
  const rows = ref<{ orderStatus: string }[]>([])
  // 执行页面实际计算式并使用真实 Vue 响应性，避免在测试里复制列宽规则。
  const width = runInNewContext(`${declaration}; actionColumnWidth`, {
    computed,
    props,
    canReview,
    canUpdate,
    rows,
  }) as Readonly<{ value: number }>
  assert.equal(width.value, 200)
  rows.value = [{ orderStatus: 'PENDING_REVIEW' }]
  assert.equal(width.value, 260)
  canReview.value = false
  assert.equal(width.value, 200)
  canReview.value = true
  canUpdate.value = false
  assert.equal(width.value, 200)
  canUpdate.value = true
  props.viewMode = 'pending'
  assert.equal(width.value, 200)
  props.viewMode = 'all'
  for (const orderStatus of ['CONFIRMED', 'COMPLETED', 'CANCELLED']) {
    rows.value = [{ orderStatus }]
    assert.equal(width.value, 200)
  }
  rows.value.push({ orderStatus: 'PENDING_REVIEW' })
  assert.equal(width.value, 260)
})

test('三列与销售一致使用可点击的图标数量按钮，零记录不禁用', async () => {
  const source = await readFile(new URL('purchase-order-record-summary-cell.vue', root), 'utf8')
  assert.match(source, /<FaButton[\s\S]*?variant="ghost"/u)
  assert.match(source, /@click="emit\('open'\)"/u)
  assert.match(source, /getPurchaseOrderRecordCount/u)
  assert.match(source, /:aria-label=/u)
  assert.match(source, /<FaIcon/u)
  assert.doesNotMatch(source, /disabled|purchaseOrdersApi|fetch\(|<AmountDisplay|<DateTimeDisplay/u)
})
