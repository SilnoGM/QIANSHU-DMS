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
import { AuditService, type AuditMetadata } from '../audit/audit.service'
import {
  mergeClaimedCoverage,
  readClaimedQuantitiesBySalesLine,
  readUnownedQuantitiesBySalesLine,
  subtractUnownedCoverage,
} from '../sales-orders/sales-order-claim-coverage'
import {
  assertSalesOrderFulfillmentTransition,
} from '../sales-orders/domain/sales-order-state-machine'
import { purchaseReviewSourceBlockReason } from './purchase-order-review-source'

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
  /// 纠正等特殊入口可以覆盖默认历史原因与审计 trigger；普通取消保持原口径。
  readonly historyReason?: string
  readonly trigger?: string
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

export interface AdvanceToPreparingWhenCoveredInput {
  readonly actorUserId: string
  readonly auditMetadata: AuditMetadata
  readonly historyReason: string
  readonly requestId: string
  readonly salesOrderId: string
}

export interface RecalculateAfterShipmentReleaseInput {
  readonly actorUserId: string
  readonly requestId: string
  readonly salesOrderId: string
}

/**
 * 释放进寄仓后，原销售单的采购行数量不会变化，但对应货件已转出。
 * 只在发货前阶段重算：备货且覆盖不再完整时退回待采购；一旦进入陆运及之后，
 * 物流事实已经成立，不因覆盖变化倒退。
 */
export async function recalculateAfterShipmentRelease(
  transaction: PrismaTypes.TransactionClient,
  audit: AuditService,
  input: RecalculateAfterShipmentReleaseInput,
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
  if (
    locked.length !== 1
    || order?.orderStatus !== 'CONFIRMED'
    || order.fulfillmentStatus !== 'PREPARING'
  ) {
    return
  }

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
        orderStatus: { in: ['CONFIRMED', 'COMPLETED'] },
      },
    },
    _sum: { quantity: true },
  })
  const purchasedBySource = new Map<string, number>()
  for (const row of purchasedRows) {
    if (row.sourceSalesOrderLineId !== null) {
      purchasedBySource.set(row.sourceSalesOrderLineId, row._sum.quantity ?? 0)
    }
  }
  const salesLineIds = salesLines.map(line => line.id)
  const effectivePurchases = subtractUnownedCoverage(
    purchasedBySource,
    await readUnownedQuantitiesBySalesLine(transaction, input.salesOrderId, salesLineIds),
  )
  const claimedBySalesLine = await readClaimedQuantitiesBySalesLine(
    transaction,
    input.salesOrderId,
    salesLineIds,
  )
  if (isSalesOrderPurchaseFullyCovered(
    salesLines,
    mergeClaimedCoverage(effectivePurchases, claimedBySalesLine),
  )) {
    return
  }

  await transaction.salesOrder.update({
    where: { id: input.salesOrderId },
    data: { fulfillmentStatus: 'PENDING', version: { increment: 1 } },
  })
  await transaction.salesOrderStatusHistory.create({ data: {
    salesOrderId: input.salesOrderId,
    dimension: 'FULFILLMENT',
    fromStatus: 'PREPARING',
    toStatus: 'PENDING',
    reason: '货件释放进寄仓后重新计算销售产品采购覆盖',
    changedByUserId: input.actorUserId,
  } })
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
      fromStatus: 'PREPARING',
      toStatus: 'PENDING',
      trigger: 'SHIPMENT_RELEASE',
    },
  })
}

export type CoverageAdvanceResult =
  | { readonly status: 'ADVANCED' | 'NOT_PENDING' | 'NOT_COVERED' }
  | { readonly status: 'ORDER_STATE_CHANGED', readonly orderStatus: SalesOrderStatus | null }

/**
 * 待采购订单只剩「被覆盖后进入备货」这一个自动化出口。
 * 采购审核与寄仓认领都走这里，保证两条货源事实共用同一套锁序、覆盖判断与审计字段。
 * 调用方必须在写入货源事实的同一事务内调用；订单状态变化由调用方翻译成各自错误码。
 */
export async function advanceToPreparingWhenCovered(
  transaction: PrismaTypes.TransactionClient,
  audit: AuditService,
  input: AdvanceToPreparingWhenCoveredInput,
): Promise<CoverageAdvanceResult> {
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
  if (locked.length !== 1 || order === undefined) {
    return { orderStatus: null, status: 'ORDER_STATE_CHANGED' }
  }
  if (order.orderStatus !== 'CONFIRMED') {
    return { orderStatus: order.orderStatus, status: 'ORDER_STATE_CHANGED' }
  }
  if (order.fulfillmentStatus !== 'PENDING') return { status: 'NOT_PENDING' }

  const salesLines = await transaction.salesOrderLine.findMany({
    where: { salesOrderId: input.salesOrderId, removedAt: null },
    select: { id: true, quantity: true },
  })
  if (salesLines.length === 0) return { status: 'NOT_COVERED' }

  const purchasedRows = await transaction.purchaseOrderLine.groupBy({
    by: ['sourceSalesOrderLineId'],
    where: {
      sourceSalesOrderLineId: { in: salesLines.map(line => line.id) },
      purchaseOrder: {
        salesOrderId: input.salesOrderId,
        purchaseType: 'SALES_LINKED',
        // 待审核数量只预占可采购余额，不能推进销售履约。
        orderStatus: { in: ['CONFIRMED', 'COMPLETED'] },
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
  const salesLineIds = salesLines.map(line => line.id)
  const effectivePurchases = subtractUnownedCoverage(
    purchasedBySource,
    await readUnownedQuantitiesBySalesLine(transaction, input.salesOrderId, salesLineIds),
  )
  const claimedBySalesLine = await readClaimedQuantitiesBySalesLine(
    transaction,
    input.salesOrderId,
    salesLineIds,
  )
  if (!isSalesOrderPurchaseFullyCovered(
    salesLines,
    mergeClaimedCoverage(effectivePurchases, claimedBySalesLine),
  )) {
    return { status: 'NOT_COVERED' }
  }

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
    reason: input.historyReason,
    changedByUserId: input.actorUserId,
  } })
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
      fromStatus: 'PENDING',
      toStatus: 'PREPARING',
      ...input.auditMetadata,
    },
  })
  return { status: 'ADVANCED' }
}

@Injectable()
export class SalesOrderPurchaseCoverageService {
  constructor(private readonly audit: AuditService) {}

  async advanceWhenFullyCovered(
    transaction: PrismaTypes.TransactionClient,
    input: AdvanceSalesOrderPurchaseProgressInput,
  ): Promise<void> {
    // 本次采购可能只锁定部分销售明细。共享推进函数会额外锁定销售订单主行，
    // 让同一订单下、审核不同采购单与寄仓认领的并发操作按统一顺序完成覆盖判定。
    const result = await advanceToPreparingWhenCovered(transaction, this.audit, {
      actorUserId: input.actorUserId,
      auditMetadata: {
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderNo: input.purchaseOrderNo,
        trigger: 'PURCHASE_COVERAGE',
      },
      historyReason: '采购订单审核通过后已覆盖全部销售产品',
      requestId: input.requestId,
      salesOrderId: input.salesOrderId,
    })
    if (result.status === 'ORDER_STATE_CHANGED') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'PURCHASE_ORDER_STATE_CHANGED',
        purchaseReviewSourceBlockReason(result.orderStatus) ?? '关联销售来源不存在，请核实来源订单',
      )
    }
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
          orderStatus: { in: ['CONFIRMED', 'COMPLETED'] },
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
    // 认领货件不随采购取消失效；已转出的货件也不能再为原单充数。
    const salesLineIds = salesLines.map(line => line.id)
    const effectivePurchases = subtractUnownedCoverage(
      purchasedBySource,
      await readUnownedQuantitiesBySalesLine(transaction, input.salesOrderId, salesLineIds),
    )
    const claimedBySalesLine = await readClaimedQuantitiesBySalesLine(
      transaction,
      input.salesOrderId,
      salesLineIds,
    )
    const fullyCovered = isSalesOrderPurchaseFullyCovered(
      salesLines,
      mergeClaimedCoverage(effectivePurchases, claimedBySalesLine),
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
      reason: input.historyReason ?? '取消采购订单后重新计算销售产品采购覆盖',
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
        trigger: input.trigger ?? 'PURCHASE_CANCELLATION',
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
          orderStatus: { in: ['CONFIRMED', 'COMPLETED'] },
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
    const salesLineIds = salesLines.map(line => line.id)
    const effectivePurchases = subtractUnownedCoverage(
      purchasedBySource,
      await readUnownedQuantitiesBySalesLine(transaction, input.salesOrderId, salesLineIds),
    )
    const claimedBySalesLine = await readClaimedQuantitiesBySalesLine(
      transaction,
      input.salesOrderId,
      salesLineIds,
    )
    const activePurchaseOrders = await transaction.purchaseOrder.findMany({
      where: {
        salesOrderId: input.salesOrderId,
        purchaseType: 'SALES_LINKED',
        orderStatus: { not: 'CANCELLED' },
      },
      select: { fulfillmentStatus: true, orderStatus: true },
    })
    // 认领货件已经处于物流流程中，可单独构成“全部发货”；采购单仍按既有口径逐单校验。
    const hasClaimedCoverage = claimedBySalesLine.size > 0
    const ready = isSalesOrderPurchaseFullyCovered(
      salesLines,
      mergeClaimedCoverage(effectivePurchases, claimedBySalesLine),
    )
      && (activePurchaseOrders.length > 0 || hasClaimedCoverage)
      && activePurchaseOrders.every(purchaseOrder => (
        (purchaseOrder.orderStatus === 'CONFIRMED' || purchaseOrder.orderStatus === 'COMPLETED')
        && (
          purchaseOrder.fulfillmentStatus === 'SHIPPED'
          || purchaseOrder.fulfillmentStatus === 'SIGNED'
        )
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
