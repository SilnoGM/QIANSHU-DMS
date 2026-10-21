import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback } from '../../access-control/data-scope.service'
import { AuditService } from '../../audit/audit.service'
import type { SalesOrderShipmentSignOutcome, ShipmentDeliveryContext } from '../../sales-orders/sales-order-shipment-delivery'
import {
  autoSignSalesOrderWhenAllShipmentsDelivered,
  readSalesOrderShipmentDeliveryState,
} from '../../sales-orders/sales-order-shipment-delivery'
import { SalesOrderAutomaticStateService } from '../../sales-orders/sales-order-automatic-state.service'
import { purchaseOrderRuleFailure } from '../domain/purchase-order-errors'
import { purchaseOrderPartScopeWhere } from '../purchase-order-access'
import type { PurchaseShipmentDeliverRequestDto, PurchaseShipmentDeliverResultDto } from './purchase-shipment.dto'
import { PurchaseShipmentQueryService } from './purchase-shipment-query.service'

const PART_LOCK_SELECT = {
  id: true,
  status: true,
  loadedAt: true,
  deliveredAt: true,
  purchaseOrderId: true,
  shipmentNo: true,
  partNumber: true,
  purchaseOrder: { select: {
    id: true,
    purchaseType: true,
    orderStatus: true,
    salesOrderId: true,
  } },
} as const satisfies Prisma.PurchaseOrderPartSelect

const STOCK_SIGNED_OUTCOME: SalesOrderShipmentSignOutcome = {
  salesOrderSigned: false,
  remainingShipmentCount: 0,
  salesOrderReceiptRequired: false,
}

function notAllowed(message: string): never {
  return purchaseOrderRuleFailure('PURCHASE_SHIPMENT_DELIVERY_NOT_ALLOWED', message)
}

function stateChanged(): never {
  throw new ApiException(
    HttpStatus.CONFLICT,
    'PURCHASE_SHIPMENT_DELIVERY_STATE_CHANGED',
    '货件签收状态已变化，请刷新后重试',
  )
}

/**
 * 货件签收先锁销售订单、再锁货件，与装柜和入仓的锁序一致。
 * 签收事实写入与订单自动签收在同一事务提交；销售订单已签收时货件必然已全部签收。
 */
@Injectable()
export class PurchaseShipmentDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queries: PurchaseShipmentQueryService,
    private readonly automaticState: SalesOrderAutomaticStateService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async deliver(
    context: ShipmentDeliveryContext,
    partId: string,
    input: PurchaseShipmentDeliverRequestDto,
  ): Promise<PurchaseShipmentDeliverResultDto> {
    const remark = input.remark == null
      ? null
      : input.remark.trim().normalize('NFKC') || null

    const outcome = await this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      const scope = await this.dataScope.resolveInTransaction(
        transaction,
        context.actorUserId,
      )
      const candidate = await transaction.purchaseOrderPart.findFirst({
        where: { id: partId, ...purchaseOrderPartScopeWhere(scope, context.actorUserId) },
        select: PART_LOCK_SELECT,
      })
      if (candidate === null) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'PURCHASE_ORDER_PART_NOT_FOUND',
          '采购货件不存在',
        )
      }

      const salesOrderId = candidate.purchaseOrder.purchaseType === 'SALES_LINKED'
        ? candidate.purchaseOrder.salesOrderId
        : null
      let lockedOrder: {
        readonly orderStatus: string
        readonly fulfillmentStatus: string
      } | null = null
      if (salesOrderId !== null) {
        const rows = await transaction.$queryRaw<Array<{
          readonly orderStatus: string
          readonly fulfillmentStatus: string
        }>>(Prisma.sql`
          SELECT "order_status"::text AS "orderStatus",
                 "fulfillment_status"::text AS "fulfillmentStatus"
          FROM "sales_orders"
          WHERE "id" = CAST(${salesOrderId} AS uuid)
          FOR UPDATE
        `)
        if (rows.length !== 1) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            'PURCHASE_ORDER_PART_NOT_FOUND',
            '采购货件不存在',
          )
        }
        lockedOrder = rows[0]!
      }

      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "purchase_order_parts"
        WHERE "id" = CAST(${partId} AS uuid)
        FOR UPDATE
      `)
      const part = await transaction.purchaseOrderPart.findUnique({
        where: { id: partId },
        select: PART_LOCK_SELECT,
      })
      if (part === null || part.purchaseOrder.orderStatus === 'CANCELLED') {
        return notAllowed('已取消采购单的货件不能签收')
      }
      if (part.status !== 'ACTIVE') {
        return notAllowed('只有有效货件可以签收')
      }
      if (part.loadedAt === null) {
        return notAllowed('货件尚未装柜，不能签收')
      }

      if (lockedOrder !== null && salesOrderId !== null) {
        if (lockedOrder.orderStatus === 'CANCELLED') {
          return notAllowed('已取消销售订单不能签收货件')
        }
        const state = await readSalesOrderShipmentDeliveryState(transaction, salesOrderId)
        if (state.pendingReviewPartIds.length > 0) {
          return notAllowed('销售订单下仍有待审核货件，不能签收货件')
        }
        if (part.deliveredAt !== null) {
          // 重复签收保持幂等；顺带补齐可能缺失的订单自动签收。
          return autoSignSalesOrderWhenAllShipmentsDelivered(
            transaction,
            this.audit,
            this.automaticState,
            context,
            salesOrderId,
            partId,
          )
        }
        if (
          lockedOrder.orderStatus !== 'CONFIRMED'
          || lockedOrder.fulfillmentStatus !== 'SEA_TRANSIT'
        ) {
          return notAllowed('销售订单当前不处于待签收状态，不能签收货件')
        }
      }
      else if (part.deliveredAt !== null) {
        return STOCK_SIGNED_OUTCOME
      }

      const recordedAt = new Date()
      const updated = await transaction.purchaseOrderPart.updateMany({
        where: {
          id: partId,
          status: 'ACTIVE',
          loadedAt: { not: null },
          deliveredAt: null,
        },
        data: {
          deliveredAt: recordedAt,
          deliveredById: context.actorUserId,
          deliveredRecordedAt: recordedAt,
          deliveryRemark: remark,
        },
      })
      if (updated.count !== 1) return stateChanged()

      await this.audit.record(transaction, {
        eventType: 'PURCHASE_SHIPMENT_DELIVERED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'PURCHASE_ORDER_PART',
        targetId: partId,
        metadata: {
          purchaseOrderId: part.purchaseOrderId,
          salesOrderId,
          deliveredAt: recordedAt.toISOString(),
          recordedAt: recordedAt.toISOString(),
          remark,
          source: 'SHIPMENT_SIGN',
        },
      })

      if (salesOrderId !== null) {
        return autoSignSalesOrderWhenAllShipmentsDelivered(
          transaction,
          this.audit,
          this.automaticState,
          context,
          salesOrderId,
          partId,
        )
      }
      return STOCK_SIGNED_OUTCOME
    }, { timeout: 30_000 })

    const shipment = await this.queries.getById(partId, context.actorUserId)
    return { shipment, ...outcome }
  }
}
