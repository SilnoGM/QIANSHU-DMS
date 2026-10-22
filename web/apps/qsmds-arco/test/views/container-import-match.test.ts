import type { ContainerImportCandidateDto, PurchaseShipmentListItemDto } from '../../src/api/generated/types.gen'
import type { ShipmentCandidateView } from '../../src/views/workbenches/containers/shipment-candidate.logic'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证客户名提示、Level 2 推荐与资格镜像。
import test from 'node:test'
import {
  buildImportCandidateView,
  buildSearchCandidateView,
  normalizeCustomerName,
  resolveCandidatePrimaryState,
  resolveCandidateRecommendation,
  resolveCustomerHint,
  resolveRowMatchState,
  resolveShipmentEligibilityFromFacts,
  sortCandidateViews,
  toImportCandidateFromSearch,
} from '../../src/views/workbenches/containers/shipment-candidate.logic'

const batchId = 'batch-1'
const warehouseValue = 'WH-A'

function view(overrides: Partial<ShipmentCandidateView> = {}): ShipmentCandidateView {
  return {
    id: 'shipment-1',
    shipmentNo: 'PKG/1',
    shippingMarkText: 'MARK/1',
    trackingNo: 'SF1',
    customerName: '王小明',
    purchaseType: 'SALES_LINKED',
    purchaseOrderNo: 'PO/1',
    salesOrderNo: 'SO/1',
    goodsName: '机器',
    viewStatus: 'WAREHOUSE_RECEIVED',
    warehouseReceivedAt: '2026-10-02T00:00:00.000Z',
    containerBatch: null,
    eligible: true,
    ineligibleReason: null,
    ineligibleReasonKey: null,
    matchFields: [],
    customerHint: 'UNKNOWN',
    selected: false,
    autoMatched: false,
    recommended: false,
    matchesThisBatch: false,
    matchedElsewhere: false,
    loadedWithoutBatch: false,
    ...overrides,
  }
}

function importCandidate(overrides: Partial<ContainerImportCandidateDto> = {}): ContainerImportCandidateDto {
  return {
    id: 'shipment-1',
    shipmentNo: 'PKG/1',
    shippingMarkText: 'MARK/1',
    trackingNo: 'SF1',
    warehouseValue,
    goodsName: '机器',
    purchaseOrderNo: 'PO/1',
    salesOrderNo: 'SO/1',
    customerName: '王小明',
    purchaseType: 'SALES_LINKED',
    viewStatus: 'WAREHOUSE_RECEIVED',
    warehouseReceivedAt: '2026-10-02T00:00:00.000Z',
    containerBatch: null,
    matchFields: ['trackingNo'],
    eligible: true,
    ineligibleReason: null,
    ...overrides,
  }
}

function shipmentItem(overrides: Partial<PurchaseShipmentListItemDto> = {}): PurchaseShipmentListItemDto {
  return {
    id: 'shipment-1',
    shipmentNo: 'PKG/1',
    partNumber: 1,
    status: 'ACTIVE',
    viewStatus: 'WAREHOUSE_RECEIVED',
    shippingMarkText: 'MARK/1',
    createdAt: '2026-10-01T00:00:00.000Z',
    shippedAt: null,
    shippedBy: null,
    shipmentRecordedAt: null,
    shipmentRemark: null,
    trackingNo: 'SF1',
    destinationWarehouseValue: warehouseValue,
    destinationWarehouse: null,
    warehouseReceivedAt: '2026-10-02T00:00:00.000Z',
    warehouseReceivedById: null,
    warehouseRecordedAt: null,
    warehouseRemark: null,
    warehouseReceivedBy: null,
    loadedAt: null,
    loadedBy: null,
    loadedRecordedAt: null,
    deliveredAt: null,
    deliveredBy: null,
    deliveredRecordedAt: null,
    deliveryRemark: null,
    containerBatch: null,
    purchaseOrder: {
      id: 'po-1',
      version: 1,
      orderNo: 'PO/1',
      orderDate: '2026-10-01',
      purchaseType: 'SALES_LINKED',
      productMode: 'CUSTOM',
      orderStatus: 'CONFIRMED',
      shippingMarkText: null,
      createdBy: { id: 'u1', displayName: '采购员', avatarUrl: null },
    },
    salesSource: { id: 'so-1', orderNo: 'SO/1', customerName: '王小明' },
    lineSummary: {
      lineCount: 2,
      totalQuantity: 3,
      previews: [
        { lineId: 'l1', lineNumber: 1, productNo: null, productName: '机器', quantity: 2, mainImage: null },
        { lineId: 'l2', lineNumber: 2, productNo: null, productName: '机器', quantity: 1, mainImage: null },
      ],
    },
    ...overrides,
  } as PurchaseShipmentListItemDto
}

const context = {
  batchId,
  warehouseValue,
  recipientName: '王小明先生',
  selectedId: null,
  matchedId: null,
  manuallySelected: false,
  canViewSalesOrder: true,
}

test('客户名只做保守归一化，不转换繁简', () => {
  assert.equal(normalizeCustomerName(' 王 小明 '), '王小明')
  assert.equal(normalizeCustomerName('王小明先生'), '王小明')
  assert.equal(normalizeCustomerName('陈先生'), '陈先生')
  assert.equal(normalizeCustomerName('ＡＢＣ'), 'ABC')
  assert.equal(normalizeCustomerName('王小明，'), '王小明')
  assert.equal(resolveCustomerHint('王小明先生', '王小明', 'SALES_LINKED'), 'MATCH')
  assert.equal(resolveCustomerHint('王小明', '陈小明', 'SALES_LINKED'), 'MISMATCH')
  assert.equal(resolveCustomerHint('陳先生', '陈先生', 'SALES_LINKED'), 'MISMATCH')
  assert.equal(resolveCustomerHint('王小明', null, 'STOCK'), 'UNKNOWN')
  assert.equal(resolveCustomerHint('', '王小明', 'SALES_LINKED'), 'UNKNOWN')
})

test('前端资格镜像与服务端顺序一致', () => {
  const base = { status: 'ACTIVE' as const, deliveredAt: null, loadedAt: null, warehouseReceivedAt: '2026-10-02T00:00:00.000Z', destinationWarehouseValue: warehouseValue, containerBatch: null }
  assert.deepEqual(resolveShipmentEligibilityFromFacts(base, batchId, warehouseValue), { eligible: true, reasonKey: null })
  assert.equal(resolveShipmentEligibilityFromFacts({ ...base, status: 'CANCELLED', deliveredAt: '2026-10-03T00:00:00.000Z' }, batchId, warehouseValue).reasonKey, 'containerImport.reason.unavailable')
  assert.equal(resolveShipmentEligibilityFromFacts({ ...base, deliveredAt: '2026-10-03T00:00:00.000Z' }, batchId, warehouseValue).reasonKey, 'containerImport.reason.delivered')
  assert.equal(resolveShipmentEligibilityFromFacts({ ...base, containerBatch: { id: 'batch-2' } }, batchId, warehouseValue).reasonKey, 'containerImport.reason.assigned')
  assert.equal(resolveShipmentEligibilityFromFacts({ ...base, loadedAt: '2026-10-03T00:00:00.000Z' }, batchId, warehouseValue).reasonKey, 'containerImport.reason.loaded')
  assert.equal(resolveShipmentEligibilityFromFacts({ ...base, loadedAt: '2026-10-03T00:00:00.000Z', containerBatch: { id: batchId } }, batchId, warehouseValue).eligible, true)
  assert.equal(resolveShipmentEligibilityFromFacts({ ...base, warehouseReceivedAt: null }, batchId, warehouseValue).reasonKey, 'containerImport.reason.notReceived')
  assert.equal(resolveShipmentEligibilityFromFacts({ ...base, destinationWarehouseValue: 'WH-B' }, batchId, warehouseValue).reasonKey, 'containerImport.reason.warehouseMismatch')
})

test('Level 2 只在恰好一个可选候选客户名一致时推荐', () => {
  assert.equal(resolveCandidateRecommendation([]), null)
  assert.equal(resolveCandidateRecommendation([view({ id: 'a', customerHint: 'MATCH' })]), null)
  assert.equal(resolveCandidateRecommendation([
    view({ id: 'a', customerHint: 'MATCH' }),
    view({ id: 'b', customerHint: 'MISMATCH' }),
  ]), 'a')
  assert.equal(resolveCandidateRecommendation([
    view({ id: 'a', customerHint: 'MATCH' }),
    view({ id: 'b', customerHint: 'MATCH' }),
  ]), null)
  assert.equal(resolveCandidateRecommendation([
    view({ id: 'a', customerHint: 'MATCH', eligible: false }),
    view({ id: 'b', customerHint: 'MISMATCH' }),
  ]), null)
  assert.equal(resolveCandidateRecommendation([
    view({ id: 'a', customerHint: 'MATCH', eligible: false }),
    view({ id: 'b', customerHint: 'MATCH' }),
  ]), 'b')
  assert.equal(resolveCandidateRecommendation([
    view({ id: 'a', customerHint: 'MISMATCH' }),
    view({ id: 'b', customerHint: 'UNKNOWN' }),
  ]), null)
})

test('卡片主状态与排序优先级', () => {
  assert.equal(resolveCandidatePrimaryState(view({ selected: true, autoMatched: true })), 'auto')
  assert.equal(resolveCandidatePrimaryState(view({ selected: true })), 'selected')
  assert.equal(resolveCandidatePrimaryState(view({ selected: true, eligible: false })), 'ineligible')
  assert.equal(resolveCandidatePrimaryState(view({ recommended: true })), 'recommended')
  assert.equal(resolveCandidatePrimaryState(view()), 'available')
  assert.equal(resolveCandidatePrimaryState(view({ eligible: false })), 'ineligible')
  const sorted = sortCandidateViews([
    view({ id: 'b', eligible: false, matchFields: ['trackingNo', 'shippingMarkText'] }),
    view({ id: 'a', customerHint: 'MATCH', matchFields: ['trackingNo'], warehouseReceivedAt: '2026-10-03T00:00:00.000Z' }),
    view({ id: 'c', recommended: true, matchFields: ['trackingNo'] }),
  ])
  assert.deepEqual(sorted.map(item => item.id), ['c', 'a', 'b'])
})

test('行级匹配结论区分候选全部不可用', () => {
  assert.equal(resolveRowMatchState({ displayStatus: 'MATCHED', manuallySelected: false, selectedShipment: { id: 'a' }, candidates: [{ eligible: true }] }), 'AUTO')
  assert.equal(resolveRowMatchState({ displayStatus: 'AMBIGUOUS', manuallySelected: false, selectedShipment: null, candidates: [{ eligible: true }, { eligible: false }] }), 'AMBIGUOUS')
  assert.equal(resolveRowMatchState({ displayStatus: 'AMBIGUOUS', manuallySelected: false, selectedShipment: null, candidates: [{ eligible: false }] }), 'UNAVAILABLE')
  assert.equal(resolveRowMatchState({ displayStatus: 'UNMATCHED', manuallySelected: false, selectedShipment: null, candidates: [] }), 'UNMATCHED')
  assert.equal(resolveRowMatchState({ displayStatus: 'AMBIGUOUS', manuallySelected: true, selectedShipment: { id: 'a' }, candidates: [] }), 'MANUAL')
})

test('导入候选视图保留命中字段、当前选择与客户名提示', () => {
  const result = buildImportCandidateView(importCandidate({ containerBatch: { id: 'batch-2', containerBatchNo: 'CTN/2', containerBatchName: '2柜' } }), {
    ...context,
    selectedId: 'shipment-1',
    matchedId: 'shipment-1',
  })
  assert.equal(result.customerHint, 'MATCH')
  assert.equal(result.selected, true)
  assert.equal(result.autoMatched, true)
  assert.equal(result.matchedElsewhere, true)
  assert.deepEqual(result.matchFields, ['trackingNo'])
})

test('搜索候选视图镜像资格并保留客户名与产品摘要', () => {
  const result = buildSearchCandidateView(shipmentItem(), context)
  assert.equal(result.eligible, true)
  assert.equal(result.customerHint, 'MATCH')
  assert.equal(result.goodsName, '机器')
  assert.equal(result.salesOrderNo, 'SO/1')
  const blocked = buildSearchCandidateView(shipmentItem({ deliveredAt: '2026-10-03T00:00:00.000Z' }), context)
  assert.equal(blocked.eligible, false)
  assert.equal(blocked.ineligibleReasonKey, 'containerImport.reason.delivered')
  assert.equal(buildSearchCandidateView(shipmentItem(), { ...context, canViewSalesOrder: false }).salesOrderNo, null)
})

test('搜索候选转为提交 DTO 时保留客户名、柜次与资格原因', () => {
  const item = shipmentItem({ containerBatch: { id: batchId, containerBatchNo: 'CTN/1', containerBatchName: '1柜' } })
  const eligibility = resolveShipmentEligibilityFromFacts(item, batchId, warehouseValue)
  const candidate = toImportCandidateFromSearch(item, eligibility, { canViewSalesOrder: true, reasonText: null })
  assert.equal(candidate.customerName, '王小明')
  assert.equal(candidate.eligible, true)
  assert.deepEqual(candidate.containerBatch, { id: batchId, containerBatchNo: 'CTN/1', containerBatchName: '1柜' })
  const blocked = toImportCandidateFromSearch(item, { eligible: false, reasonKey: 'containerImport.reason.loaded' }, { canViewSalesOrder: false, reasonText: '货件已装柜，不能关联新的柜次' })
  assert.equal(blocked.salesOrderNo, null)
  assert.equal(blocked.customerName, '王小明')
  assert.equal(blocked.ineligibleReason, '货件已装柜，不能关联新的柜次')
})
