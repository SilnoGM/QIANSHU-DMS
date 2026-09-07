import type { PurchaseOrderDetailDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购货件展示映射使用 Node.js 内置 runner。
import test from 'node:test'
import { getPurchaseOrderPartRecords } from '../../src/components/business/QsPurchaseOrderDrawer/logic'
import { getPurchaseOrderShippingMarksSummary } from '../../src/views/operations/purchase-orders/purchase-order-shipping-marks-cell.logic'

test('多唛头摘要保留服务端货件顺序和原文，全部复制按换行分隔', () => {
  const order = { shippingMarks: ['FIRST-01', 'SECOND-02', 'THIRD-03'], shippingMarkText: 'OLD' }
  assert.deepEqual(getPurchaseOrderShippingMarksSummary(order), {
    marks: ['FIRST-01', 'SECOND-02', 'THIRD-03'],
    firstMark: 'FIRST-01',
    additionalCount: 2,
    copyText: 'FIRST-01\nSECOND-02\nTHIRD-03',
    legacyMark: null,
  })
  assert.deepEqual(order.shippingMarks, ['FIRST-01', 'SECOND-02', 'THIRD-03'])
})

test('历史单保留原唛头而不推断为货件，空历史单不出现复制内容', () => {
  assert.deepEqual(getPurchaseOrderShippingMarksSummary({ shippingMarks: [], shippingMarkText: '原始唛头\n第二行' }), {
    marks: [],
    firstMark: null,
    additionalCount: 0,
    copyText: '',
    legacyMark: '原始唛头\n第二行',
  })
  assert.deepEqual(getPurchaseOrderShippingMarksSummary({ shippingMarks: [], shippingMarkText: null }), {
    marks: [],
    firstMark: null,
    additionalCount: 0,
    copyText: '',
    legacyMark: null,
  })
})

test('单货件不显示额外数量，多个货件同号时也保留每件的唛头', () => {
  assert.equal(getPurchaseOrderShippingMarksSummary({ shippingMarks: ['MARK'], shippingMarkText: null }).additionalCount, 0)
  assert.deepEqual(getPurchaseOrderShippingMarksSummary({ shippingMarks: ['MARK', 'MARK'], shippingMarkText: null }).marks, ['MARK', 'MARK'])
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
      { id: 'part-b', partNumber: 2, shippingMarkText: 'MARK-02', items: [{ purchaseOrderLineId: 'line-a', lineNumber: 1, quantity: 5 }] },
      { id: 'part-a', partNumber: 1, shippingMarkText: 'MARK-01', items: [
        { purchaseOrderLineId: 'line-b', lineNumber: 2, quantity: 3 },
        { purchaseOrderLineId: 'line-a', lineNumber: 1, quantity: 3 },
      ] },
    ],
  } as unknown as PurchaseOrderDetailDto
  const before = structuredClone(detail)
  const records = getPurchaseOrderPartRecords(detail)
  assert.deepEqual(records, [
    { id: 'part-a', partNumber: 1, shippingMarkText: 'MARK-01', items: [
      { purchaseOrderLineId: 'line-a', lineNumber: 1, quantity: 3, productNo: 'SKU-A', productName: '同名产品', description: 'A 备注', imageSrc: '/image-a' },
      { purchaseOrderLineId: 'line-b', lineNumber: 2, quantity: 3, productNo: 'SKU-B', productName: '同名产品', description: 'B 备注', imageSrc: '/image-b' },
    ] },
    { id: 'part-b', partNumber: 2, shippingMarkText: 'MARK-02', items: [
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
    parts: [{ id: 'part', partNumber: 1, shippingMarkText: 'MARK', items: [{ purchaseOrderLineId: 'missing', lineNumber: 4, quantity: 2 }] }],
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
  assert.match(source, /:text="summary\.legacyMark"/u)
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
  assert.match(information, /v-if="detail\.parts\.length === 0"/u)
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
