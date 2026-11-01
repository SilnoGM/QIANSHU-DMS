import { Prisma } from '../../generated/prisma/client'

/** 调货记录里的变更计数：卡片只展示项数，完整前后值在寄仓详情页。 */
export interface SlhTransferChangeCounts {
  readonly recipientChangeCount: number
  readonly codChangeCount: number
}

/** 认领明细汇总：没有 claim_lines 的历史记录可退回使用申请快照里的 allocations。 */
export interface SlhTransferAllocationSummary {
  readonly lineCount: number
  readonly totalQuantity: number
  readonly manualMatchCount: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** 统计改收件人/改代收的条目数；历史快照缺字段或形状不对时按 0 计，不回表猜测。 */
export function readTransferChangeCounts(value: Prisma.JsonValue | null): SlhTransferChangeCounts {
  let recipientChangeCount = 0
  let codChangeCount = 0
  for (const raw of asArray(value)) {
    const item = asRecord(raw)
    if (item === null) continue
    if (item['recipientChanged'] === true) recipientChangeCount += 1
    if (item['codChanged'] === true) codChangeCount += 1
  }
  return { recipientChangeCount, codChangeCount }
}

/** 认领行数/数量/手工匹配数；优先使用 claim_lines，缺失时退回申请快照。 */
export function readTransferAllocationSummary(
  claimLines: readonly { readonly quantity: number, readonly productMatchMode: string | null }[],
  allocations: Prisma.JsonValue | null,
): SlhTransferAllocationSummary {
  if (claimLines.length > 0) {
    return {
      lineCount: claimLines.length,
      totalQuantity: claimLines.reduce((sum, line) => sum + line.quantity, 0),
      manualMatchCount: claimLines.filter(line => line.productMatchMode === 'MANUAL_OVERRIDE').length,
    }
  }
  let totalQuantity = 0
  let manualMatchCount = 0
  const items = asArray(allocations)
  for (const raw of items) {
    const item = asRecord(raw)
    if (item === null) continue
    if (typeof item['quantity'] === 'number' && Number.isFinite(item['quantity'])) {
      totalQuantity += item['quantity']
    }
    if (item['productMatchMode'] === 'MANUAL_OVERRIDE') manualMatchCount += 1
  }
  return { lineCount: items.length, totalQuantity, manualMatchCount }
}

/** 读取成本快照里的总额；空值/非数字返回 null，卡面不造伪 0。 */
export function readTransferCostTotal(value: Prisma.JsonValue | null): string | null {
  const record = asRecord(value)
  const raw = record?.['totalCostCny']
  if (typeof raw === 'string' && raw.trim() !== '') return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw.toFixed(2)
  return null
}

/**
 * 从同一货件的寄仓记录里选出「当前销售单」对应的那条。
 *
 * 一个货件可能经历多次认领/修正；只认 `claimedSalesOrderId` 等于当前乙的记录，
 * 再按认领时间取最新，避免把更早的认领或占位记录当成当前调货依据。
 */
export function selectCurrentTransferRecord<T extends {
  readonly claimedSalesOrderId: string | null
  readonly claimedAt: Date | null
  readonly createdAt: Date
}>(records: readonly T[], currentSalesOrderId: string): T | null {
  const candidates = records
    .filter(record => record.claimedSalesOrderId === currentSalesOrderId)
    .sort((left, right) => (
      (right.claimedAt ?? right.createdAt).getTime() - (left.claimedAt ?? left.createdAt).getTime()
    ))
  return candidates[0] ?? null
}
