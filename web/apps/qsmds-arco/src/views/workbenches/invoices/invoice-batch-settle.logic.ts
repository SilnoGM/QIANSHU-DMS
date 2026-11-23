import type { InvoiceRequestListItemDto } from '@/api/generated/types.gen'
import { calculateEstimatedCostCny } from './invoice-cost.logic'
import { isSettleable } from './invoice-status.logic'

/**
 * 批量结算的选择与预览口径。
 *
 * 只有「已开出邮寄且满 120 小时」的行可选；上限与服务端 DTO 一致。
 * 合计必须逐单向上取整后相加——先合计台币总额再套公式会少收手续费。
 */
export const INVOICE_BATCH_SETTLE_LIMIT = 50

/** 选择与预览只需要这几个字段；页面行本身是完整 DTO，结构兼容。 */
export type InvoiceBatchSettleRow = Pick<
  InvoiceRequestListItemDto,
  'buyerName' | 'documentUploadedAt' | 'id' | 'invoiceNo' | 'status' | 'totalAmount' | 'version'
>

export type InvoiceBatchSettleSelection = ReadonlyMap<string, InvoiceBatchSettleRow>

export interface InvoiceBatchSettleSelectionReconcileResult {
  readonly limited: boolean
  readonly selected: InvoiceBatchSettleSelection
}

export interface InvoiceBatchSettlePageSelectionPlan {
  readonly count: number
  readonly ids: readonly string[]
  readonly remaining: number
}

/** 行是否具备批量结算资格：状态必须是已开出邮寄，且照片上传已满 120 小时。 */
export function canBatchSettleRow(row: InvoiceBatchSettleRow, now: Date): boolean {
  return row.status === 'ISSUED'
    && row.documentUploadedAt !== null
    && row.documentUploadedAt !== undefined
    && isSettleable(row.documentUploadedAt, now)
}

/** 非可结算行不可选；达到上限后只允许取消已选行，不能继续新增。 */
export function isBatchSettleSelectionDisabled(
  selected: InvoiceBatchSettleSelection,
  row: InvoiceBatchSettleRow,
  now: Date,
  limit = INVOICE_BATCH_SETTLE_LIMIT,
): boolean {
  // 已选项始终可取消；否则状态在别处变化后复选框会卡住无法移除。
  if (selected.has(row.id)) {
    return false
  }
  return !canBatchSettleRow(row, now) || selected.size >= limit
}

/**
 * FaTable 的 selectionChange 同时给出当前页 rows 与全量 rowSelection。
 * 页面据此保留其他页的已选快照、更新当前页数据，并在超过上限时标记 limited。
 */
export function reconcileBatchSettleSelection(
  selected: InvoiceBatchSettleSelection,
  pageRows: readonly InvoiceBatchSettleRow[],
  rowSelection: Readonly<Record<string, boolean>>,
  limit = INVOICE_BATCH_SETTLE_LIMIT,
): InvoiceBatchSettleSelectionReconcileResult {
  const selectedIds = new Set(
    Object.entries(rowSelection)
      .filter(([, checked]) => checked)
      .map(([id]) => id),
  )
  const pageById = new Map(pageRows.map(row => [row.id, row]))
  const next = new Map<string, InvoiceBatchSettleRow>()

  for (const [id, row] of selected) {
    // 当前页快照优先；已选但已不在当前页的行继续保留快照，否则复选框无法取消。
    if (selectedIds.has(id)) {
      next.set(id, pageById.get(id) ?? row)
    }
  }

  let limited = false
  for (const row of pageRows) {
    if (!selectedIds.has(row.id) || next.has(row.id)) {
      continue
    }
    if (next.size >= limit) {
      limited = true
      continue
    }
    next.set(row.id, row)
  }

  const changed = next.size !== selected.size
    || [...next].some(([id, row]) => selected.get(id) !== row)

  return { limited, selected: changed ? next : selected }
}

/** 「选择本页」只补足到全局上限，跳过已选与不可结算行。 */
export function resolveBatchSettlePageSelection(
  pageRows: readonly InvoiceBatchSettleRow[],
  selected: InvoiceBatchSettleSelection,
  now: Date,
  limit = INVOICE_BATCH_SETTLE_LIMIT,
): InvoiceBatchSettlePageSelectionPlan {
  const remaining = Math.max(0, limit - selected.size)
  if (remaining === 0) {
    return { count: 0, ids: [], remaining: 0 }
  }
  const ids: string[] = []
  for (const row of pageRows) {
    if (ids.length >= remaining) {
      break
    }
    if (!canBatchSettleRow(row, now) || selected.has(row.id)) {
      continue
    }
    ids.push(row.id)
  }
  return { count: ids.length, ids, remaining: remaining - ids.length }
}

/** 「取消本页」只动当前页已选中的行，其他页的选择保持。 */
export function resolveBatchSettleSelectedPageIds(
  pageRows: readonly InvoiceBatchSettleRow[],
  selected: InvoiceBatchSettleSelection,
): readonly string[] {
  return pageRows.filter(row => selected.has(row.id)).map(row => row.id)
}

export interface InvoiceBatchSettlePreviewItem {
  readonly id: string
  readonly invoiceNo: string
  readonly buyerName: string
  readonly totalAmount: string
  readonly settleAmountCny: string
}

export interface InvoiceBatchSettlePreview {
  readonly items: readonly InvoiceBatchSettlePreviewItem[]
  readonly totalAmountCny: string
}

/**
 * 批量确认弹窗的金额预览：逐单算成本（向上取整）后相加。
 * 汇率非法或金额不可解析时返回 null，由调用方显示占位，不展示错误数字。
 */
export function buildBatchSettlePreview(
  rows: readonly InvoiceBatchSettleRow[],
  foreignUnitsPerCny: string,
): InvoiceBatchSettlePreview | null {
  const rate = Number(foreignUnitsPerCny)
  if (!Number.isFinite(rate) || rate <= 0) {
    return null
  }
  const items: InvoiceBatchSettlePreviewItem[] = []
  for (const row of rows) {
    const cost = calculateEstimatedCostCny(Number(row.totalAmount), rate)
    if (cost === null) {
      return null
    }
    items.push({
      id: row.id,
      invoiceNo: row.invoiceNo,
      buyerName: row.buyerName,
      totalAmount: row.totalAmount,
      settleAmountCny: String(cost),
    })
  }
  const total = items.reduce((sum, item) => sum + Number(item.settleAmountCny), 0)
  return { items, totalAmountCny: total.toFixed(2) }
}

/** 批量预检失败时取逐张原因；服务端放在 fieldErrors.invalidItems，格式是「单号：原因」。 */
export function resolveBatchSettleInvalidItems(error: unknown): string[] {
  const items = (error as { body?: { fieldErrors?: { invalidItems?: unknown } } } | null)
    ?.body
    ?.fieldErrors
    ?.invalidItems
  return Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string') : []
}
