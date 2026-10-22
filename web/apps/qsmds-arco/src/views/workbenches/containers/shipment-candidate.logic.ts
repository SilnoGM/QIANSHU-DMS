import type { ContainerImportCandidateDto, PurchaseShipmentContainerBatchDto, PurchaseShipmentListItemDto } from '@/api/generated/types.gen'

export type ShipmentCandidateMatchField = 'shippingMarkText' | 'trackingNo' | 'shipmentNo'
export type ShipmentCandidateCustomerHint = 'MATCH' | 'MISMATCH' | 'UNKNOWN'
export type ShipmentCandidatePrimaryState = 'selected' | 'auto' | 'recommended' | 'available' | 'ineligible'
export type ShipmentEligibilityReasonKey
  = | 'containerImport.reason.unavailable'
    | 'containerImport.reason.delivered'
    | 'containerImport.reason.loaded'
    | 'containerImport.reason.assigned'
    | 'containerImport.reason.notReceived'
    | 'containerImport.reason.warehouseMismatch'
export type RowMatchState = 'AUTO' | 'AMBIGUOUS' | 'UNAVAILABLE' | 'UNMATCHED' | 'MANUAL'

export interface ShipmentCandidateView {
  id: string
  shipmentNo: string | null
  shippingMarkText: string | null
  trackingNo: string | null
  customerName: string | null
  purchaseType: 'SALES_LINKED' | 'STOCK'
  purchaseOrderNo: string | null
  salesOrderNo: string | null
  goodsName: string
  viewStatus: PurchaseShipmentListItemDto['viewStatus']
  warehouseReceivedAt: string | null
  containerBatch: PurchaseShipmentContainerBatchDto | null
  eligible: boolean
  ineligibleReason: string | null
  ineligibleReasonKey: ShipmentEligibilityReasonKey | null
  matchFields: ShipmentCandidateMatchField[]
  customerHint: ShipmentCandidateCustomerHint
  selected: boolean
  autoMatched: boolean
  recommended: boolean
  matchesThisBatch: boolean
  matchedElsewhere: boolean
  loadedWithoutBatch: boolean
}

export interface CandidateViewContext {
  batchId: string
  warehouseValue: string
  recipientName: string | null
  selectedId: string | null
  matchedId: string | null
  manuallySelected: boolean
  canViewSalesOrder: boolean
}

export interface ShipmentEligibilityFacts {
  status: 'PENDING_REVIEW' | 'ACTIVE' | 'CANCELLED'
  deliveredAt: string | null
  loadedAt: string | null
  warehouseReceivedAt: string | null
  destinationWarehouseValue: string | null
  containerBatch: { id: string } | null
}

export interface ShipmentEligibilityResult {
  eligible: boolean
  reasonKey: ShipmentEligibilityReasonKey | null
}

const CUSTOMER_NAME_HONORIFICS = /(?:先生|女士|小姐|太太|老板|老闆)$/u
const CUSTOMER_NAME_IGNORED = /[\s·.,，。:：;；、()（）【】[\]{}<>《》"'“”‘’\-_/\\|]+/gu

/** 只做展示层的姓名归一化：不转换繁简，避免为了提示引入额外词表或依赖。 */
export function normalizeCustomerName(value: string | null | undefined): string {
  const normalized = (value ?? '').normalize('NFKC').trim().replace(CUSTOMER_NAME_IGNORED, '')
  if (!normalized) {
    return ''
  }
  const withoutHonorific = normalized.replace(CUSTOMER_NAME_HONORIFICS, '')
  return [...withoutHonorific].length >= 2 ? withoutHonorific : normalized
}

export function resolveCustomerHint(
  recipientName: string | null | undefined,
  customerName: string | null | undefined,
  purchaseType: 'SALES_LINKED' | 'STOCK',
): ShipmentCandidateCustomerHint {
  if (purchaseType === 'STOCK' || !recipientName || !customerName) {
    return 'UNKNOWN'
  }
  const recipient = normalizeCustomerName(recipientName)
  const customer = normalizeCustomerName(customerName)
  if (!recipient || !customer) {
    return 'UNKNOWN'
  }
  return recipient === customer ? 'MATCH' : 'MISMATCH'
}

/**
 * 搜索/详情选择器的资格镜像，顺序必须与服务端 resolveContainerShipmentEligibility 一致。
 * 已装柜只允许本柜追加；柜次为空时无法证明归属，按历史解绑处理。
 */
export function resolveShipmentEligibilityFromFacts(
  facts: ShipmentEligibilityFacts,
  batchId: string,
  warehouseValue: string,
): ShipmentEligibilityResult {
  if (facts.status !== 'ACTIVE') {
    return { eligible: false, reasonKey: 'containerImport.reason.unavailable' }
  }
  if (facts.deliveredAt !== null) {
    return { eligible: false, reasonKey: 'containerImport.reason.delivered' }
  }
  if (facts.containerBatch !== null && facts.containerBatch.id !== batchId) {
    return { eligible: false, reasonKey: 'containerImport.reason.assigned' }
  }
  if (facts.loadedAt !== null && facts.containerBatch?.id !== batchId) {
    return { eligible: false, reasonKey: 'containerImport.reason.loaded' }
  }
  if (facts.warehouseReceivedAt === null) {
    return { eligible: false, reasonKey: 'containerImport.reason.notReceived' }
  }
  if (facts.destinationWarehouseValue !== warehouseValue) {
    return { eligible: false, reasonKey: 'containerImport.reason.warehouseMismatch' }
  }
  return { eligible: true, reasonKey: null }
}

function customerHintFor(candidate: { customerName: string | null, purchaseType: 'SALES_LINKED' | 'STOCK' }, context: CandidateViewContext) {
  return resolveCustomerHint(context.recipientName, candidate.customerName, candidate.purchaseType)
}

export function buildImportCandidateView(
  candidate: ContainerImportCandidateDto,
  context: CandidateViewContext,
): ShipmentCandidateView {
  return {
    id: candidate.id,
    shipmentNo: candidate.shipmentNo,
    shippingMarkText: candidate.shippingMarkText,
    trackingNo: candidate.trackingNo,
    customerName: candidate.customerName,
    purchaseType: candidate.purchaseType,
    purchaseOrderNo: candidate.purchaseOrderNo,
    salesOrderNo: context.canViewSalesOrder ? candidate.salesOrderNo : null,
    goodsName: candidate.goodsName,
    viewStatus: candidate.viewStatus,
    warehouseReceivedAt: candidate.warehouseReceivedAt,
    containerBatch: candidate.containerBatch,
    eligible: candidate.eligible,
    ineligibleReason: candidate.ineligibleReason,
    ineligibleReasonKey: null,
    matchFields: candidate.matchFields,
    customerHint: customerHintFor(candidate, context),
    selected: candidate.id === context.selectedId,
    autoMatched: candidate.id === context.matchedId && !context.manuallySelected,
    recommended: false,
    matchesThisBatch: candidate.containerBatch?.id === context.batchId,
    matchedElsewhere: candidate.containerBatch !== null && candidate.containerBatch.id !== context.batchId,
    loadedWithoutBatch: candidate.viewStatus === 'CONTAINER_LOADED' && candidate.containerBatch === null,
  }
}

export function buildSearchCandidateView(
  item: PurchaseShipmentListItemDto,
  context: CandidateViewContext,
): ShipmentCandidateView {
  const eligibility = resolveShipmentEligibilityFromFacts(item, context.batchId, context.warehouseValue)
  return {
    id: item.id,
    shipmentNo: item.shipmentNo,
    shippingMarkText: item.shippingMarkText,
    trackingNo: item.trackingNo,
    customerName: item.salesSource?.customerName ?? null,
    purchaseType: item.purchaseOrder.purchaseType,
    purchaseOrderNo: item.purchaseOrder.orderNo,
    salesOrderNo: context.canViewSalesOrder ? item.salesSource?.orderNo ?? null : null,
    goodsName: [...new Set(item.lineSummary.previews.map(preview => preview.productName))].join('、') || '—',
    viewStatus: item.viewStatus,
    warehouseReceivedAt: item.warehouseReceivedAt,
    containerBatch: item.containerBatch,
    eligible: eligibility.eligible,
    ineligibleReason: null,
    ineligibleReasonKey: eligibility.reasonKey,
    matchFields: [],
    customerHint: customerHintFor({ customerName: item.salesSource?.customerName ?? null, purchaseType: item.purchaseOrder.purchaseType }, context),
    selected: item.id === context.selectedId,
    autoMatched: false,
    recommended: false,
    matchesThisBatch: item.containerBatch?.id === context.batchId,
    matchedElsewhere: item.containerBatch !== null && item.containerBatch.id !== context.batchId,
    loadedWithoutBatch: item.viewStatus === 'CONTAINER_LOADED' && item.containerBatch === null,
  }
}

export function toImportCandidateFromSearch(
  item: PurchaseShipmentListItemDto,
  eligibility: ShipmentEligibilityResult,
  options: { canViewSalesOrder: boolean, reasonText: string | null },
): ContainerImportCandidateDto {
  return {
    id: item.id,
    shipmentNo: item.shipmentNo,
    shippingMarkText: item.shippingMarkText,
    trackingNo: item.trackingNo,
    warehouseValue: item.destinationWarehouseValue,
    goodsName: [...new Set(item.lineSummary.previews.map(preview => preview.productName))].join(' + ') || '—',
    purchaseOrderNo: item.purchaseOrder.orderNo,
    salesOrderNo: options.canViewSalesOrder ? item.salesSource?.orderNo ?? null : null,
    customerName: item.salesSource?.customerName ?? null,
    purchaseType: item.purchaseOrder.purchaseType,
    viewStatus: item.viewStatus,
    warehouseReceivedAt: item.warehouseReceivedAt,
    containerBatch: item.containerBatch,
    matchFields: [],
    eligible: eligibility.eligible,
    ineligibleReason: eligibility.eligible ? null : options.reasonText,
  }
}

/** Level 2：只有多个精确候选、且恰好一个可选候选客户名一致时才产生推荐，绝不改变自动匹配状态。 */
export function resolveCandidateRecommendation(views: readonly ShipmentCandidateView[]): string | null {
  if (views.length < 2) {
    return null
  }
  const matching = views.filter(view => view.eligible && view.customerHint === 'MATCH')
  return matching.length === 1 ? matching[0]!.id : null
}

export function sortCandidateViews(views: readonly ShipmentCandidateView[]): ShipmentCandidateView[] {
  return [...views].sort((left, right) =>
    Number(right.eligible) - Number(left.eligible)
    || Number(right.recommended) - Number(left.recommended)
    || Number(right.customerHint === 'MATCH') - Number(left.customerHint === 'MATCH')
    || right.matchFields.length - left.matchFields.length
    || (right.warehouseReceivedAt ?? '').localeCompare(left.warehouseReceivedAt ?? '')
    || (left.shipmentNo ?? '').localeCompare(right.shipmentNo ?? ''))
}

export function resolveCandidatePrimaryState(view: ShipmentCandidateView): ShipmentCandidatePrimaryState {
  // 不可关联的当前值只保留 radio 选中态；主标签必须先说明它不能再被选用。
  if (!view.eligible) {
    return 'ineligible'
  }
  if (view.selected) {
    return view.autoMatched ? 'auto' : 'selected'
  }
  if (view.recommended) {
    return 'recommended'
  }
  return 'available'
}

export interface RowMatchInput {
  displayStatus: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'INVALID' | 'SKIPPED'
  manuallySelected: boolean
  selectedShipment: { id: string } | null
  candidates: ReadonlyArray<{ eligible: boolean }>
}

export function resolveRowMatchState(row: RowMatchInput): RowMatchState {
  if (row.manuallySelected && row.selectedShipment !== null) {
    return 'MANUAL'
  }
  if (row.displayStatus === 'MATCHED') {
    return 'AUTO'
  }
  if (row.displayStatus === 'AMBIGUOUS') {
    return row.candidates.some(candidate => candidate.eligible) ? 'AMBIGUOUS' : 'UNAVAILABLE'
  }
  return 'UNMATCHED'
}
