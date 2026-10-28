import { Prisma } from '../../../generated/prisma/client'
import { AuditService } from '../../audit/audit.service'
import { assertSalesOrderFulfillmentTransition } from '../../sales-orders/domain/sales-order-state-machine'
import {
  mergeClaimedCoverage,
  readClaimedQuantitiesBySalesLine,
} from '../../sales-orders/sales-order-claim-coverage'
import { readSalesOrderShipmentParts } from '../../sales-orders/sales-order-owned-shipments'
import { isSalesOrderPurchaseFullyCovered } from '../sales-order-purchase-coverage.service'

/**
 * 关联即已装柜：货件装柜事实写入后，汇总推进其销售订单。
 * 只有当该销售订单的全部有效货件都已装柜、且入仓数量仍覆盖全部销售明细时才推进到海运在途；
 * 未推进的订单会随每次装柜重新评估（幂等，且历史数据可在下次装柜时补齐）。
 *
 * 解绑最后一条明细会撤销装柜事实，此时按同一口径回退：不再满足全部装柜就退回已到仓。
 * 已签收的货件或有效签收单说明物理流程已经越过待装柜，这类订单保持海运在途。
 */

/** 本次装柜涉及的销售订单：只取销售关联采购下的货件，去重排序保证加锁顺序稳定。 */
export async function salesOrderIdsOfShipments(
  transaction: Prisma.TransactionClient,
  shipmentIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(shipmentIds)].sort()
  if (!ids.length) return []
  const rows = await transaction.purchaseOrderPart.findMany({
    where: { id: { in: ids } },
    select: { ownershipCurrent: { select: { ownerSalesOrderId: true } } },
  })
  const ownerSalesOrderIds = rows
    .map(row => row.ownershipCurrent?.ownerSalesOrderId)
    .filter((id): id is string => typeof id === 'string')
  return [...new Set(ownerSalesOrderIds)].sort()
}

/**
 * 与入仓推进共用同一把锁序：销售明细 → 同来源有效采购单 → 销售主行，多个销售订单按 id 升序逐个加锁。
 * 必须在锁货件之前调用，避免与发货、入仓形成反向申请。
 */
export async function lockSalesOrderChains(transaction: Prisma.TransactionClient, salesOrderIds: readonly string[]): Promise<void> {
  for (const salesOrderId of [...new Set(salesOrderIds)].sort()) {
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM sales_order_lines WHERE sales_order_id = ${salesOrderId}::uuid AND removed_at IS NULL ORDER BY id FOR UPDATE`)
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_orders WHERE sales_order_id = ${salesOrderId}::uuid AND purchase_type = 'SALES_LINKED' AND order_status <> 'CANCELLED' ORDER BY id FOR UPDATE`)
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM sales_orders WHERE id = ${salesOrderId}::uuid FOR UPDATE`)
  }
}

export interface AdvanceSalesOrdersWhenLoadedInput {
  readonly actorUserId: string
  readonly containerBatchId: string
  readonly requestId: string
  readonly salesOrderIds: readonly string[]
}

interface SalesOrderLoadState {
  readonly allLoaded: boolean
  readonly covered: boolean
}

/**
 * 推进与回退共用的装柜聚合口径：货件集合按当前归属读取，待审核与未入仓都算未装柜。
 * 已释放货件归属转池后不再推进原订单；认领货件按目标单的认领数量计入覆盖。
 */
async function readSalesOrderLoadState(
  transaction: Prisma.TransactionClient,
  salesOrderId: string,
): Promise<SalesOrderLoadState> {
  const salesLines = await transaction.salesOrderLine.findMany({
    where: { salesOrderId, removedAt: null },
    select: { id: true, quantity: true },
  })
  const parts = await readSalesOrderShipmentParts(transaction, salesOrderId)
  if (parts.length === 0 || salesLines.length === 0) return { allLoaded: false, covered: false }

  let allLoaded = true
  const receivedBySource = new Map<string, number>()
  for (const part of parts) {
    if (part.status !== 'ACTIVE') { allLoaded = false; break }
    // 装柜以到仓为前提，两侧事实都要求，历史回填数据也不会被误判。
    if (part.loadedAt === null || part.warehouseReceivedAt === null) { allLoaded = false; break }
    for (const item of part.items) {
      const sourceId = item.line.sourceSalesOrderLineId
      if (sourceId !== null) receivedBySource.set(sourceId, (receivedBySource.get(sourceId) ?? 0) + item.quantity)
    }
  }
  if (!allLoaded) return { allLoaded: false, covered: false }
  const claimedBySalesLine = await readClaimedQuantitiesBySalesLine(
    transaction,
    salesOrderId,
    salesLines.map(line => line.id),
  )
  // 装柜后销售明细可能被追加或改量，覆盖判断必须按持锁后的现状重新计算。
  return {
    allLoaded: true,
    covered: isSalesOrderPurchaseFullyCovered(
      salesLines,
      mergeClaimedCoverage(receivedBySource, claimedBySalesLine),
    ),
  }
}

/** 调用方须已按上锁序持有销售链条锁；判定与写入都基于持锁后重读的数据。 */
export async function advanceSalesOrdersWhenAllShipmentsLoaded(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  input: AdvanceSalesOrdersWhenLoadedInput,
): Promise<void> {
  for (const salesOrderId of [...new Set(input.salesOrderIds)].sort()) {
    const order = await transaction.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: { orderStatus: true, fulfillmentStatus: true },
    })
    if (order?.orderStatus !== 'CONFIRMED' || order.fulfillmentStatus !== 'WAREHOUSE_ARRIVED') continue

    const state = await readSalesOrderLoadState(transaction, salesOrderId)
    if (!state.allLoaded || !state.covered) continue

    assertSalesOrderFulfillmentTransition('WAREHOUSE_ARRIVED', 'SEA_TRANSIT', { hasActiveDeliveryReceipt: false })
    await transaction.salesOrder.update({
      where: { id: salesOrderId },
      data: { fulfillmentStatus: 'SEA_TRANSIT', version: { increment: 1 } },
    })
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId,
      dimension: 'FULFILLMENT',
      fromStatus: 'WAREHOUSE_ARRIVED',
      toStatus: 'SEA_TRANSIT',
      reason: '全部有效关联采购货件已装柜，且入仓数量覆盖全部销售明细',
      changedByUserId: input.actorUserId,
    } })
    await audit.record(transaction, {
      eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED', outcome: 'SUCCESS',
      actorType: 'USER', actorUserId: input.actorUserId, requestId: input.requestId,
      targetType: 'SALES_ORDER', targetId: salesOrderId,
      metadata: {
        automatic: true, fromStatus: 'WAREHOUSE_ARRIVED', toStatus: 'SEA_TRANSIT',
        trigger: 'CONTAINER_LOAD', containerBatchId: input.containerBatchId,
      },
    })
  }
}

export interface RetreatSalesOrdersWhenUnloadedInput {
  readonly actorUserId: string
  readonly containerBatchId: string | null
  readonly requestId: string
  readonly shipmentId: string
  readonly salesOrderIds: readonly string[]
}

/** 已有客户签收事实时说明物理流程已越过待装柜，不再回退订单。 */
async function hasDeliveredShipment(transaction: Prisma.TransactionClient, salesOrderId: string): Promise<boolean> {
  const count = await transaction.purchaseOrderPart.count({ where: {
    status: 'ACTIVE',
    deliveredAt: { not: null },
    ownershipCurrent: {
      ownerType: 'SALES_ORDER',
      ownerSalesOrderId: salesOrderId,
      state: 'ACTIVE',
    },
  } })
  return count > 0
}

/** 已上传有效签收单同样视为已经越过待装柜，避免回退后与订单签收条件冲突。 */
async function hasActiveDeliveryReceipt(transaction: Prisma.TransactionClient, salesOrderId: string): Promise<boolean> {
  const count = await transaction.salesOrderDocument.count({
    where: { salesOrderId, documentType: 'DELIVERY_RECEIPT', detachedAt: null },
  })
  return count > 0
}

/**
 * 撤销装柜事实后的受控回退：订单仍在海运在途、但已不再满足「全部货件已装柜且数量覆盖」时，
 * 退回已到仓并留状态历史与审计；重新装柜会再次推进。没有签收事实时不保留无法自愈的漂移状态。
 */
export async function retreatSalesOrdersWhenShipmentsUnloaded(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  input: RetreatSalesOrdersWhenUnloadedInput,
): Promise<void> {
  for (const salesOrderId of [...new Set(input.salesOrderIds)].sort()) {
    const order = await transaction.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: { orderStatus: true, fulfillmentStatus: true },
    })
    if (order?.orderStatus !== 'CONFIRMED' || order.fulfillmentStatus !== 'SEA_TRANSIT') continue

    const state = await readSalesOrderLoadState(transaction, salesOrderId)
    if (state.allLoaded && state.covered) continue
    if (await hasDeliveredShipment(transaction, salesOrderId)) continue
    if (await hasActiveDeliveryReceipt(transaction, salesOrderId)) continue

    await transaction.salesOrder.update({
      where: { id: salesOrderId },
      data: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: { increment: 1 } },
    })
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId,
      dimension: 'FULFILLMENT',
      fromStatus: 'SEA_TRANSIT',
      toStatus: 'WAREHOUSE_ARRIVED',
      reason: '货件解除装柜关联，不再满足全部货件已装柜',
      changedByUserId: input.actorUserId,
    } })
    await audit.record(transaction, {
      eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED', outcome: 'SUCCESS',
      actorType: 'USER', actorUserId: input.actorUserId, requestId: input.requestId,
      targetType: 'SALES_ORDER', targetId: salesOrderId,
      metadata: {
        automatic: true, fromStatus: 'SEA_TRANSIT', toStatus: 'WAREHOUSE_ARRIVED',
        trigger: 'CONTAINER_UNLOAD', containerBatchId: input.containerBatchId, shipmentId: input.shipmentId,
      },
    })
  }
}
