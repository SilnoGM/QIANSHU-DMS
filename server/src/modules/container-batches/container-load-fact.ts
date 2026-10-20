import { Prisma } from '../../generated/prisma/client'
import { AuditService } from '../audit/audit.service'

/** 装柜事实的写入来源：单条新增、单条编辑、Excel 导入与一次性历史回填。 */
export type ContainerLoadSource = 'ITEM_CREATE' | 'ITEM_UPDATE' | 'IMPORT' | 'BACKFILL'

/**
 * 关联即已装柜：在装柜明细的同一事务内、持有货件行锁之后写入一次装柜事实。
 * `loaded_at IS NULL` 保证幂等，已装柜货件不覆盖时间与操作人，也永不回退；
 * 数据库触发器只放行这一次写入，而任何未标记货件的关联都会被同层触发器拒绝。
 */
export async function markShipmentsContainerLoaded(
  tx: Prisma.TransactionClient,
  audit: AuditService,
  input: {
    actorUserId: string
    requestId: string
    containerBatchId: string
    shipmentIds: readonly string[]
    source: ContainerLoadSource
    loadingItemId?: string | null
  },
): Promise<number> {
  const ids = [...new Set(input.shipmentIds)].sort()
  if (!ids.length) return 0
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE purchase_order_parts
       SET loaded_at = clock_timestamp(), loaded_by_id = ${input.actorUserId}::uuid, loaded_recorded_at = clock_timestamp()
     WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) AND loaded_at IS NULL
    RETURNING id`)
  for (const row of rows) {
    await audit.record(tx, {
      eventType: 'PURCHASE_SHIPMENT_CONTAINER_LOADED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: input.actorUserId,
      requestId: input.requestId, targetType: 'PURCHASE_ORDER_PART', targetId: row.id,
      metadata: { containerBatchId: input.containerBatchId, loadingItemId: input.loadingItemId ?? null, source: input.source },
    })
  }
  return rows.length
}
