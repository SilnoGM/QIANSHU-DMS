import { HttpStatus, Injectable } from '@nestjs/common'

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
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  assertSalesOrderFulfillmentTransition,
} from '../sales-orders/domain/sales-order-state-machine'

interface SalesLineQuantity {
  readonly id: string
  readonly quantity: number
}

interface LockedSalesOrder {
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  readonly id: string
  readonly orderStatus: SalesOrderStatus
}

export interface AdvanceSalesOrderPurchaseProgressInput {
  readonly actorUserId: string
  readonly purchaseOrderId: string
  readonly purchaseOrderNo: string
  readonly requestId: string
  readonly salesOrderId: string
}

export interface AdvanceSalesOrderFactoryShipmentInput {
  readonly actorUserId: string
  readonly changedPurchaseOrderCount: number
  readonly requestId: string
  readonly salesOrderId: string
}

export interface SalesOrderFactoryShipmentProgress {
  readonly advancedToLandTransit: boolean
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
}

const CANCELLATION_RECALCULABLE_STATUSES
  = new Set<SalesOrderFulfillmentStatus>([
    'PENDING',
    'PREPARING',
    'LAND_TRANSIT',
    'WAREHOUSE_ARRIVED',
  ])

/**
 * 覆盖判断必须以销售明细 ID 为粒度。相同产品可以出现在多条销售明细中，
 * CUSTOM 也没有 productId，因此不能按产品字段合并。
 */
export function isSalesOrderPurchaseFullyCovered(
  salesLines: readonly SalesLineQuantity[],
  purchasedBySource: ReadonlyMap<string, number>,
): boolean {
  return salesLines.length > 0 && salesLines.every(line => (
    (purchasedBySource.get(line.id) ?? 0) >= line.quantity
  ))
}

function stateChangedError(): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'PURCHASE_ORDER_STATE_CHANGED',
    '采购订单依赖状态已变化，请重试',
  )
}

@Injectable()
export class SalesOrderPurchaseCoverageService {
  constructor(private readonly audit: AuditService) {}

  async advanceWhenFullyCovered(
    transaction: PrismaTypes.TransactionClient,
    input: AdvanceSalesOrderPurchaseProgressInput,
  ): Promise<void> {
    // 本次采购可能只锁定部分销售明细。额外锁定销售订单主行，才能让同一销售
    // 订单下、采购不同明细的并发创建也按统一顺序完成最终覆盖判定。
    const locked = await transaction.$queryRaw<LockedSalesOrder[]>(Prisma.sql`
      SELECT
        "id",
        "order_status" AS "orderStatus",
        "fulfillment_status" AS "fulfillmentStatus"
      FROM "sales_orders"
      WHERE "id" = CAST(${input.salesOrderId} AS uuid)
      FOR UPDATE
    `)
    const order = locked[0]
    if (locked.length !== 1 || order?.orderStatus !== 'CONFIRMED') {
      throw stateChangedError()
    }
    // 已经进入备货或后续物流阶段时只保留现状，不允许覆盖、倒退或跳级。
    if (order.fulfillmentStatus !== 'PENDING') return

    const salesLines = await transaction.salesOrderLine.findMany({
      where: { salesOrderId: input.salesOrderId, removedAt: null },
      select: { id: true, quantity: true },
    })
    if (salesLines.length === 0) return

    const purchasedRows = await transaction.purchaseOrderLine.groupBy({
      by: ['sourceSalesOrderLineId'],
      where: {
        sourceSalesOrderLineId: { in: salesLines.map(line => line.id) },
        purchaseOrder: {
          salesOrderId: input.salesOrderId,
          purchaseType: 'SALES_LINKED',
          orderStatus: { not: 'CANCELLED' },
        },
      },
      _sum: { quantity: true },
    })
    const purchasedBySource = new Map<string, number>()
    for (const row of purchasedRows) {
      if (row.sourceSalesOrderLineId !== null) {
        purchasedBySource.set(
          row.sourceSalesOrderLineId,
          row._sum.quantity ?? 0,
        )
      }
    }
    if (!isSalesOrderPurchaseFullyCovered(salesLines, purchasedBySource)) return

    assertSalesOrderFulfillmentTransition('PENDING', 'PREPARING', {
      hasActiveDeliveryReceipt: false,
    })
    await transaction.salesOrder.update({
      where: { id: input.salesOrderId },
      data: {
        fulfillmentStatus: 'PREPARING',
        version: { increment: 1 },
      },
    })
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId: input.salesOrderId,
      dimension: 'FULFILLMENT',
      fromStatus: 'PENDING',
      toStatus: 'PREPARING',
      reason: '采购订单提交后已覆盖全部销售产品',
      changedByUserId: input.actorUserId,
    } })
    await this.audit.record(transaction, {
      eventType: AuditEventType.SALES_ORDER_FULFILLMENT_STATUS_CHANGED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: input.actorUserId,
      targetType: 'SALES_ORDER',
      targetId: input.salesOrderId,
      requestId: input.requestId,
      metadata: {
        automatic: true,
        fromStatus: 'PENDING',
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderNo: input.purchaseOrderNo,
        toStatus: 'PREPARING',
        trigger: 'PURCHASE_COVERAGE',
      },
    })
  }

  async recalculateAfterPurchaseCancellation(
    transaction: PrismaTypes.TransactionClient,
    input: AdvanceSalesOrderPurchaseProgressInput,
  ): Promise<void> {
    const locked = await transaction.$queryRaw<LockedSalesOrder[]>(Prisma.sql`
      SELECT
        "id",
        "order_status" AS "orderStatus",
        "fulfillment_status" AS "fulfillmentStatus"
      FROM "sales_orders"
      WHERE "id" = CAST(${input.salesOrderId} AS uuid)
      FOR UPDATE
    `)
    const order = locked[0]
    // 销售订单终态、待对账态，以及海运或签收阶段都不能被采购取消倒退。
    if (
      locked.length !== 1
      || order?.orderStatus !== 'CONFIRMED'
      || !CANCELLATION_RECALCULABLE_STATUSES.has(order.fulfillmentStatus)
    ) {
      return
    }

    const salesLines = await transaction.salesOrderLine.findMany({
      where: { salesOrderId: input.salesOrderId, removedAt: null },
      select: { id: true, quantity: true },
    })
    const purchasedRows = await transaction.purchaseOrderLine.groupBy({
      by: ['sourceSalesOrderLineId'],
      where: {
        sourceSalesOrderLineId: { in: salesLines.map(line => line.id) },
        purchaseOrder: {
          salesOrderId: input.salesOrderId,
          purchaseType: 'SALES_LINKED',
          orderStatus: { not: 'CANCELLED' },
        },
      },
      _sum: { quantity: true },
    })
    const purchasedBySource = new Map<string, number>()
    for (const row of purchasedRows) {
      if (row.sourceSalesOrderLineId !== null) {
        purchasedBySource.set(
          row.sourceSalesOrderLineId,
          row._sum.quantity ?? 0,
        )
      }
    }
    const fullyCovered = isSalesOrderPurchaseFullyCovered(
      salesLines,
      purchasedBySource,
    )
    const toStatus: SalesOrderFulfillmentStatus = fullyCovered
      ? (order.fulfillmentStatus === 'PENDING' ? 'PREPARING' : order.fulfillmentStatus)
      : 'PENDING'
    if (toStatus === order.fulfillmentStatus) return

    await transaction.salesOrder.update({
      where: { id: input.salesOrderId },
      data: { fulfillmentStatus: toStatus, version: { increment: 1 } },
    })
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId: input.salesOrderId,
      dimension: 'FULFILLMENT',
      fromStatus: order.fulfillmentStatus,
      toStatus,
      reason: '取消采购订单后重新计算销售产品采购覆盖',
      changedByUserId: input.actorUserId,
    } })
    await this.audit.record(transaction, {
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
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderNo: input.purchaseOrderNo,
        toStatus,
        trigger: 'PURCHASE_CANCELLATION',
      },
    })
  }

  /**
   * 工厂发货只把事实写入采购单；销售履约状态必须在同一事务内由完整采购集合
   * 派生。调用方已经按统一顺序锁定销售明细和采购订单，此处再次锁定销售主行
   * 是为了让本服务单独调用时也保持失败关闭。
   */
  async advanceWhenAllPurchasesShipped(
    transaction: PrismaTypes.TransactionClient,
    input: AdvanceSalesOrderFactoryShipmentInput,
  ): Promise<SalesOrderFactoryShipmentProgress> {
    const locked = await transaction.$queryRaw<LockedSalesOrder[]>(Prisma.sql`
      SELECT
        "id",
        "order_status" AS "orderStatus",
        "fulfillment_status" AS "fulfillmentStatus"
      FROM "sales_orders"
      WHERE "id" = CAST(${input.salesOrderId} AS uuid)
      FOR UPDATE
    `)
    const order = locked[0]
    if (order === undefined) throw stateChangedError()
    if (
      order.orderStatus !== 'CONFIRMED'
      || order.fulfillmentStatus !== 'PREPARING'
    ) {
      return {
        advancedToLandTransit: false,
        fulfillmentStatus: order.fulfillmentStatus,
      }
    }

    const salesLines = await transaction.salesOrderLine.findMany({
      where: { salesOrderId: input.salesOrderId, removedAt: null },
      select: { id: true, quantity: true },
    })
    const purchasedRows = await transaction.purchaseOrderLine.groupBy({
      by: ['sourceSalesOrderLineId'],
      where: {
        sourceSalesOrderLineId: { in: salesLines.map(line => line.id) },
        purchaseOrder: {
          salesOrderId: input.salesOrderId,
          purchaseType: 'SALES_LINKED',
          orderStatus: { not: 'CANCELLED' },
        },
      },
      _sum: { quantity: true },
    })
    const purchasedBySource = new Map<string, number>()
    for (const row of purchasedRows) {
      if (row.sourceSalesOrderLineId !== null) {
        purchasedBySource.set(
          row.sourceSalesOrderLineId,
          row._sum.quantity ?? 0,
        )
      }
    }
    const activePurchaseOrders = await transaction.purchaseOrder.findMany({
      where: {
        salesOrderId: input.salesOrderId,
        purchaseType: 'SALES_LINKED',
        orderStatus: { not: 'CANCELLED' },
      },
      select: { fulfillmentStatus: true },
    })
    const ready = isSalesOrderPurchaseFullyCovered(salesLines, purchasedBySource)
      && activePurchaseOrders.length > 0
      && activePurchaseOrders.every(purchaseOrder => (
        purchaseOrder.fulfillmentStatus === 'SHIPPED'
        || purchaseOrder.fulfillmentStatus === 'SIGNED'
      ))
    if (!ready) {
      return {
        advancedToLandTransit: false,
        fulfillmentStatus: order.fulfillmentStatus,
      }
    }

    assertSalesOrderFulfillmentTransition('PREPARING', 'LAND_TRANSIT', {
      hasActiveDeliveryReceipt: false,
    })
    await transaction.salesOrder.update({
      where: { id: input.salesOrderId },
      data: { fulfillmentStatus: 'LAND_TRANSIT', version: { increment: 1 } },
    })
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId: input.salesOrderId,
      dimension: 'FULFILLMENT',
      fromStatus: 'PREPARING',
      toStatus: 'LAND_TRANSIT',
      reason: '全部有效关联采购订单已发货',
      changedByUserId: input.actorUserId,
    } })
    await this.audit.record(transaction, {
      eventType: AuditEventType.SALES_ORDER_FULFILLMENT_STATUS_CHANGED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: input.actorUserId,
      targetType: 'SALES_ORDER',
      targetId: input.salesOrderId,
      requestId: input.requestId,
      metadata: {
        automatic: true,
        changedPurchaseOrderCount: input.changedPurchaseOrderCount,
        fromStatus: 'PREPARING',
        source: 'PURCHASE_FACTORY_SHIPMENT',
        toStatus: 'LAND_TRANSIT',
        trigger: 'PURCHASE_FACTORY_SHIPMENT',
      },
    })
    return {
      advancedToLandTransit: true,
      fulfillmentStatus: 'LAND_TRANSIT',
    }
  }
}
