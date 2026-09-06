import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma, type Prisma as PrismaTypes } from '../../../generated/prisma/client'
import type {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderStatus,
  PurchaseOrderType,
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AuditService } from '../../audit/audit.service'
import {
  assertPurchaseOrderFulfillmentTransition,
} from '../domain/purchase-order-state-machine'
import { SalesOrderPurchaseCoverageService } from '../sales-order-purchase-coverage.service'
import {
  type FactoryShipmentMutationContext,
  type FactoryShipmentTarget,
  normalizeFactoryShipmentContext,
  normalizePurchaseOrderFactoryShipmentRequest,
  normalizeSalesOrderFactoryShipmentRequest,
  requireFactoryShipmentUuid,
} from './purchase-order-factory-shipment.normalizer'

const AUTOMATIC_PREPARING_REASON = '确认发货时系统自动完成备货状态'
const PENDING_SHIPMENT_STATUSES = new Set<PurchaseOrderFulfillmentStatus>([
  'ORDERED',
  'PREPARING',
])
const SATISFIED_SHIPMENT_STATUSES = new Set<PurchaseOrderFulfillmentStatus>([
  'SHIPPED',
  'SIGNED',
])

interface FactoryShipmentPurchaseOrder {
  readonly id: string
  readonly orderNo: string
  readonly orderStatus: PurchaseOrderStatus
  readonly fulfillmentStatus: PurchaseOrderFulfillmentStatus
  readonly purchaseType: PurchaseOrderType
  readonly salesOrderId: string | null
  readonly version: number
}

interface FactoryShipmentSalesOrder {
  readonly id: string
  readonly orderNo: string
  readonly orderStatus: SalesOrderStatus
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
}

export interface FactoryShipmentResult {
  readonly purchaseOrders: readonly {
    readonly id: string
    readonly orderNo: string
    readonly fulfillmentStatus: 'SHIPPED' | 'SIGNED'
    readonly changed: boolean
  }[]
  readonly changedPurchaseOrderCount: number
  readonly alreadySatisfiedCount: number
  readonly remainingPendingShipmentCount: number
  readonly salesOrder: {
    readonly id: string
    readonly orderNo: string
    readonly fulfillmentStatus: SalesOrderFulfillmentStatus
    readonly advancedToLandTransit: boolean
  } | null
}

function stateChanged(): never {
  throw new ApiException(
    HttpStatus.CONFLICT,
    'FACTORY_SHIPMENT_STATE_CHANGED',
    '订单状态已变化，请刷新后重新确认发货范围',
  )
}

function targetInvalid(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'FACTORY_SHIPMENT_TARGET_INVALID',
    '发货目标与当前订单不匹配',
  )
}

function shipmentNotAllowed(message = '当前订单状态不能执行工厂发货'): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'FACTORY_SHIPMENT_NOT_ALLOWED',
    message,
  )
}

function purchaseOrderNotFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    'PURCHASE_ORDER_NOT_FOUND',
    '采购订单不存在',
  )
}

function salesOrderNotFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    'SALES_ORDER_NOT_FOUND',
    '销售订单不存在',
  )
}

function isPendingShipment(status: PurchaseOrderFulfillmentStatus): boolean {
  return PENDING_SHIPMENT_STATUSES.has(status)
}

function isShipmentSatisfied(status: PurchaseOrderFulfillmentStatus): boolean {
  return SATISFIED_SHIPMENT_STATUSES.has(status)
}

@Injectable()
export class PurchaseOrderFactoryShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly salesOrderCoverage: SalesOrderPurchaseCoverageService,
  ) {}

  async shipPurchaseOrder(
    rawContext: FactoryShipmentMutationContext,
    rawPurchaseOrderId: unknown,
    rawInput: unknown,
  ): Promise<FactoryShipmentResult> {
    const context = normalizeFactoryShipmentContext(rawContext)
    const purchaseOrderId = requireFactoryShipmentUuid(
      rawPurchaseOrderId,
      'purchaseOrderId',
    )
    const input = normalizePurchaseOrderFactoryShipmentRequest(rawInput)

    return this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      const candidate = await this.readPurchaseOrder(transaction, purchaseOrderId)
      if (candidate === null) return purchaseOrderNotFound()

      let scope: readonly FactoryShipmentPurchaseOrder[]
      let salesOrder: FactoryShipmentSalesOrder | null = null
      if (candidate.purchaseType === 'SALES_LINKED') {
        if (candidate.salesOrderId === null) return targetInvalid()
        await this.lockSalesLines(transaction, candidate.salesOrderId)
        await this.lockActiveSalesPurchaseOrders(transaction, candidate.salesOrderId)
        scope = await this.readActiveSalesPurchaseOrders(
          transaction,
          candidate.salesOrderId,
        )
        await this.lockSalesOrder(transaction, candidate.salesOrderId)
        salesOrder = await this.readSalesOrder(transaction, candidate.salesOrderId)
        if (salesOrder === null) return salesOrderNotFound()
      }
      else {
        await this.lockPurchaseOrders(transaction, [purchaseOrderId])
        const locked = await this.readPurchaseOrder(transaction, purchaseOrderId)
        if (locked === null) return purchaseOrderNotFound()
        scope = [locked]
      }

      const order = scope.find(item => item.id === purchaseOrderId)
      if (order === undefined) return shipmentNotAllowed('采购订单已取消或不再有效')
      this.validatePendingTargetVersion(order, input.expectedVersion)
      this.validateShipmentTargetState(order)

      const result = await this.advancePurchaseOrder(
        transaction,
        context,
        order,
        input.reason,
        'PURCHASE_ORDER',
      )
      const statusById = new Map(scope.map(item => [
        item.id,
        item.id === order.id ? result.fulfillmentStatus : item.fulfillmentStatus,
      ]))
      const salesResult = salesOrder === null
        ? null
        : await this.advanceSalesOrderWhenReady(
            transaction,
            context,
            salesOrder,
            result.changed ? 1 : 0,
          )
      return {
        purchaseOrders: [result],
        changedPurchaseOrderCount: result.changed ? 1 : 0,
        alreadySatisfiedCount: result.changed ? 0 : 1,
        remainingPendingShipmentCount: [...statusById.values()]
          .filter(isPendingShipment).length,
        salesOrder: salesResult,
      }
    })
  }

  async shipSalesOrder(
    rawContext: FactoryShipmentMutationContext,
    rawSalesOrderId: unknown,
    rawInput: unknown,
  ): Promise<FactoryShipmentResult> {
    const context = normalizeFactoryShipmentContext(rawContext)
    const salesOrderId = requireFactoryShipmentUuid(rawSalesOrderId, 'salesOrderId')
    const input = normalizeSalesOrderFactoryShipmentRequest(rawInput)

    return this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      await this.lockSalesLines(transaction, salesOrderId)
      await this.lockActiveSalesPurchaseOrders(transaction, salesOrderId)
      const orders = await this.readActiveSalesPurchaseOrders(transaction, salesOrderId)
      await this.lockSalesOrder(transaction, salesOrderId)
      const salesOrder = await this.readSalesOrder(transaction, salesOrderId)
      if (salesOrder === null) return salesOrderNotFound()

      const orderById = new Map(orders.map(order => [order.id, order]))
      const targets = [...input.targets].sort((left, right) => (
        left.purchaseOrderId.localeCompare(right.purchaseOrderId)
      ))
      const targetOrders = targets.map((target) => {
        const order = orderById.get(target.purchaseOrderId)
        if (order === undefined) return targetInvalid()
        return { order, expectedVersion: target.expectedVersion }
      })

      if (input.mode === 'ALL_PENDING') {
        this.assertCompletePendingTargetSet(orders, input.targets)
      }
      for (const target of targetOrders) {
        this.validatePendingTargetVersion(target.order, target.expectedVersion)
        this.validateShipmentTargetState(target.order)
      }
      const hasPendingTarget = targetOrders.some(target => (
        isPendingShipment(target.order.fulfillmentStatus)
      ))
      if (
        hasPendingTarget
        && (
          salesOrder.orderStatus !== 'CONFIRMED'
          || salesOrder.fulfillmentStatus !== 'PREPARING'
        )
      ) {
        return shipmentNotAllowed('销售订单当前不处于待发货状态')
      }

      const results = []
      for (const target of targetOrders) {
        results.push(await this.advancePurchaseOrder(
          transaction,
          context,
          target.order,
          input.reason,
          'SALES_ORDER',
        ))
      }
      const statusById = new Map(orders.map(order => [order.id, order.fulfillmentStatus]))
      for (const result of results) statusById.set(result.id, result.fulfillmentStatus)
      const changedCount = results.filter(result => result.changed).length
      const salesResult = await this.advanceSalesOrderWhenReady(
        transaction,
        context,
        salesOrder,
        changedCount,
      )
      return {
        purchaseOrders: results,
        changedPurchaseOrderCount: changedCount,
        alreadySatisfiedCount: results.length - changedCount,
        remainingPendingShipmentCount: [...statusById.values()]
          .filter(isPendingShipment).length,
        salesOrder: salesResult,
      }
    })
  }

  private validatePendingTargetVersion(
    order: FactoryShipmentPurchaseOrder,
    expectedVersion: number,
  ): void {
    if (isPendingShipment(order.fulfillmentStatus) && order.version !== expectedVersion) {
      return stateChanged()
    }
  }

  private validateShipmentTargetState(order: FactoryShipmentPurchaseOrder): void {
    if (isShipmentSatisfied(order.fulfillmentStatus)) return
    if (order.orderStatus !== 'CONFIRMED' || !isPendingShipment(order.fulfillmentStatus)) {
      return shipmentNotAllowed()
    }
  }

  private assertCompletePendingTargetSet(
    orders: readonly FactoryShipmentPurchaseOrder[],
    targets: readonly FactoryShipmentTarget[],
  ): void {
    const targetIds = new Set(targets.map(target => target.purchaseOrderId))
    const currentPendingIds = orders
      .filter(order => isPendingShipment(order.fulfillmentStatus))
      .map(order => order.id)
    if (currentPendingIds.some(id => !targetIds.has(id))) return stateChanged()
    if (targets.some(target => !orders.some(order => order.id === target.purchaseOrderId))) {
      return stateChanged()
    }
  }

  private async advancePurchaseOrder(
    transaction: PrismaTypes.TransactionClient,
    context: FactoryShipmentMutationContext,
    order: FactoryShipmentPurchaseOrder,
    reason: string | null,
    source: 'PURCHASE_ORDER' | 'SALES_ORDER',
  ): Promise<FactoryShipmentResult['purchaseOrders'][number]> {
    if (isShipmentSatisfied(order.fulfillmentStatus)) {
      return {
        id: order.id,
        orderNo: order.orderNo,
        fulfillmentStatus: order.fulfillmentStatus as 'SHIPPED' | 'SIGNED',
        changed: false,
      }
    }
    let fromStatus = order.fulfillmentStatus
    if (fromStatus === 'ORDERED') {
      assertPurchaseOrderFulfillmentTransition('ORDERED', 'PREPARING', {
        orderStatus: order.orderStatus,
      })
      await this.writePurchaseTransition(
        transaction,
        context,
        order,
        'ORDERED',
        'PREPARING',
        AUTOMATIC_PREPARING_REASON,
        source,
        true,
      )
      fromStatus = 'PREPARING'
    }
    assertPurchaseOrderFulfillmentTransition(fromStatus, 'SHIPPED', {
      orderStatus: order.orderStatus,
    })
    await this.writePurchaseTransition(
      transaction,
      context,
      order,
      fromStatus,
      'SHIPPED',
      reason ?? (source === 'SALES_ORDER' ? '从销售订单确认关联采购单工厂发货' : '用户确认本采购单发货'),
      source,
      false,
    )
    return {
      id: order.id,
      orderNo: order.orderNo,
      fulfillmentStatus: 'SHIPPED',
      changed: true,
    }
  }

  private async writePurchaseTransition(
    transaction: PrismaTypes.TransactionClient,
    context: FactoryShipmentMutationContext,
    order: FactoryShipmentPurchaseOrder,
    fromStatus: PurchaseOrderFulfillmentStatus,
    toStatus: PurchaseOrderFulfillmentStatus,
    reason: string | null,
    source: 'PURCHASE_ORDER' | 'SALES_ORDER',
    automatic: boolean,
  ): Promise<void> {
    await transaction.purchaseOrder.update({
      where: { id: order.id },
      data: { fulfillmentStatus: toStatus, version: { increment: 1 } },
    })
    await transaction.purchaseOrderStatusHistory.create({ data: {
      purchaseOrderId: order.id,
      dimension: 'FULFILLMENT',
      fromStatus,
      toStatus,
      reason,
      changedByUserId: context.actorUserId,
    } })
    await this.audit.record(transaction, {
      eventType: AuditEventType.PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: context.actorUserId,
      targetType: 'PURCHASE_ORDER',
      targetId: order.id,
      requestId: context.requestId,
      metadata: { automatic, fromStatus, source, toStatus },
    })
  }

  private async advanceSalesOrderWhenReady(
    transaction: PrismaTypes.TransactionClient,
    context: FactoryShipmentMutationContext,
    salesOrder: FactoryShipmentSalesOrder,
    changedPurchaseOrderCount: number,
  ): Promise<NonNullable<FactoryShipmentResult['salesOrder']>> {
    const progress = await this.salesOrderCoverage.advanceWhenAllPurchasesShipped(
      transaction,
      {
        actorUserId: context.actorUserId,
        changedPurchaseOrderCount,
        requestId: context.requestId,
        salesOrderId: salesOrder.id,
      },
    )
    return {
      id: salesOrder.id,
      orderNo: salesOrder.orderNo,
      fulfillmentStatus: progress.fulfillmentStatus,
      advancedToLandTransit: progress.advancedToLandTransit,
    }
  }

  private readPurchaseOrder(
    transaction: PrismaTypes.TransactionClient,
    purchaseOrderId: string,
  ): Promise<FactoryShipmentPurchaseOrder | null> {
    return transaction.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        id: true,
        orderNo: true,
        orderStatus: true,
        fulfillmentStatus: true,
        purchaseType: true,
        salesOrderId: true,
        version: true,
      },
    })
  }

  private readActiveSalesPurchaseOrders(
    transaction: PrismaTypes.TransactionClient,
    salesOrderId: string,
  ): Promise<FactoryShipmentPurchaseOrder[]> {
    return transaction.purchaseOrder.findMany({
      where: {
        salesOrderId,
        purchaseType: 'SALES_LINKED',
        orderStatus: { not: 'CANCELLED' },
      },
      orderBy: [{ id: 'asc' }],
      select: {
        id: true,
        orderNo: true,
        orderStatus: true,
        fulfillmentStatus: true,
        purchaseType: true,
        salesOrderId: true,
        version: true,
      },
    })
  }

  private readSalesOrder(
    transaction: PrismaTypes.TransactionClient,
    salesOrderId: string,
  ): Promise<FactoryShipmentSalesOrder | null> {
    return transaction.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        id: true,
        orderNo: true,
        orderStatus: true,
        fulfillmentStatus: true,
      },
    })
  }

  private async lockSalesLines(
    transaction: PrismaTypes.TransactionClient,
    salesOrderId: string,
  ): Promise<void> {
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "sales_order_lines"
      WHERE "sales_order_id" = CAST(${salesOrderId} AS uuid)
        AND "removed_at" IS NULL
      ORDER BY "id"
      FOR UPDATE
    `)
  }

  private async lockActiveSalesPurchaseOrders(
    transaction: PrismaTypes.TransactionClient,
    salesOrderId: string,
  ): Promise<void> {
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "purchase_orders"
      WHERE "sales_order_id" = CAST(${salesOrderId} AS uuid)
        AND "purchase_type" = CAST('SALES_LINKED' AS "purchase_order_type")
        AND "order_status" <> CAST('CANCELLED' AS "purchase_order_status")
      ORDER BY "id"
      FOR UPDATE
    `)
  }

  private async lockPurchaseOrders(
    transaction: PrismaTypes.TransactionClient,
    purchaseOrderIds: readonly string[],
  ): Promise<void> {
    const ids = [...purchaseOrderIds].sort().map(id => Prisma.sql`CAST(${id} AS uuid)`)
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "purchase_orders"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE
    `)
  }

  private async lockSalesOrder(
    transaction: PrismaTypes.TransactionClient,
    salesOrderId: string,
  ): Promise<void> {
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "sales_orders"
      WHERE "id" = CAST(${salesOrderId} AS uuid)
      FOR UPDATE
    `)
  }
}
