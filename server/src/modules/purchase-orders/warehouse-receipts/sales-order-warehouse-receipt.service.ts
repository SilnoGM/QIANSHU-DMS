import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback } from '../../access-control/data-scope.service'
import { AuditService, AuditWriteFailedError } from '../../audit/audit.service'
import { salesOrderScopeWhere } from '../../sales-orders/sales-order-access'
import {
  normalizeFactoryShipmentContext,
  requireFactoryShipmentUuid,
  type FactoryShipmentMutationContext,
} from '../factory-shipments/purchase-order-factory-shipment.normalizer'
import {
  PurchaseOrderWarehouseReceiptService,
  WAREHOUSE_RECEIPT_ORDER_SELECT,
  type WarehouseOrder,
  type WarehouseReceiptOutcome,
} from './purchase-order-warehouse-receipt.service'
import { normalizeSalesOrderWarehouseReceiptRequest } from './sales-order-warehouse-receipt.normalizer'
import { advanceSalesOrderWhenAllShipmentsReceived } from './sales-order-warehouse-progress'

export interface SalesOrderWarehouseReceiptResult {
  readonly purchaseOrders: readonly {
    readonly id: string
    readonly orderNo: string
    readonly fulfillmentStatus: WarehouseOrder['fulfillmentStatus']
    readonly receivedPartCount: number
    readonly changed: boolean
  }[]
  readonly receivedPartCount: number
  readonly changedPurchaseOrderCount: number
  readonly remainingPendingReceiptCount: number
  readonly salesOrder: {
    readonly id: string
    readonly orderNo: string
    readonly fulfillmentStatus: string
    readonly advancedToWarehouseArrived: boolean
  }
}

function stateChanged(): never {
  throw new ApiException(409, 'SALES_WAREHOUSE_RECEIPT_STATE_CHANGED', '入仓范围或订单版本已变化，请刷新后重新核对')
}

function targetInvalid(message = '入仓货件所属采购单不属于该销售订单'): never {
  throw new ApiException(422, 'SALES_WAREHOUSE_RECEIPT_TARGET_INVALID', message)
}

const RECEIPT_ERROR_CODE_BY_PURCHASE_CODE: Readonly<Record<string, string>> = {
  PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED: 'SALES_WAREHOUSE_RECEIPT_STATE_CHANGED',
  PURCHASE_WAREHOUSE_RECEIPT_NOT_ALLOWED: 'SALES_WAREHOUSE_RECEIPT_NOT_ALLOWED',
  PURCHASE_WAREHOUSE_RECEIPT_TARGET_INVALID: 'SALES_WAREHOUSE_RECEIPT_TARGET_INVALID',
  PURCHASE_WAREHOUSE_RECEIPT_TIME_INVALID: 'SALES_WAREHOUSE_RECEIPT_TIME_INVALID',
}

/**
 * 复用单采购单写入时会产生采购域错误码；销售级接口必须只暴露销售契约声明的错误矩阵，
 * 否则客户端无法按契约决定重载还是提示。
 */
function translateReceiptFailure(error: unknown): never {
  if (error instanceof ApiException) {
    const code = RECEIPT_ERROR_CODE_BY_PURCHASE_CODE[error.code]
    if (code !== undefined) throw new ApiException(error.getStatus(), code, error.publicMessage)
  }
  throw error
}

@Injectable()
export class SalesOrderWarehouseReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly receipts: PurchaseOrderWarehouseReceiptService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async receive(
    rawContext: FactoryShipmentMutationContext,
    rawSalesOrderId: unknown,
    rawInput: unknown,
  ): Promise<SalesOrderWarehouseReceiptResult> {
    const context = normalizeFactoryShipmentContext(rawContext)
    const salesOrderId = requireFactoryShipmentUuid(rawSalesOrderId, 'salesOrderId')
    const input = normalizeSalesOrderWarehouseReceiptRequest(rawInput)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const scope = await this.dataScope.resolveInTransaction(transaction, context.actorUserId)
        const salesOrder = await transaction.salesOrder.findFirst({
          where: { id: salesOrderId, ...salesOrderScopeWhere(scope, context.actorUserId) },
          select: { id: true, orderNo: true },
        })
        if (salesOrder === null) {
          throw new ApiException(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
        }

        // 与采购侧入仓、工厂发货统一锁序：销售行 -> 同来源有效采购单 -> 销售主行 -> 货件。
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM sales_order_lines WHERE sales_order_id = ${salesOrderId}::uuid AND removed_at IS NULL ORDER BY id FOR UPDATE`)
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_orders WHERE sales_order_id = ${salesOrderId}::uuid AND purchase_type = 'SALES_LINKED' AND order_status <> 'CANCELLED' ORDER BY id FOR UPDATE`)
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM sales_orders WHERE id = ${salesOrderId}::uuid FOR UPDATE`)
        const salesOrderState = await transaction.salesOrder.findUnique({
          where: { id: salesOrderId },
          select: { orderStatus: true, fulfillmentStatus: true },
        })
        if (salesOrderState === null) {
          throw new ApiException(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
        }
        if (salesOrderState.orderStatus === 'CANCELLED') {
          throw new ApiException(422, 'SALES_WAREHOUSE_RECEIPT_NOT_ALLOWED', '销售订单当前不处于待入仓状态')
        }

        const targets = [...input.targets].sort((left, right) => (
          left.purchaseOrderId.localeCompare(right.purchaseOrderId)
        ))
        const linked = await transaction.purchaseOrder.findMany({
          where: { salesOrderId, purchaseType: 'SALES_LINKED', orderStatus: { not: 'CANCELLED' } },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
        const linkedIds = new Set(linked.map(order => order.id))
        if (targets.some(target => !linkedIds.has(target.purchaseOrderId))) return targetInvalid()
        // 采购单锁已覆盖全部同来源单；目标货件在读取状态前逐单加锁，避免与单采购单入口交叉写入。
        for (const target of targets) {
          await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_order_parts WHERE purchase_order_id = ${target.purchaseOrderId}::uuid ORDER BY id FOR UPDATE`)
        }
        const targetOrders = await transaction.purchaseOrder.findMany({
          where: { id: { in: targets.map(target => target.purchaseOrderId) } },
          select: WAREHOUSE_RECEIPT_ORDER_SELECT,
        })
        const orderById = new Map(targetOrders.map(order => [order.id, order]))

        const results = []
        for (const target of targets) {
          const order = orderById.get(target.purchaseOrderId)
          if (order === undefined) return targetInvalid()
          let outcome: WarehouseReceiptOutcome
          try {
            outcome = await this.receipts.applyReceiptInTransaction(
              transaction,
              context,
              order,
              {
                expectedVersion: target.expectedVersion,
                partIds: target.partIds,
                receivedAt: input.receivedAt,
                remark: input.remark,
              },
            )
          }
          catch (error) {
            translateReceiptFailure(error)
          }
          results.push({
            id: order.id,
            orderNo: order.orderNo,
            fulfillmentStatus: outcome.fulfillmentStatus,
            receivedPartCount: outcome.receivedPartCount,
            changed: outcome.changed,
          })
        }

        const changedPurchaseOrderCount = results.filter(result => result.changed).length
        // 纯重放允许在销售订单已推进后幂等返回；任何新写入仍必须发生在待入仓阶段。
        if (
          changedPurchaseOrderCount > 0
          && (salesOrderState.orderStatus !== 'CONFIRMED' || salesOrderState.fulfillmentStatus !== 'LAND_TRANSIT')
        ) {
          throw new ApiException(422, 'SALES_WAREHOUSE_RECEIPT_NOT_ALLOWED', '销售订单当前不处于待入仓状态')
        }
        if (changedPurchaseOrderCount > 0) {
          // 所有目标采购单写完后只推进一次销售履约；未覆盖全部销售明细时助手内部会保持陆运中。
          await advanceSalesOrderWhenAllShipmentsReceived(transaction, this.audit, {
            salesOrderId,
            actorUserId: context.actorUserId,
            requestId: context.requestId,
          })
        }
        const salesAfter = await transaction.salesOrder.findUnique({
          where: { id: salesOrderId },
          select: { fulfillmentStatus: true },
        })
        const remainingPendingReceiptCount = await transaction.purchaseOrderPart.count({
          where: {
            purchaseOrder: {
              is: {
                salesOrderId,
                purchaseType: 'SALES_LINKED',
                orderStatus: { not: 'CANCELLED' },
              },
            },
            status: 'ACTIVE',
            shippedAt: { not: null },
            warehouseReceivedAt: null,
          },
        })
        return {
          purchaseOrders: results,
          receivedPartCount: results.reduce((sum, result) => sum + result.receivedPartCount, 0),
          changedPurchaseOrderCount,
          remainingPendingReceiptCount,
          salesOrder: {
            id: salesOrder.id,
            orderNo: salesOrder.orderNo,
            fulfillmentStatus: salesAfter?.fulfillmentStatus ?? salesOrderState.fulfillmentStatus,
            advancedToWarehouseArrived: changedPurchaseOrderCount > 0
              && salesAfter?.fulfillmentStatus === 'WAREHOUSE_ARRIVED',
          },
        }
      }, { timeout: 30_000 })
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      const facts = readPersistenceErrorFacts(error)
      if ((error instanceof AuditWriteFailedError && error.transactionConflict)
        || ['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) return stateChanged()
      throw error
    }
  }
}
