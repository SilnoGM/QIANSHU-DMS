import type { Prisma as PrismaTypes } from '../../generated/prisma/client'

/**
 * 认领是采购覆盖之外的第二条货源事实：寄仓货件已存在且已完成到仓，
 * 认领后按目标销售明细计入覆盖，才能让新销售单离开待采购。
 * 只统计仍处于 CLAIMED 的寄仓记录；认领是不可逆终态，历史行不会重复计入。
 */
export async function readClaimedQuantitiesBySalesLine(
  transaction: PrismaTypes.TransactionClient,
  salesOrderId: string,
  salesLineIds: readonly string[],
): Promise<Map<string, number>> {
  if (salesLineIds.length === 0) return new Map()
  const rows = await transaction.shipmentClaimLine.findMany({
    where: {
      salesOrderLineId: { in: [...salesLineIds] },
      storageRecord: { status: 'CLAIMED', claimedSalesOrderId: salesOrderId },
    },
    select: { salesOrderLineId: true, quantity: true },
  })
  const quantities = new Map<string, number>()
  for (const row of rows) {
    quantities.set(
      row.salesOrderLineId,
      (quantities.get(row.salesOrderLineId) ?? 0) + row.quantity,
    )
  }
  return quantities
}

/**
 * 已转出本单的货件条目数量：释放进池、被其他销售单认领或归属公司。
 * 采购行数量在归属变化后不会自动减少，必须按条目扣减，否则原单会继续被已离开的货件覆盖。
 * 只处理明确转出的归属，已取消但未转出的货件保持既有口径。
 */
export async function readUnownedQuantitiesBySalesLine(
  transaction: PrismaTypes.TransactionClient,
  salesOrderId: string,
  salesLineIds: readonly string[],
): Promise<Map<string, number>> {
  if (salesLineIds.length === 0) return new Map()
  const rows = await transaction.purchaseOrderPartItem.findMany({
    where: {
      line: { sourceSalesOrderLineId: { in: [...salesLineIds] } },
      part: {
        ownershipCurrent: {
          OR: [
            { ownerType: 'STORAGE_POOL' },
            { ownerType: 'COMPANY' },
            { ownerSalesOrderId: { not: salesOrderId }, ownerType: 'SALES_ORDER' },
          ],
        },
      },
    },
    select: {
      quantity: true,
      line: { select: { sourceSalesOrderLineId: true } },
    },
  })
  const quantities = new Map<string, number>()
  for (const row of rows) {
    const salesLineId = row.line.sourceSalesOrderLineId
    if (salesLineId === null) continue
    quantities.set(salesLineId, (quantities.get(salesLineId) ?? 0) + row.quantity)
  }
  return quantities
}

/** 已审核采购数量扣掉转出数量，剩余部分才属于本单的覆盖。 */
export function subtractUnownedCoverage(
  purchasedBySource: ReadonlyMap<string, number>,
  unownedBySalesLine: ReadonlyMap<string, number>,
): Map<string, number> {
  const remaining = new Map(purchasedBySource)
  for (const [salesLineId, quantity] of unownedBySalesLine) {
    remaining.set(salesLineId, Math.max(0, (remaining.get(salesLineId) ?? 0) - quantity))
  }
  return remaining
}

/** 同一销售明细可能既有已审核采购又有认领货件，覆盖必须合并后判断。 */
export function mergeClaimedCoverage(
  purchasedBySource: ReadonlyMap<string, number>,
  claimedBySalesLine: ReadonlyMap<string, number>,
): Map<string, number> {
  const merged = new Map(purchasedBySource)
  for (const [salesLineId, quantity] of claimedBySalesLine) {
    merged.set(salesLineId, (merged.get(salesLineId) ?? 0) + quantity)
  }
  return merged
}
