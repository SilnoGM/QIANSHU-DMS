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
import { DataScopeService, dataScopeFallback } from '../../access-control/data-scope.service'
import type { DataScope } from '../../access-control/data-scope'
import { AuditService } from '../../audit/audit.service'
import { DictionaryLookupService, DictionaryValueUnavailableError } from '../../dictionaries/dictionary-lookup.service'
import { salesOrderScopeWhere } from '../../sales-orders/sales-order-access'
import { purchaseOrderValidationFailure } from '../domain/purchase-order-errors'
import {
  assertPurchaseOrderFulfillmentTransition,
} from '../domain/purchase-order-state-machine'
import { purchaseOrderScopeWhere } from '../purchase-order-access'
import { SalesOrderPurchaseCoverageService } from '../sales-order-purchase-coverage.service'
import {
  type FactoryShipmentDestinationWarehouse,
  type FactoryShipmentMutationContext,
  type FactoryShipmentTarget,
  type FactoryShipmentTrackingNumber,
  normalizeFactoryShipmentContext,
  normalizePurchaseOrderFactoryShipmentRequest,
  normalizeSalesOrderFactoryShipmentRequest,
  requireFactoryShipmentUuid,
} from './purchase-order-factory-shipment.normalizer'

const AUTOMATIC_PREPARING_REASON = '确认发货时系统自动完成备货状态'
const PENDING_SHIPMENT_STATUSES = new Set<PurchaseOrderFulfillmentStatus>([
  'ORDERED',
  'PREPARING',
  'PARTIALLY_SHIPPED',
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
  readonly parts: readonly { readonly id: string; readonly partNumber: number; readonly status: string; readonly shippedAt: Date | null; readonly trackingNo: string | null; readonly destinationWarehouseValue: string | null }[]
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
    readonly fulfillmentStatus: 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'SIGNED'
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
    private readonly dictionaryLookup: DictionaryLookupService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
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
      const scope = await this.dataScope.resolveInTransaction(transaction, context.actorUserId)
      const candidate = await this.readPurchaseOrder(transaction, purchaseOrderId, scope, context.actorUserId)
      if (candidate === null) return purchaseOrderNotFound()

      let scopeOrders: readonly FactoryShipmentPurchaseOrder[]
      let salesOrder: FactoryShipmentSalesOrder | null = null
      if (candidate.purchaseType === 'SALES_LINKED') {
        if (candidate.salesOrderId === null) return targetInvalid()
        await this.lockSalesLines(transaction, candidate.salesOrderId)
        await this.lockActiveSalesPurchaseOrders(transaction, candidate.salesOrderId)
        scopeOrders = await this.readActiveSalesPurchaseOrders(
          transaction,
          candidate.salesOrderId,
        )
        await this.lockSalesOrder(transaction, candidate.salesOrderId)
        salesOrder = await this.readSalesOrder(transaction, candidate.salesOrderId, scope, context.actorUserId)
        if (salesOrder === null) return salesOrderNotFound()
      }
      else {
        await this.lockPurchaseOrders(transaction, [purchaseOrderId])
        const locked = await this.readPurchaseOrder(transaction, purchaseOrderId, scope, context.actorUserId)
        if (locked === null) return purchaseOrderNotFound()
        scopeOrders = [locked]
      }

      const order = scopeOrders.find(item => item.id === purchaseOrderId)
      if (order === undefined) return shipmentNotAllowed('采购订单已取消或不再有效')
      this.validatePendingTargetVersion(order, input.expectedVersion)
      this.validateShipmentTargetState(order)
      this.validateParts(order, input.partIds, input.destinationWarehouses, input.trackingNumbers)

      const result = await this.advancePurchaseOrder(
        transaction,
        context,
        order,
        input.partIds,
        input.reason,
        'PURCHASE_ORDER',
        input.destinationWarehouses,
        input.trackingNumbers,
      )
      const statusById = new Map(scopeOrders.filter(item => item.orderStatus === 'CONFIRMED').map(item => [
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
      const scope = await this.dataScope.resolveInTransaction(transaction, context.actorUserId)
      // 先按销售单归属确认可见性，再进入销售行与采购单锁序。
      const visible = await transaction.salesOrder.findFirst({
        where: { id: salesOrderId, ...salesOrderScopeWhere(scope, context.actorUserId) },
        select: { id: true },
      })
      if (visible === null) return salesOrderNotFound()
      await this.lockSalesLines(transaction, salesOrderId)
      await this.lockActiveSalesPurchaseOrders(transaction, salesOrderId)
      const orders = await this.readActiveSalesPurchaseOrders(transaction, salesOrderId)
      await this.lockSalesOrder(transaction, salesOrderId)
      const salesOrder = await this.readSalesOrder(transaction, salesOrderId, scope, context.actorUserId)
      if (salesOrder === null) return salesOrderNotFound()

      const orderById = new Map(orders.map(order => [order.id, order]))
      const targets = [...input.targets].sort((left, right) => (
        left.purchaseOrderId.localeCompare(right.purchaseOrderId)
      ))
      const targetOrders = targets.map((target) => {
        const order = orderById.get(target.purchaseOrderId)
        if (order === undefined) return targetInvalid()
        return { order, expectedVersion: target.expectedVersion, partIds: target.partIds, destinationWarehouses: target.destinationWarehouses, trackingNumbers: target.trackingNumbers }
      })

      if (input.mode === 'ALL_PENDING') {
        this.assertCompletePendingTargetSet(orders, input.targets)
      }
      for (const target of targetOrders) {
        this.validatePendingTargetVersion(target.order, target.expectedVersion)
        this.validateShipmentTargetState(target.order)
        this.validateParts(target.order, target.partIds, target.destinationWarehouses, target.trackingNumbers)
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
          target.partIds,
          input.reason,
          'SALES_ORDER',
          target.destinationWarehouses,
          target.trackingNumbers,
        ))
      }
      const statusById = new Map(orders
        .filter(order => order.orderStatus === 'CONFIRMED')
        .map(order => [order.id, order.fulfillmentStatus]))
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
    // 先校验审核事实，再接受已发货幂等重放，避免异常履约快照绕过审核。
    if (order.orderStatus !== 'CONFIRMED' && order.orderStatus !== 'COMPLETED') {
      return shipmentNotAllowed()
    }
    if (isShipmentSatisfied(order.fulfillmentStatus)) return
    if (order.orderStatus !== 'CONFIRMED' || !isPendingShipment(order.fulfillmentStatus)) {
      return shipmentNotAllowed()
    }
  }

  private validateParts(
    order: FactoryShipmentPurchaseOrder,
    partIds: readonly string[],
    destinationWarehouses: readonly FactoryShipmentDestinationWarehouse[],
    trackingNumbers: readonly FactoryShipmentTrackingNumber[] = [],
  ): void {
    if (order.parts.length === 0) return targetInvalid()
    const selected = partIds.map(id => order.parts.find(part => part.id === id))
    if (selected.some(part => part === undefined || part.status !== 'ACTIVE')) return targetInvalid()
    const shippedCount = selected.filter(part => part!.shippedAt !== null).length
    if (shippedCount > 0 && shippedCount < selected.length) return stateChanged()
    if (shippedCount === 0 && isShipmentSatisfied(order.fulfillmentStatus)) return stateChanged()
    // 已发货仓库属于冻结事实；历史空值也不可通过重放补填。
    for (const entry of destinationWarehouses) {
      const part = selected.find(item => item!.id === entry.partId)!
      if (part.shippedAt !== null && part.destinationWarehouseValue !== entry.warehouseValue) return stateChanged()
    }
    // 已发货重放只可确认既有事实，不能借幂等路径补填或更换物流单号。
    for (const entry of trackingNumbers) {
      const part = selected.find(item => item!.id === entry.partId)!
      if (part.shippedAt !== null && entry.trackingNo !== null && part.trackingNo !== entry.trackingNo) return stateChanged()
    }
  }

  private assertCompletePendingTargetSet(
    orders: readonly FactoryShipmentPurchaseOrder[],
    targets: readonly FactoryShipmentTarget[],
  ): void {
    const targetIds = new Set(targets.map(target => target.purchaseOrderId))
    const currentPendingIds = orders
      .filter(order => order.orderStatus === 'CONFIRMED' && isPendingShipment(order.fulfillmentStatus))
      .map(order => order.id)
    if (currentPendingIds.some(id => !targetIds.has(id))) return stateChanged()
    for (const target of targets) {
      const order = orders.find(item => item.id === target.purchaseOrderId)
      if (order?.parts.some(part => part.status === 'ACTIVE' && part.shippedAt === null && !target.partIds.includes(part.id))) return stateChanged()
    }
    if (targets.some(target => !orders.some(order => order.id === target.purchaseOrderId))) {
      return stateChanged()
    }
  }

  private async advancePurchaseOrder(
    transaction: PrismaTypes.TransactionClient,
    context: FactoryShipmentMutationContext,
    order: FactoryShipmentPurchaseOrder,
    partIds: readonly string[],
    reason: string | null,
    source: 'PURCHASE_ORDER' | 'SALES_ORDER',
    destinationWarehouses: readonly FactoryShipmentDestinationWarehouse[],
    trackingNumbers: readonly FactoryShipmentTrackingNumber[] = [],
  ): Promise<FactoryShipmentResult['purchaseOrders'][number]> {
    if (partIds.every(id => order.parts.some(part => part.id === id && part.shippedAt !== null))) {
      return {
        id: order.id,
        orderNo: order.orderNo,
        fulfillmentStatus: order.fulfillmentStatus as 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'SIGNED',
        changed: false,
      }
    }
    // 只对本次新发货校验字典；相同事实的重放允许读取后来停用的历史仓库。
    const effectiveWarehouseValues = new Map<string, string>()
    for (const warehouseValue of [...new Set(destinationWarehouses.map(entry => entry.warehouseValue))].sort()) {
      try {
        const effective = await this.dictionaryLookup.requireEffectiveValue(transaction, { dictionaryCode: 'mainland.warehouse', value: warehouseValue })
        effectiveWarehouseValues.set(warehouseValue, effective.value)
      }
      catch (error) {
        if (error instanceof DictionaryValueUnavailableError) {
          return purchaseOrderValidationFailure('destinationWarehouses', '目的地仓库当前不可用，请重新选择')
        }
        throw error
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
    const shippedAt = new Date()
    const trackingByPartId = new Map(trackingNumbers.map(entry => [entry.partId, entry.trackingNo]))
    const warehouseByPartId = new Map(destinationWarehouses.map(entry => [entry.partId, effectiveWarehouseValues.get(entry.warehouseValue)!]))
    const groups = new Map<string, { trackingNo: string | null; warehouseValue: string; ids: string[] }>()
    for (const partId of partIds) {
      const trackingNo = trackingByPartId.get(partId) ?? null
      const warehouseValue = warehouseByPartId.get(partId)!
      const key = JSON.stringify([trackingNo, warehouseValue])
      const group = groups.get(key) ?? { trackingNo, warehouseValue, ids: [] }
      group.ids.push(partId)
      groups.set(key, group)
    }
    // 按单号与仓库组合分组，在同次条件更新中冻结全部发货事实。
    // 未填单号不清空原值，任一组竞争失败都让外层事务回滚全部发货。
    for (const { trackingNo, warehouseValue, ids } of groups.values()) {
      const updated = await transaction.purchaseOrderPart.updateMany({
        where: { purchaseOrderId: order.id, id: { in: ids }, status: 'ACTIVE', shippedAt: null },
        data: {
          shippedAt, shippedById: context.actorUserId, shipmentRecordedAt: shippedAt, shipmentRemark: reason,
          destinationWarehouseValue: warehouseValue,
          ...(trackingNo === null ? {} : { trackingNo }),
        },
      })
      if (updated.count !== ids.length) return stateChanged()
    }
    const toStatus = order.parts.filter(part => part.status === 'ACTIVE')
      .every(part => part.shippedAt !== null || partIds.includes(part.id)) ? 'SHIPPED' : 'PARTIALLY_SHIPPED'
    if (fromStatus !== toStatus) assertPurchaseOrderFulfillmentTransition(fromStatus, toStatus, {
      orderStatus: order.orderStatus,
    })
    const partLabels = order.parts.filter(part => partIds.includes(part.id))
      .map(part => `货件-${String(part.partNumber).padStart(2, '0')}`).join('、')
    // 状态历史说明有 500 字上限；完整说明在各货件保存，审计保留精确货件 ID。
    const shipmentReason = [...`本次发货：${partLabels}${reason === null ? '' : `；${reason}`}`].slice(0, 500).join('')
    await this.writePurchaseTransition(
      transaction,
      context,
      order,
      fromStatus,
      toStatus,
      shipmentReason,
      source,
      false,
      partIds,
    )
    return {
      id: order.id,
      orderNo: order.orderNo,
      fulfillmentStatus: toStatus,
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
    partIds: readonly string[] = [],
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
      metadata: { automatic, fromStatus, source, toStatus, ...(partIds.length === 0 ? {} : { partIds: [...partIds] }) },
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
    scope: DataScope,
    actorUserId: string,
  ): Promise<FactoryShipmentPurchaseOrder | null> {
    return transaction.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, ...purchaseOrderScopeWhere(scope, actorUserId) },
      select: {
        id: true,
        orderNo: true,
        orderStatus: true,
        fulfillmentStatus: true,
        purchaseType: true,
        salesOrderId: true,
        version: true,
        parts: { select: { id: true, partNumber: true, status: true, shippedAt: true, trackingNo: true, destinationWarehouseValue: true } },
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
        parts: { select: { id: true, partNumber: true, status: true, shippedAt: true, trackingNo: true, destinationWarehouseValue: true } },
      },
    })
  }

  private readSalesOrder(
    transaction: PrismaTypes.TransactionClient,
    salesOrderId: string,
    scope: DataScope,
    actorUserId: string,
  ): Promise<FactoryShipmentSalesOrder | null> {
    return transaction.salesOrder.findFirst({
      where: { id: salesOrderId, ...salesOrderScopeWhere(scope, actorUserId) },
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
