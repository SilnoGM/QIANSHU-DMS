import { Prisma, type Prisma as PrismaTypes } from '../../generated/prisma/client'
import type {
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from '../../generated/prisma/enums'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import type { AuditService } from '../audit/audit.service'
import { assertSalesOrderFulfillmentTransition } from './domain/sales-order-state-machine'
import { readSalesOrderShipmentFacts } from './sales-order-owned-shipments'

/** 履约状态只能逐级前进；认领一次性跨越多级时按顺序补写历史。 */
const FULFILLMENT_ORDER: readonly SalesOrderFulfillmentStatus[] = [
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
  'SEA_TRANSIT',
  'SIGNED',
]

export interface AdvanceSalesOrderAfterClaimInput {
  readonly actorUserId: string
  readonly requestId: string
  readonly salesOrderId: string
  readonly shipmentId: string
  readonly storageRecordId: string
}

export type ClaimProgressOutcome =
  | 'ADVANCED'
  | 'NOT_COVERED'
  | 'ALREADY_AHEAD'
  | 'ORDER_STATE_CHANGED'

interface LockedClaimOrder {
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  readonly orderStatus: SalesOrderStatus
}

/**
 * 认领的是已经发货、已经到仓（可能已经装柜）的既有货件，
 * 新销售单的履约阶段应直接对齐这些事实，而不是停在待采购等待采购事件。
 * 只向前推进到事实允许的最高阶段；已有更靠后的状态绝不回退。
 */
export async function advanceSalesOrderAfterClaim(
  transaction: PrismaTypes.TransactionClient,
  audit: AuditService,
  input: AdvanceSalesOrderAfterClaimInput,
): Promise<ClaimProgressOutcome> {
  const locked = await transaction.$queryRaw<LockedClaimOrder[]>(Prisma.sql`
    SELECT
      "order_status" AS "orderStatus",
      "fulfillment_status" AS "fulfillmentStatus"
    FROM "sales_orders"
    WHERE "id" = CAST(${input.salesOrderId} AS uuid)
    FOR UPDATE
  `)
  const order = locked[0]
  if (locked.length !== 1 || order === undefined) return 'ORDER_STATE_CHANGED'
  if (order.orderStatus !== 'CONFIRMED') return 'ORDER_STATE_CHANGED'

  const facts = await readSalesOrderShipmentFacts(transaction, input.salesOrderId)
  if (!facts.covered) return 'NOT_COVERED'

  const target: SalesOrderFulfillmentStatus = facts.allLoaded
    ? 'SEA_TRANSIT'
    : facts.allReceived
      ? 'WAREHOUSE_ARRIVED'
      : facts.allShipped
        ? 'LAND_TRANSIT'
        : 'PREPARING'
  const currentIndex = FULFILLMENT_ORDER.indexOf(order.fulfillmentStatus)
  const targetIndex = FULFILLMENT_ORDER.indexOf(target)
  if (currentIndex < 0 || targetIndex <= currentIndex) return 'ALREADY_AHEAD'

  const hops = FULFILLMENT_ORDER.slice(currentIndex + 1, targetIndex + 1)
  let from = order.fulfillmentStatus
  for (const to of hops) {
    assertSalesOrderFulfillmentTransition(from, to, {
      hasActiveDeliveryReceipt: false,
    })
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId: input.salesOrderId,
      dimension: 'FULFILLMENT',
      fromStatus: from,
      toStatus: to,
      reason: '认领寄仓货件后按货件事实推进',
      changedByUserId: input.actorUserId,
    } })
    from = to
  }
  await transaction.salesOrder.update({
    where: { id: input.salesOrderId },
    data: { fulfillmentStatus: target, version: { increment: 1 } },
  })
  await audit.record(transaction, {
    eventType: AuditEventType.SALES_ORDER_FULFILLMENT_STATUS_CHANGED,
    outcome: AuditOutcome.SUCCESS,
    actorType: AuditActorType.USER,
    actorUserId: input.actorUserId,
    targetType: 'SALES_ORDER',
    targetId: input.salesOrderId,
    requestId: input.requestId,
    metadata: {
      automatic: true,
      fromStatus: order.fulfillmentStatus,
      shipmentId: input.shipmentId,
      steps: hops.length,
      storageRecordId: input.storageRecordId,
      toStatus: target,
      trigger: 'SHIPMENT_CLAIM',
    },
  })
  return 'ADVANCED'
}
