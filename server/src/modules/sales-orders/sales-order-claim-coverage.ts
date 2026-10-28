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
