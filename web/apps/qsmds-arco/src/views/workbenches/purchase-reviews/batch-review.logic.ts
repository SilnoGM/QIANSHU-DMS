import type {
  PurchaseOrderDetailDto,
  PurchaseOrderImageDraftDto,
  PurchaseOrderListItemDto,
} from '../../../api/generated/types.gen'

/** 单次批量审核上限；表格选择、弹窗初始化和提交循环都以此为硬边界。 */
export const PURCHASE_BATCH_REVIEW_LIMIT = 20
export const PURCHASE_BATCH_REVIEW_DEFAULT_REASON = '批量审核：采购订单审核通过，进入备货'

export type PurchaseBatchSelection = ReadonlyMap<string, PurchaseOrderListItemDto>

export interface PurchaseBatchSelectionReconcileResult {
  readonly limited: boolean
  readonly selected: PurchaseBatchSelection
}

export interface PurchaseBatchPageSelectionPlan {
  readonly count: number
  readonly ids: readonly string[]
  readonly remaining: number
}

export function resolvePurchaseBatchSelectedPageIds(
  pageOrders: readonly PurchaseOrderListItemDto[],
  selected: PurchaseBatchSelection,
): readonly string[] {
  const ids: string[] = []
  for (const order of pageOrders) {
    if (selected.has(order.id)) {
      ids.push(order.id)
    }
  }
  return ids
}

/** 勾选本页只补足到全局上限，跳过已选和非待审核行；页大小超过 20 时只取前 N 条。 */
export function resolvePurchaseBatchPageSelection(
  pageOrders: readonly PurchaseOrderListItemDto[],
  selected: PurchaseBatchSelection,
  limit = PURCHASE_BATCH_REVIEW_LIMIT,
): PurchaseBatchPageSelectionPlan {
  const remaining = Math.max(0, limit - selected.size)
  if (remaining === 0) {
    return { count: 0, ids: [], remaining: 0 }
  }
  const ids: string[] = []
  for (const order of pageOrders) {
    if (ids.length >= remaining) {
      break
    }
    if (order.orderStatus !== 'PENDING_REVIEW' || selected.has(order.id)) {
      continue
    }
    ids.push(order.id)
  }
  return { count: ids.length, ids, remaining }
}

export type PurchaseBatchItemStatus
  = | 'idle'
    | 'generating'
    | 'ready'
    | 'generate-failed'
    | 'reviewing'
    | 'approved'
    | 'review-failed'
    | 'blocked'

export interface PurchaseBatchItemError {
  readonly code: string | null
  readonly message: string
  readonly retryable: boolean
}

export interface PurchaseBatchItemState {
  order: PurchaseOrderListItemDto
  status: PurchaseBatchItemStatus
  detail: PurchaseOrderDetailDto | null
  draft: PurchaseOrderImageDraftDto | null
  previewUrl: string | null
  previewLoaded: boolean
  previewError: string | null
  error: PurchaseBatchItemError | null
  note: string | null
}

export interface PurchaseBatchSummary {
  readonly total: number
  readonly active: number
  readonly idle: number
  readonly generating: number
  readonly ready: number
  readonly generateFailed: number
  readonly reviewing: number
  readonly approved: number
  readonly reviewFailed: number
  readonly blocked: number
  readonly generated: number
  readonly failed: number
  readonly loaded: number
  readonly reviewable: number
  readonly remainingPreview: number
  readonly processed: number
  readonly allGenerated: boolean
  readonly canGenerate: boolean
  readonly canRetry: boolean
  readonly canRegenerate: boolean
  readonly canConfirm: boolean
}

export type PurchaseBatchPrimaryAction = 'generate' | 'retry' | 'regenerate' | null

export interface PurchaseBatchActions {
  readonly primary: PurchaseBatchPrimaryAction
  readonly primaryCompleted: number
  readonly primaryFailed: number
  readonly total: number
  readonly confirmCount: number
  readonly confirmLabel: 'all' | 'remaining'
  readonly confirmEnabled: boolean
  readonly remainingPreview: number
}

/** 非待审核行不可选；达到上限后只允许取消已选行，不能继续新增。 */
export function isPurchaseBatchSelectionDisabled(
  selected: PurchaseBatchSelection,
  order: Pick<PurchaseOrderListItemDto, 'id' | 'orderStatus'>,
  limit = PURCHASE_BATCH_REVIEW_LIMIT,
): boolean {
  // 已选项始终可取消；否则订单被别人改状态后会卡住无法移除。
  if (selected.has(order.id)) {
    return false
  }
  return order.orderStatus !== 'PENDING_REVIEW' || selected.size >= limit
}

/**
 * FaTable 的 selectionChange 同时给出当前页 rows 和全量 rowSelection。
 * 页面据此保留其他页已选快照、更新当前页数据，并在达到 20 单时标记 limited。
 */
export function reconcilePurchaseBatchSelection(
  selected: PurchaseBatchSelection,
  pageOrders: readonly PurchaseOrderListItemDto[],
  rowSelection: Readonly<Record<string, boolean>>,
  limit = PURCHASE_BATCH_REVIEW_LIMIT,
): PurchaseBatchSelectionReconcileResult {
  const selectedIds = new Set(
    Object.entries(rowSelection)
      .filter(([, checked]) => checked)
      .map(([id]) => id),
  )
  const pageById = new Map(pageOrders.map(order => [order.id, order]))
  const next = new Map<string, PurchaseOrderListItemDto>()

  for (const [id, order] of selected) {
    // 当前页快照优先；已选但后来失效的订单继续留在选择集合里，
    // 否则表格内部仍勾选、页面却失去快照，复选框会卡成不可取消。
    const current = pageById.get(id) ?? order
    if (selectedIds.has(id)) {
      next.set(id, current)
    }
  }

  let limited = false
  for (const order of pageOrders) {
    if (!selectedIds.has(order.id) || next.has(order.id)) {
      continue
    }
    if (next.size >= limit) {
      limited = true
      continue
    }
    next.set(order.id, order)
  }

  const changed = next.size !== selected.size
    || [...next].some(([id, order]) => selected.get(id) !== order)

  return { limited, selected: changed ? next : selected }
}

export function createPurchaseBatchItem(
  order: PurchaseOrderListItemDto,
): PurchaseBatchItemState {
  return {
    order,
    status: 'idle',
    detail: null,
    draft: null,
    previewUrl: null,
    previewLoaded: false,
    previewError: null,
    error: null,
    note: null,
  }
}

function isReviewableItem(item: PurchaseBatchItemState): boolean {
  return item.status === 'ready' || item.status === 'review-failed'
}

export function summarizePurchaseBatch(
  items: readonly PurchaseBatchItemState[],
): PurchaseBatchSummary {
  const count = (status: PurchaseBatchItemStatus) => items.filter(item => item.status === status).length
  const idle = count('idle')
  const generating = count('generating')
  const ready = count('ready')
  const generateFailed = count('generate-failed')
  const reviewing = count('reviewing')
  const approved = count('approved')
  const reviewFailed = count('review-failed')
  const blocked = count('blocked')
  const total = items.length
  const active = total - blocked
  const generated = ready + reviewing + approved + reviewFailed
  const failed = generateFailed + reviewFailed
  const loaded = items.filter(item => item.previewLoaded).length
  const reviewable = ready + reviewFailed
  const remainingPreview = items.filter(item => isReviewableItem(item) && !item.previewLoaded).length
  const processed = Math.max(0, active - idle - generating)
  const allGenerated = active > 0
    && idle === 0
    && generating === 0
    && generateFailed === 0
  const canGenerate = idle + generateFailed > 0
  const canRetry = generateFailed > 0
  const canRegenerate = allGenerated && reviewable > 0
  const canConfirm = active > 0
    && idle === 0
    && generating === 0
    && generateFailed === 0
    && reviewing === 0
    && reviewable > 0
    && remainingPreview === 0

  return {
    total,
    active,
    idle,
    generating,
    ready,
    generateFailed,
    reviewing,
    approved,
    reviewFailed,
    blocked,
    generated,
    failed,
    loaded,
    reviewable,
    remainingPreview,
    processed,
    allGenerated,
    canGenerate,
    canRetry,
    canRegenerate,
    canConfirm,
  }
}

export function resolvePurchaseBatchActions(
  summary: PurchaseBatchSummary,
  busy = false,
): PurchaseBatchActions {
  let primary: PurchaseBatchPrimaryAction = null
  if (summary.canRetry) {
    primary = 'retry'
  }
  else if (summary.canGenerate || summary.generating > 0) {
    primary = 'generate'
  }
  else if (summary.canRegenerate) {
    primary = 'regenerate'
  }

  const regenerate = primary === 'regenerate'
  return {
    primary,
    // 已审核订单不再参与重新生成，按钮只统计仍可重新生成的订单。
    primaryCompleted: regenerate ? summary.reviewable : summary.generated,
    primaryFailed: summary.generateFailed,
    total: regenerate ? summary.reviewable : summary.active,
    confirmCount: summary.reviewable,
    confirmLabel: summary.approved > 0 ? 'remaining' : 'all',
    confirmEnabled: !busy && summary.canConfirm,
    remainingPreview: summary.remainingPreview,
  }
}

export function isPurchaseBatchImageStaleError(code: string | null | undefined): boolean {
  return code === 'PURCHASE_ORDER_IMAGE_STALE'
    || code === 'PURCHASE_ORDER_IMAGE_UNAVAILABLE'
    || code === 'PURCHASE_ORDER_IMAGE_REQUIRED'
    || code === 'PURCHASE_ORDER_IMAGE_MARKS_REQUIRED'
}

export function isPurchaseBatchAuthError(code: string | null | undefined): boolean {
  return code === 'FORBIDDEN'
    || code === 'UNAUTHORIZED'
    || code === 'CSRF_REJECTED'
    || code === 'PASSWORD_CHANGE_REQUIRED'
}

export function isPurchaseBatchRetryableError(code: string | null | undefined): boolean {
  if (code === null || code === undefined) {
    return true
  }
  return code === 'MEDIA_STORAGE_UNAVAILABLE'
    || code === 'PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE'
    || code === 'PURCHASE_ORDER_STATE_CHANGED'
    || code === 'PURCHASE_ORDER_IMAGE_STALE'
    || code === 'PURCHASE_ORDER_IMAGE_MARKS_REQUIRED'
    || code === 'PURCHASE_ORDER_IMAGE_UNAVAILABLE'
    || code === 'PURCHASE_ORDER_IMAGE_REQUIRED'
    || code === 'INTERNAL_ERROR'
}
