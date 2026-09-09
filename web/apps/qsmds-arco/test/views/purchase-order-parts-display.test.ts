import type { PurchaseOrderDetailDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购货件展示映射使用 Node.js 内置 runner。
import test from 'node:test'
import { getPurchaseOrderPartRecords } from '../../src/components/business/QsPurchaseOrderDrawer/logic'
import { getPurchaseOrderShippingMarksSummary } from '../../src/views/operations/purchase-orders/purchase-order-shipping-marks-cell.logic'

test('列表以订单基础唛头为主，货件原文和全部复制保留服务端顺序', () => {
  const order = { shippingMarks: ['FIRST-01', 'SECOND-02', 'THIRD-03'], shippingMarkText: 'OLD' }
  assert.deepEqual(getPurchaseOrderShippingMarksSummary(order), {
    marks: ['FIRST-01', 'SECOND-02', 'THIRD-03'],
    baseMark: 'OLD',
    primaryMark: 'OLD',
    showPartMarks: true,
    pending: false,
    additionalCount: 2,
    copyText: 'FIRST-01\nSECOND-02\nTHIRD-03',
  })
  assert.deepEqual(order.shippingMarks, ['FIRST-01', 'SECOND-02', 'THIRD-03'])
})

test('历史单保留原唛头而不推断为货件，空历史单不出现复制内容', () => {
  assert.deepEqual(getPurchaseOrderShippingMarksSummary({ shippingMarks: [], shippingMarkText: '原始唛头\n第二行' }), {
    marks: [],
    baseMark: '原始唛头\n第二行',
    primaryMark: '原始唛头\n第二行',
    showPartMarks: false,
    pending: false,
    additionalCount: 0,
    copyText: '',
  })
  assert.deepEqual(getPurchaseOrderShippingMarksSummary({ shippingMarks: [], shippingMarkText: null }), {
    marks: [],
    baseMark: null,
    primaryMark: null,
    showPartMarks: false,
    pending: false,
    additionalCount: 0,
    copyText: '',
  })
})

test('单货件不显示额外数量，多个货件同号时也保留每件的唛头', () => {
  assert.equal(getPurchaseOrderShippingMarksSummary({ shippingMarks: ['MARK'], shippingMarkText: null }).additionalCount, 0)
  assert.deepEqual(getPurchaseOrderShippingMarksSummary({ shippingMarks: ['MARK', 'MARK'], shippingMarkText: null }).marks, ['MARK', 'MARK'])
})

test('单货件与基础唛头同码仅显示一次，历史独立货件码不能反推为基础码', () => {
  const single = getPurchaseOrderShippingMarksSummary({ shippingMarks: ['BASE'], shippingMarkText: 'BASE' })
  assert.equal(single.primaryMark, 'BASE')
  assert.equal(single.showPartMarks, false)
  const historical = getPurchaseOrderShippingMarksSummary({ shippingMarks: ['OLD-01', 'OLD-02'], shippingMarkText: null })
  assert.equal(historical.baseMark, null)
  assert.equal(historical.primaryMark, 'OLD-01')
  assert.equal(historical.showPartMarks, true)
  const independent = getPurchaseOrderShippingMarksSummary({ shippingMarks: ['STORED-OTHER'], shippingMarkText: 'BASE' })
  assert.equal(independent.showPartMarks, true)
  assert.deepEqual(independent.marks, ['STORED-OTHER'])
})

test('待审核所有唛头为空时显示待生成，不制造复制文本或货件编号', () => {
  const pending = getPurchaseOrderShippingMarksSummary({ shippingMarks: [], shippingMarkText: null, orderStatus: 'PENDING_REVIEW' })
  assert.equal(pending.pending, true)
  assert.equal(pending.primaryMark, null)
  assert.equal(pending.showPartMarks, false)
  assert.equal(pending.copyText, '')
  assert.equal(getPurchaseOrderShippingMarksSummary({ shippingMarks: [], shippingMarkText: null, orderStatus: 'CANCELLED' }).pending, false)
  assert.equal(getPurchaseOrderShippingMarksSummary({ shippingMarks: ['OLD'], shippingMarkText: null, orderStatus: 'PENDING_REVIEW' }).pending, false)
})

test('审核前货件 null 原样保留；审核后的货件独立字段不由基础码或内部序号重算', () => {
  const records = getPurchaseOrderPartRecords({
    parts: [
      { id: 'pending', partNumber: 100, status: 'PENDING_REVIEW', shippingMarkText: null, items: [] },
      { id: 'stored', partNumber: 1, status: 'ACTIVE', shippingMarkText: 'STORED-UNCHANGED', items: [] },
    ],
    lines: [],
    lineSummary: { previews: [] },
  } as unknown as PurchaseOrderDetailDto)
  assert.equal(records[0]?.shippingMarkText, 'STORED-UNCHANGED')
  assert.equal(records[1]?.shippingMarkText, null)
  assert.equal(records[0]?.status, 'ACTIVE')
  assert.equal(records[1]?.status, 'PENDING_REVIEW')
})

test('货件按编号排序，产品和图片按采购行 ID 关联，仅使用货件实际分配数量', () => {
  const detail = {
    lines: [
      { id: 'line-a', lineNumber: 1, productNo: 'SKU-A', productName: '同名产品', description: 'A 备注', quantity: 8, lineTotalAmount: '80.0000' },
      { id: 'line-b', lineNumber: 2, productNo: 'SKU-B', productName: '同名产品', description: 'B 备注', quantity: 3, lineTotalAmount: '30.0000' },
    ],
    lineSummary: { previews: [
      { lineId: 'line-b', mainImage: { contentUrl: '/image-b' } },
      { lineId: 'line-a', mainImage: { contentUrl: '/image-a' } },
    ] },
    parts: [
      { id: 'part-b', partNumber: 2, status: 'ACTIVE', shippingMarkText: 'MARK-02', items: [{ purchaseOrderLineId: 'line-a', lineNumber: 1, quantity: 5 }] },
      { id: 'part-a', partNumber: 1, status: 'ACTIVE', shippingMarkText: 'MARK-01', items: [
        { purchaseOrderLineId: 'line-b', lineNumber: 2, quantity: 3 },
        { purchaseOrderLineId: 'line-a', lineNumber: 1, quantity: 3 },
      ] },
    ],
  } as unknown as PurchaseOrderDetailDto
  const before = structuredClone(detail)
  const records = getPurchaseOrderPartRecords(detail)
  assert.deepEqual(records, [
    { id: 'part-a', partNumber: 1, status: 'ACTIVE', shippingMarkText: 'MARK-01', items: [
      { purchaseOrderLineId: 'line-a', lineNumber: 1, quantity: 3, productNo: 'SKU-A', productName: '同名产品', description: 'A 备注', imageSrc: '/image-a' },
      { purchaseOrderLineId: 'line-b', lineNumber: 2, quantity: 3, productNo: 'SKU-B', productName: '同名产品', description: 'B 备注', imageSrc: '/image-b' },
    ] },
    { id: 'part-b', partNumber: 2, status: 'ACTIVE', shippingMarkText: 'MARK-02', items: [
      { purchaseOrderLineId: 'line-a', lineNumber: 1, quantity: 5, productNo: 'SKU-A', productName: '同名产品', description: 'A 备注', imageSrc: '/image-a' },
    ] },
  ])
  assert.deepEqual(detail, before)
  assert.equal(records[0]?.items[0]?.quantity, 3)
  assert.equal(Object.hasOwn(records[0]?.items[0] ?? {}, 'lineTotalAmount'), false)
})

test('货件为空时不从原唛头和产品总数合成货件，缺失产品快照不串用其他产品', () => {
  assert.deepEqual(getPurchaseOrderPartRecords({ parts: [], lines: [], lineSummary: { previews: [] }, shippingMarkText: 'OLD' } as unknown as PurchaseOrderDetailDto), [])
  const records = getPurchaseOrderPartRecords({
    parts: [{ id: 'part', partNumber: 1, status: 'ACTIVE', shippingMarkText: 'MARK', items: [{ purchaseOrderLineId: 'missing', lineNumber: 4, quantity: 2 }] }],
    lines: [],
    lineSummary: { previews: [] },
  } as unknown as PurchaseOrderDetailDto)
  assert.deepEqual(records[0]?.items, [{ purchaseOrderLineId: 'missing', lineNumber: 4, quantity: 2, productNo: null, productName: null, description: null, imageSrc: undefined }])
})

test('列表桌面与窄屏共用点击展开唛头组件，提供逐号和全部复制', async () => {
  const source = await readFile(new URL('../../src/views/operations/purchase-orders/purchase-order-shipping-marks-cell.vue', import.meta.url), 'utf8')
  const list = await readFile(new URL('../../src/views/operations/purchase-orders/index.vue', import.meta.url), 'utf8')
  assert.match(source, /<FaPopover\b/u)
  assert.match(source, /:auto-focus="true"/u)
  assert.match(source, /<FaButton[\s\S]*?:aria-label=/u)
  assert.match(source, /v-for="\(mark, index\) in summary\.marks"/u)
  assert.match(source, /:text="mark"/u)
  assert.match(source, /navigator\.clipboard\.writeText\(summary\.value\.copyText\)/u)
  assert.match(source, /v-if="summary\.showPartMarks"/u)
  assert.match(source, /v-if="summary\.primaryMark"/u)
  assert.match(source, /:text="summary\.primaryMark"/u)
  assert.match(source, /purchaseOrderList\.shippingMarks\.pending/u)
  assert.equal((list.match(/<PurchaseOrderShippingMarksCell\b/gu) ?? []).length, 2)
})

test('详情货件默认折叠且换单重置，复制入口独立于折叠触发器，展开内容无金额', async () => {
  const source = await readFile(new URL('../../src/components/business/QsPurchaseOrderDrawer/OrderParts.vue', import.meta.url), 'utf8')
  const information = await readFile(new URL('../../src/components/business/QsPurchaseOrderDrawer/OrderInformation.vue', import.meta.url), 'utf8')
  assert.match(source, /expandedPart = ref<string \| null>\(null\)/u)
  assert.match(source, /watch\(\(\) => props\.detail\.id/u)
  assert.match(source, /<FaCollapsible\b/u)
  assert.match(source, /:aria-expanded=/u)
  assert.match(source, /<ImageGroup\b/u)
  assert.match(source, /item\.quantity/u)
  assert.doesNotMatch(source, /AmountDisplay|lineTotalAmount|actualPurchaseUnitPriceAmount/u)
  assert.match(information, /<OrderParts :detail="detail"/u)
  assert.doesNotMatch(information, /v-if="detail\.parts\.length === 0"/u)
  assert.match(information, /purchaseOrderDesc\.fields\.baseShippingMark/u)
  assert.match(source, /<CopyCellButton v-if="part\.shippingMarkText"/u)
  assert.match(source, /purchaseOrderDrawer\.parts\.pendingMark/u)
  assert.match(information, /:text="detail\.shippingMarkText"/u)
  assert.match(information, /:value="detail\.amounts\.lineSubtotalAmount"/u)
})

test('货件小节标题与采购抽屉其他小节保持相同的主题绿色竖线', async () => {
  const parts = await readFile(new URL('../../src/components/business/QsPurchaseOrderDrawer/OrderParts.vue', import.meta.url), 'utf8')
  const information = await readFile(new URL('../../src/components/business/QsPurchaseOrderDrawer/OrderInformation.vue', import.meta.url), 'utf8')
  const heading = parts.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/u)?.[1] ?? ''
  const marker = /<span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" \/>/u
  assert.match(information, marker)
  assert.match(heading, marker)
  assert.doesNotMatch(heading, /<FaIcon/u)
})
