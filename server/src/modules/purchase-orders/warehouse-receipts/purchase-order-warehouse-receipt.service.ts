import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AuditService, AuditWriteFailedError } from '../../audit/audit.service'
import { derivePurchaseOrderStatus } from '../domain/purchase-order-state-machine'
import { normalizeFactoryShipmentContext, requireFactoryShipmentUuid, type FactoryShipmentMutationContext } from '../factory-shipments/purchase-order-factory-shipment.normalizer'
import { PurchaseOrderQueryService } from '../purchase-order-query.service'
import { normalizeWarehouseReceiptRequest, normalizeWarehouseRemark, type WarehouseReceiptInput } from './purchase-order-warehouse-receipt.normalizer'
import { advanceSalesOrderWhenAllShipmentsReceived } from './sales-order-warehouse-progress'

const ORDER_SELECT = {
  id: true, orderNo: true, purchaseType: true, salesOrderId: true, orderStatus: true, fulfillmentStatus: true, paymentStatus: true, version: true,
  parts: { orderBy: { id: 'asc' }, select: { id: true, partNumber: true, status: true, shippedAt: true, warehouseReceivedAt: true, warehouseReceivedById: true, warehouseRecordedAt: true, warehouseRemark: true } },
} satisfies Prisma.PurchaseOrderSelect
type WarehouseOrder = Prisma.PurchaseOrderGetPayload<{ select: typeof ORDER_SELECT }>
type WarehouseCommand = Omit<WarehouseReceiptInput, 'expectedVersion' | 'partIds'> & { expectedVersion: number | null, partIds: readonly string[] | null }

function stateChanged(): never {
  throw new ApiException(409, 'PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED', '入仓范围或订单版本已变化，请刷新后重新核对')
}

function notAllowed(message = '当前采购订单不能确认入仓'): never {
  throw new ApiException(422, 'PURCHASE_WAREHOUSE_RECEIPT_NOT_ALLOWED', message)
}

@Injectable()
export class PurchaseOrderWarehouseReceiptService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly query: PurchaseOrderQueryService) {}

  async receive(rawContext: FactoryShipmentMutationContext, rawOrderId: unknown, rawInput: unknown) {
    const context = normalizeFactoryShipmentContext(rawContext), orderId = requireFactoryShipmentUuid(rawOrderId, 'purchaseOrderId')
    await this.write(context, orderId, normalizeWarehouseReceiptRequest(rawInput))
    return this.query.getById(orderId)
  }

  /** 旧签收没有版本字段，但仍进入相同父锁、逐件验证和审计流程；不能只推进采购单快照。 */
  async receiveAll(rawContext: FactoryShipmentMutationContext, rawOrderId: unknown, rawRemark: unknown) {
    const context = normalizeFactoryShipmentContext(rawContext), orderId = requireFactoryShipmentUuid(rawOrderId, 'purchaseOrderId')
    await this.write(context, orderId, { expectedVersion: null, partIds: null, receivedAt: null, remark: normalizeWarehouseRemark(rawRemark) })
    return this.query.getById(orderId)
  }

  private async write(context: FactoryShipmentMutationContext, orderId: string, input: WarehouseCommand): Promise<void> {
    // 未提供实际时间时，指纹保留空值；重试不会因服务器当前时间变化变成另一笔请求。
    const requestFingerprint = createHash('sha256').update(JSON.stringify({ format: 'purchase-warehouse-receipt.v1', actorUserId: context.actorUserId, orderId, ...input })).digest('hex')
    try {
      await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const order = await this.lockOrder(transaction, orderId)
        if (!['CONFIRMED', 'COMPLETED'].includes(order.orderStatus)) return notAllowed()
        const active = order.parts.filter(part => part.status === 'ACTIVE')
        if (active.length === 0 || order.parts.some(part => part.status === 'PENDING_REVIEW')) return notAllowed()
        const replay = await transaction.auditEvent.findFirst({
          where: { actorType: 'USER', eventType: 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED', targetType: 'PURCHASE_ORDER', targetId: order.id, actorUserId: context.actorUserId, outcome: 'SUCCESS', metadata: { path: ['requestFingerprint'], equals: requestFingerprint } },
          select: { metadata: true },
        })
        if (replay !== null) {
          if (!this.matchesReplay(replay.metadata, active, context.actorUserId, input)) return stateChanged()
          return
        }
        if (input.expectedVersion !== null && order.version !== input.expectedVersion) return stateChanged()
        if (input.partIds === null && active.some(part => part.shippedAt === null)) return notAllowed('所有有效货件发货后，才能使用整单签收')
        const selected = input.partIds === null
          ? active.filter(part => part.warehouseReceivedAt === null)
          : input.partIds.map(id => active.find(part => part.id === id))
        if (selected.some(part => part === undefined)) throw new ApiException(422, 'PURCHASE_WAREHOUSE_RECEIPT_TARGET_INVALID', '入仓货件不属于该采购单或已取消')
        const parts = selected as WarehouseOrder['parts']
        if (parts.length === 0 || parts.some(part => part.warehouseReceivedAt !== null)) return stateChanged()
        if (!['PARTIALLY_SHIPPED', 'SHIPPED'].includes(order.fulfillmentStatus) || parts.some(part => part.shippedAt === null)) return notAllowed('只能确认已发货且尚未入仓的货件')
        const rows = await transaction.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS now`)
        const recordedAt = rows[0].now, receivedAt = input.receivedAt === null ? recordedAt : new Date(input.receivedAt)
        const partIds = parts.map(part => part.id).sort()
        // 历史 PostgreSQL 发货事实可带微秒，JS Date 会截断为毫秒；最终时间比较必须由数据库保留原精度。
        const precedesShipment = receivedAt <= recordedAt && await transaction.purchaseOrderPart.count({
          where: { id: { in: partIds }, shippedAt: { gt: receivedAt } },
        }) > 0
        if (receivedAt > recordedAt || precedesShipment) {
          throw new ApiException(422, 'PURCHASE_WAREHOUSE_RECEIPT_TIME_INVALID', '入仓时间不能早于所选货件发货时间或晚于当前时间')
        }
        const updated = await transaction.purchaseOrderPart.updateMany({
          where: { purchaseOrderId: order.id, id: { in: partIds }, status: 'ACTIVE', shippedAt: { not: null }, warehouseReceivedAt: null },
          data: { warehouseReceivedAt: receivedAt, warehouseReceivedById: context.actorUserId, warehouseRecordedAt: recordedAt, warehouseRemark: input.remark },
        })
        if (updated.count !== partIds.length) return stateChanged()
        const allReceived = active.every(part => part.warehouseReceivedAt !== null || partIds.includes(part.id))
        const fulfillmentStatus = allReceived ? 'SIGNED' : order.fulfillmentStatus
        const orderStatus = derivePurchaseOrderStatus({ ...order, fulfillmentStatus })
        await transaction.purchaseOrder.update({ where: { id: order.id }, data: { fulfillmentStatus, orderStatus, version: { increment: 1 } } })
        const reason = [...`确认 ${partIds.length} 个货件入仓${input.remark ? `；${input.remark}` : ''}`].slice(0, 500).join('')
        if (fulfillmentStatus !== order.fulfillmentStatus) {
          await transaction.purchaseOrderStatusHistory.create({ data: { purchaseOrderId: order.id, dimension: 'FULFILLMENT', fromStatus: order.fulfillmentStatus, toStatus: fulfillmentStatus, reason, changedByUserId: context.actorUserId } })
          await this.audit.record(transaction, { eventType: 'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, outcome: 'SUCCESS', targetType: 'PURCHASE_ORDER', targetId: order.id, metadata: { fromStatus: order.fulfillmentStatus, toStatus: fulfillmentStatus, source: 'WAREHOUSE_RECEIPT' } })
        }
        if (orderStatus !== order.orderStatus) {
          await transaction.purchaseOrderStatusHistory.create({ data: { purchaseOrderId: order.id, dimension: 'ORDER', fromStatus: order.orderStatus, toStatus: orderStatus, reason: '全部有效货件已入仓且已付清，系统自动完成采购订单', changedByUserId: context.actorUserId } })
          await this.audit.record(transaction, { eventType: 'PURCHASE_ORDER_ORDER_STATUS_CHANGED', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, outcome: 'SUCCESS', targetType: 'PURCHASE_ORDER', targetId: order.id, metadata: { automatic: true, fromStatus: order.orderStatus, toStatus: orderStatus, trigger: 'WAREHOUSE_RECEIPT' } })
        }
        if (order.purchaseType === 'SALES_LINKED' && order.salesOrderId !== null) {
          await advanceSalesOrderWhenAllShipmentsReceived(transaction, this.audit, { ...context, salesOrderId: order.salesOrderId })
        }
        await this.audit.record(transaction, {
          eventType: 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, outcome: 'SUCCESS', targetType: 'PURCHASE_ORDER', targetId: order.id,
          metadata: { partIds, requestFingerprint, expectedVersion: input.expectedVersion, source: input.partIds === null ? 'LEGACY_SIGNED' : 'SHIPMENT_SELECTION', receivedAt: receivedAt.toISOString(), recordedAt: recordedAt.toISOString(), remark: input.remark, fromStatus: order.fulfillmentStatus, toStatus: fulfillmentStatus },
        })
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

  private matchesReplay(metadata: Prisma.JsonValue, active: WarehouseOrder['parts'], actorUserId: string, input: WarehouseCommand): boolean {
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false
    if (metadata.expectedVersion !== input.expectedVersion || metadata.source !== (input.partIds === null ? 'LEGACY_SIGNED' : 'SHIPMENT_SELECTION')
      || (input.receivedAt !== null && metadata.receivedAt !== input.receivedAt) || metadata.remark !== input.remark) return false
    const ids = metadata.partIds
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 1000 || !ids.every(id => typeof id === 'string') || new Set(ids).size !== ids.length) return false
    if (input.partIds !== null && JSON.stringify([...ids].sort()) !== JSON.stringify(input.partIds)) return false
    if (input.partIds === null && active.some(part => part.warehouseReceivedAt === null)) return false
    return ids.every(id => {
      const part = active.find(candidate => candidate.id === id)
      return part !== undefined && part.warehouseReceivedAt !== null && part.warehouseRecordedAt !== null
        && part.warehouseReceivedById === actorUserId && part.warehouseRemark === input.remark
        && part.warehouseReceivedAt.toISOString() === metadata.receivedAt && part.warehouseRecordedAt.toISOString() === metadata.recordedAt
    })
  }

  private async lockOrder(transaction: Prisma.TransactionClient, orderId: string): Promise<WarehouseOrder> {
    const candidate = await transaction.purchaseOrder.findUnique({ where: { id: orderId }, select: { purchaseType: true, salesOrderId: true } })
    if (candidate === null) throw new ApiException(404, 'PURCHASE_ORDER_NOT_FOUND', '采购订单不存在')
    // 与工厂发货统一为“销售行 -> 同来源有效采购单 -> 销售主行 -> 货件”。
    // 入仓会同步销售履约，必须在持货件锁前锁销售主行，不能反向申请父锁。
    if (candidate.purchaseType === 'SALES_LINKED' && candidate.salesOrderId !== null) {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM sales_order_lines WHERE sales_order_id = ${candidate.salesOrderId}::uuid AND removed_at IS NULL ORDER BY id FOR UPDATE`)
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_orders WHERE id = ${orderId}::uuid OR (sales_order_id = ${candidate.salesOrderId}::uuid AND purchase_type = 'SALES_LINKED' AND order_status <> 'CANCELLED') ORDER BY id FOR UPDATE`)
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM sales_orders WHERE id = ${candidate.salesOrderId}::uuid FOR UPDATE`)
    }
    else await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_orders WHERE id = ${orderId}::uuid FOR UPDATE`)
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_order_parts WHERE purchase_order_id = ${orderId}::uuid ORDER BY id FOR UPDATE`)
    const order = await transaction.purchaseOrder.findUnique({ where: { id: orderId }, select: ORDER_SELECT })
    if (order === null) throw new ApiException(404, 'PURCHASE_ORDER_NOT_FOUND', '采购订单不存在')
    return order
  }
}
