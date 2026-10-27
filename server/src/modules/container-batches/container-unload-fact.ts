import { Prisma } from '../../generated/prisma/client'
import { AuditService } from '../audit/audit.service'

/** 撤销装柜事实的来源：解绑最后一条装柜明细，或一次性清理历史孤立事实。 */
export type ContainerUnloadSource = 'ITEM_UPDATE' | 'ORPHAN_CLEANUP'

export interface ContainerUnloadedFact {
  readonly id: string
  readonly previousLoadedAt: Date
  readonly previousLoadedById: string
}

/**
 * 解绑即撤销：只有确认货件已无任何装柜明细、且尚未签收时才允许清空装柜事实。
 * 数据库触发器对同样的条件做纵深防御；已签收货件由签收 CHECK 与触发器共同拒绝。
 * 返回实际撤销的行，调用方按行记审计，重复解绑保持幂等。
 */
export async function clearShipmentsContainerLoaded(
  tx: Prisma.TransactionClient,
  audit: AuditService,
  input: {
    actorUserId: string
    requestId: string
    containerBatchId: string | null
    loadingItemId: string | null
    shipmentIds: readonly string[]
    source: ContainerUnloadSource
  },
): Promise<number> {
  const ids = [...new Set(input.shipmentIds)].sort()
  if (!ids.length) return 0
  // CTE 先锁定目标行并保留撤销前的事实，再一次性清空；同一语句保证审计值就是被清掉的值。
  const rows = await tx.$queryRaw<ContainerUnloadedFact[]>(Prisma.sql`
    WITH target AS (
      SELECT id, loaded_at, loaded_by_id FROM purchase_order_parts
       WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
         AND loaded_at IS NOT NULL AND delivered_at IS NULL
       FOR UPDATE
    )
    UPDATE purchase_order_parts part
       SET loaded_at = NULL, loaded_by_id = NULL, loaded_recorded_at = NULL
      FROM target
     WHERE part.id = target.id
    RETURNING part.id, target.loaded_at AS "previousLoadedAt", target.loaded_by_id AS "previousLoadedById"`)
  for (const row of rows) {
    await audit.record(tx, {
      eventType: 'PURCHASE_SHIPMENT_CONTAINER_UNLOADED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: input.actorUserId,
      requestId: input.requestId, targetType: 'PURCHASE_ORDER_PART', targetId: row.id,
      metadata: {
        containerBatchId: input.containerBatchId,
        loadingItemId: input.loadingItemId,
        previousLoadedAt: row.previousLoadedAt.toISOString(),
        previousLoadedById: row.previousLoadedById,
        source: input.source,
      },
    })
  }
  return rows.length
}
