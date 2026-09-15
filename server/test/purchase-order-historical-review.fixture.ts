import { Prisma } from '../src/generated/prisma/client'
import type { AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

/** 只重放旧 schema 的历史命令，不允许在新图片约束生效后绕过审核前置证据。 */
async function requireHistoricalSchema(transaction: Prisma.TransactionClient): Promise<void> {
  const rows = await transaction.$queryRaw<{ current: boolean }[]>(Prisma.sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'purchase_order_image_drafts') AS current
  `)
  if (rows[0]?.current !== false) throw new Error('Historical fixture cannot operate on the current purchase schema')
}

/** v3/v4 复用已派号事实，v5 按当时规则在审核事务中派发基础唛头；所有旧守卫保持启用。 */
export async function reviewHistoricalPurchase(fixture: AtomicityFixture, purchaseOrderId: string): Promise<void> {
  await fixture.prisma.$transaction(async transaction => {
    await requireHistoricalSchema(transaction)
    const [order] = await transaction.$queryRaw<{
      version: string | null, mark: string | null, fingerprint: Uint8Array,
    }[]>(Prisma.sql`SELECT to_jsonb(orders)->>'create_request_fingerprint_version' AS version,
      shipping_mark_text AS mark, create_request_fingerprint_hash AS fingerprint
      FROM purchase_orders orders WHERE id = ${purchaseOrderId}::uuid AND order_status = 'PENDING_REVIEW' FOR UPDATE`)
    if (!order) throw new Error('Historical purchase is not pending review')
    if (order.version === 'purchase-order.create.v5' && order.mark === null) {
      const mark = await fixture.numbering.generateScopedInTransaction(transaction, {
        ruleCode: 'CUSTOM_MARK', consumerCode: 'PURCHASE_ORDER.REVIEW_SHIPPING_MARK',
        idempotencyKey: purchaseOrderId, requestFingerprint: Buffer.from(order.fingerprint).toString('hex'),
      })
      await transaction.$executeRaw(Prisma.sql`UPDATE purchase_orders SET order_status = 'CONFIRMED',
        fulfillment_status = 'PREPARING', shipping_mark_text = ${mark.number},
        shipping_mark_issuance_id = ${mark.issuanceId}::uuid, version = version + 1 WHERE id = ${purchaseOrderId}::uuid`)
      await transaction.$executeRaw(Prisma.sql`UPDATE purchase_order_parts SET shipping_mark_text = CASE
        WHEN (SELECT count(*) FROM purchase_order_parts WHERE purchase_order_id = ${purchaseOrderId}::uuid) = 1 THEN ${mark.number}
        ELSE ${mark.number} || '/货件-' || lpad(part_number::text, greatest(2, length(part_number::text)), '0') END
        WHERE purchase_order_id = ${purchaseOrderId}::uuid`)
    }
    else {
      await transaction.$executeRaw(Prisma.sql`UPDATE purchase_orders SET order_status = 'CONFIRMED',
        fulfillment_status = 'PREPARING', version = version + 1 WHERE id = ${purchaseOrderId}::uuid`)
    }
    const [columns] = await transaction.$queryRaw<{ status: boolean }[]>(Prisma.sql`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
        AND table_name = 'purchase_order_parts' AND column_name = 'status') AS status
    `)
    if (columns?.status) await transaction.$executeRaw(Prisma.sql`
      UPDATE purchase_order_parts SET status = 'ACTIVE' WHERE purchase_order_id = ${purchaseOrderId}::uuid AND status = 'PENDING_REVIEW'
    `)
    await transaction.purchaseOrderStatusHistory.createMany({ data: [
      { purchaseOrderId, dimension: 'ORDER', fromStatus: 'PENDING_REVIEW', toStatus: 'CONFIRMED', changedByUserId: fixture.actor.id, reason: 'Historical reviewed purchase' },
      { purchaseOrderId, dimension: 'FULFILLMENT', fromStatus: 'ORDERED', toStatus: 'PREPARING', changedByUserId: fixture.actor.id, reason: 'Historical reviewed purchase' },
    ] })
  })
}

/** 迁移前真实存在的发货列；不使用新 Prisma 全字段读取，也不虚构迁移后的入仓信息。 */
export async function shipHistoricalPurchase(fixture: AtomicityFixture, purchaseOrderId: string): Promise<void> {
  await fixture.prisma.$transaction(async transaction => {
    await requireHistoricalSchema(transaction)
    await transaction.$executeRaw(Prisma.sql`UPDATE purchase_order_parts
      SET shipped_at = clock_timestamp(), shipped_by_id = ${fixture.actor.id}::uuid,
        shipment_recorded_at = clock_timestamp(), shipment_remark = 'Preserved actual shipment'
      WHERE purchase_order_id = ${purchaseOrderId}::uuid`)
    await transaction.$executeRaw(Prisma.sql`UPDATE purchase_orders SET fulfillment_status = 'SHIPPED', version = version + 1 WHERE id = ${purchaseOrderId}::uuid`)
    await transaction.purchaseOrderStatusHistory.create({ data: {
      purchaseOrderId, dimension: 'FULFILLMENT', fromStatus: 'PREPARING', toStatus: 'SHIPPED',
      changedByUserId: fixture.actor.id, reason: 'Preserved actual shipment',
    } })
  })
}
