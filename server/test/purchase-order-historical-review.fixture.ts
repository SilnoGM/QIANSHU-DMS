import { randomUUID } from 'node:crypto'
import { normalizePurchaseOrderCreateCommand } from '../src/modules/purchase-orders/purchase-order-command.normalizer'
import { calculatePurchaseOrderCreateFingerprint, hashPurchaseOrderIdempotencyKey, PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION } from '../src/modules/purchase-orders/purchase-order-create-fingerprint'
import { PurchaseShipmentNumberingService } from '../src/modules/purchase-orders/shipments/purchase-shipment-numbering.service'
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

/** 迁移测试准备当时真实的 v5 创建事实；不让最新 Command 写尚不存在的收款资料表。 */
export async function createHistoricalCustomPurchase(fixture: AtomicityFixture): Promise<string> {
  const context = fixture.context()
  const resolution = await fixture.resolver.read({ productMode: 'CUSTOM' })
  const partKey = randomUUID()
  const input = { purchaseType: 'STOCK', productMode: 'CUSTOM', customSupplierName: 'Custom supplier',
    orderDate: '2026-09-07', expectedShippingMarkResolution: resolution.resolutionToken,
    lines: [{ lineType: 'CUSTOM', name: 'Custom item', referencePurchaseUnitPriceAmount: '10', actualPurchaseUnitPriceAmount: '10', quantity: 1 }],
    parts: [{ key: partKey, items: [{ lineNumber: 1, quantity: 1 }] }], purchaseTotalAmount: '10', depositDueAmount: '0', balanceDueAmount: '10' }
  const command = normalizePurchaseOrderCreateCommand(input, '2026-09-07', false, true)
  const fingerprint = calculatePurchaseOrderCreateFingerprint(context.actorUserId, command, PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION)
  const keyHash = hashPurchaseOrderIdempotencyKey(context.idempotencyKey)
  return fixture.prisma.$transaction(async tx => {
    await requireHistoricalSchema(tx)
    const id = randomUUID(), partId = randomUUID()
    await tx.$executeRaw`INSERT INTO purchase_orders (
      id, order_no, create_idempotency_key_hash, create_request_fingerprint_hash, create_request_fingerprint_version,
      purchase_type, product_mode, custom_supplier_name, order_date, currency_code, line_subtotal_amount,
      purchase_total_amount, deposit_due_amount, balance_due_amount, created_by_user_id
    ) VALUES (${id}::uuid, ${`LEGACY-${id}`}, ${keyHash}, ${Buffer.from(fingerprint, 'hex')}, 'purchase-order.create.v5',
      'STOCK', 'CUSTOM', 'Custom supplier', ${new Date('2026-09-07')}, 'CNY', 10, 10, 0, 10, ${fixture.actor.id}::uuid)`
    const line = await tx.purchaseOrderLine.create({ data: {
      purchaseOrderId: id, lineNumber: 1, lineType: 'CUSTOM', productNameSnapshot: 'Custom item', productAttributesSnapshot: [],
      referencePurchaseUnitPriceAmount: '10', actualPurchaseUnitPriceAmount: '10', quantity: 1, lineTotalAmount: '10',
    } })
    const [columns] = await tx.$queryRaw<{ numbered: boolean }[]>`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'purchase_order_parts' AND column_name = 'shipment_no') AS numbered`
    if (columns.numbered) {
      const [number] = await new PurchaseShipmentNumberingService(fixture.numbering).issue(tx, [{ id: partId, purchaseOrderId: id, key: partKey }])
      await tx.$executeRaw`INSERT INTO purchase_order_parts (id, purchase_order_id, key, part_number, shipment_no, numbering_issuance_id)
        VALUES (${partId}::uuid, ${id}::uuid, ${partKey}::uuid, 1, ${number.shipmentNo}, ${number.numberingIssuanceId}::uuid)`
    }
    else {
      await tx.$executeRaw`INSERT INTO purchase_order_parts (id, purchase_order_id, key, part_number)
        VALUES (${partId}::uuid, ${id}::uuid, ${partKey}::uuid, 1)`
    }
    await tx.purchaseOrderPartItem.create({ data: { purchaseOrderId: id, purchaseOrderPartId: partId, purchaseOrderLineId: line.id, quantity: 1 } })
    return id
  })
}
