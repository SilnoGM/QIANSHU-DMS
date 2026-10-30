import type { SalesOrderLineDto, ShipmentStorageProductPreviewDto } from '@/api/generated/types.gen'

export interface ClaimMappingRow {
  readonly key: string
  readonly purchaseOrderLineId: string
  readonly sourceLineNumber: number
  readonly sourceProductName: string
  readonly sourceProductDescription: string | null
  readonly targetLineId: string
  readonly targetLineNumber: number
  readonly targetProductName: string
  readonly targetProductDescription: string | null
  readonly quantity: number
  readonly mismatch: boolean
}

export interface ClaimMappingUnmatched {
  readonly purchaseOrderLineId: string
  readonly productName: string
  readonly remaining: number
}

export interface ClaimMapping {
  readonly rows: readonly ClaimMappingRow[]
  readonly unmatched: readonly ClaimMappingUnmatched[]
  readonly totalQuantity: number
  readonly mappedQuantity: number
  readonly complete: boolean
  readonly requiresConfirmation: boolean
}

/** 与服务端 product-match 保持同一口径，只用于弹窗预演；最终校验以服务端为准。 */
export function normalizeClaimProductName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function hasCustomTargetLine(targetLines: readonly SalesOrderLineDto[]): boolean {
  return targetLines.some(line => line.lineType === 'CUSTOM')
}

function matchesProduct(
  allocation: ShipmentStorageProductPreviewDto,
  line: SalesOrderLineDto,
): boolean {
  if (allocation.lineType !== line.lineType) {
    return false
  }
  if (line.lineType === 'CATALOG') {
    return allocation.productId !== null && allocation.productId === line.productId
  }
  return allocation.normalizedNames.includes(normalizeClaimProductName(line.productName))
}

function appendRows(
  rows: ClaimMappingRow[],
  allocation: ShipmentStorageProductPreviewDto,
  line: SalesOrderLineDto,
  quantity: number,
  mismatch: boolean,
): void {
  rows.push({
    key: `${allocation.lineId}:${line.id}:${rows.length}`,
    purchaseOrderLineId: allocation.lineId,
    sourceLineNumber: allocation.lineNumber,
    sourceProductName: allocation.productName,
    sourceProductDescription: allocation.productDescription,
    targetLineId: line.id,
    targetLineNumber: line.lineNumber,
    targetProductName: line.productName,
    targetProductDescription: line.description,
    quantity,
    mismatch,
  })
}

/**
 * 先按产品身份自动分配；自定义产品没有同名目标行（或数量不足）时，
 * 只能由用户显式选择一条自定义目标行，选中后按跨产品进入人工确认。
 */
export function buildClaimMapping(
  allocations: readonly ShipmentStorageProductPreviewDto[],
  targetLines: readonly SalesOrderLineDto[],
  manualTargets: Readonly<Record<string, string>> = {},
): ClaimMapping {
  const remainingByLine = new Map(targetLines.map(line => [line.id, line.quantity]))
  const lineById = new Map(targetLines.map(line => [line.id, line]))
  const rows: ClaimMappingRow[] = []
  const unmatched: ClaimMappingUnmatched[] = []
  const totalQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0)

  for (const allocation of allocations) {
    let remaining = allocation.quantity
    if (allocation.lineType === 'CATALOG' || allocation.lineType === 'CUSTOM') {
      for (const line of targetLines) {
        if (remaining <= 0) {
          break
        }
        if (!matchesProduct(allocation, line)) {
          continue
        }
        const capacity = remainingByLine.get(line.id) ?? 0
        const quantity = Math.min(capacity, remaining)
        if (quantity <= 0) {
          continue
        }
        appendRows(rows, allocation, line, quantity, false)
        remainingByLine.set(line.id, capacity - quantity)
        remaining -= quantity
      }
    }
    if (remaining > 0 && allocation.lineType === 'CUSTOM') {
      const manualLineId = manualTargets[allocation.lineId]
      const manualLine = manualLineId === undefined ? undefined : lineById.get(manualLineId)
      if (manualLine !== undefined && manualLine.lineType === 'CUSTOM') {
        const capacity = remainingByLine.get(manualLine.id) ?? 0
        const quantity = Math.min(capacity, remaining)
        if (quantity > 0) {
          appendRows(rows, allocation, manualLine, quantity, !matchesProduct(allocation, manualLine))
          remainingByLine.set(manualLine.id, capacity - quantity)
          remaining -= quantity
        }
      }
    }
    if (remaining > 0) {
      unmatched.push({
        purchaseOrderLineId: allocation.lineId,
        productName: allocation.productName,
        remaining,
      })
    }
  }

  const mappedQuantity = rows.reduce((sum, row) => sum + row.quantity, 0)
  return {
    rows,
    unmatched,
    totalQuantity,
    mappedQuantity,
    complete: totalQuantity > 0 && mappedQuantity === totalQuantity && unmatched.length === 0,
    requiresConfirmation: rows.some(row => row.mismatch),
  }
}
