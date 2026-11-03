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
import { resolveLoadGroupMembership } from './shipment-load-group.resolver'

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
  ownershipCurrent: { select: { ownerType: true, ownerSalesOrderId: true } },
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

      const salesOrderId = candidate.ownershipCurrent?.ownerType === 'SALES_ORDER'
        ? candidate.ownershipCurrent.ownerSalesOrderId
        : null
      // 签收是同票联动：先锁组头，随后按货件 ID 排序锁全部成员，避免只签主货件。
      const loadGroup = await resolveLoadGroupMembership(transaction, partId)
      const groupMemberIds = loadGroup === null ? [] : loadGroup.memberShipmentIds.filter(id => id !== partId)
      if (loadGroup !== null) {
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM shipment_load_groups WHERE id = ${loadGroup.id}::uuid FOR UPDATE`)
      }
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
        WHERE "id" IN (${Prisma.join([partId, ...groupMemberIds].map(id => Prisma.sql`${id}::uuid`))})
        ORDER BY "id"
        FOR UPDATE
      `)
      const part = await transaction.purchaseOrderPart.findUnique({
        where: { id: partId },
        select: PART_LOCK_SELECT,
      })
      if (part === null) {
        return notAllowed('采购货件不存在')
      }
      const groupParts = groupMemberIds.length === 0
        ? []
        : await transaction.purchaseOrderPart.findMany({
            where: { id: { in: groupMemberIds } },
            select: PART_LOCK_SELECT,
          })
      const signingParts = [part, ...groupParts]
      for (const member of signingParts) {
        if (member.purchaseOrder.orderStatus === 'CANCELLED') {
          return notAllowed('已取消采购单的货件不能签收')
        }
        if (member.status !== 'ACTIVE') {
          return notAllowed('只有有效货件可以签收')
        }
        if (member.loadedAt === null) {
          return notAllowed('货件尚未装柜，不能签收')
        }
        // 寄仓中的货件归属已转出销售单，物流动作冻结到认领为止。
        if (member.ownershipCurrent?.ownerType === 'STORAGE_POOL') {
          return notAllowed('寄仓中的货件不能签收')
        }
      }
      if (
        loadGroup !== null
        && signingParts.some(member => member.ownershipCurrent?.ownerType !== 'SALES_ORDER'
          || member.ownershipCurrent.ownerSalesOrderId !== salesOrderId)
      ) {
        return notAllowed('同票货件的销售归属已变化，请刷新后重试')
      }
      const undeliveredIds = signingParts
        .filter(member => member.deliveredAt === null)
        .map(member => member.id)

      if (lockedOrder !== null && salesOrderId !== null) {
        if (lockedOrder.orderStatus === 'CANCELLED') {
          return notAllowed('已取消销售订单不能签收货件')
        }
        const state = await readSalesOrderShipmentDeliveryState(transaction, salesOrderId)
        if (state.pendingReviewPartIds.length > 0) {
          return notAllowed('销售订单下仍有待审核货件，不能签收货件')
        }
        if (undeliveredIds.length === 0) {
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
      else if (undeliveredIds.length === 0) {
        return STOCK_SIGNED_OUTCOME
      }

      const recordedAt = new Date()
      const updated = await transaction.purchaseOrderPart.updateMany({
        where: {
          id: { in: undeliveredIds },
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
      if (updated.count !== undeliveredIds.length) return stateChanged()

      const signingById = new Map(signingParts.map(member => [member.id, member]))
      for (const memberId of undeliveredIds) {
        const member = signingById.get(memberId)!
        await this.audit.record(transaction, {
          eventType: 'PURCHASE_SHIPMENT_DELIVERED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'PURCHASE_ORDER_PART',
          targetId: memberId,
          metadata: {
            purchaseOrderId: member.purchaseOrderId,
            salesOrderId,
            deliveredAt: recordedAt.toISOString(),
            recordedAt: recordedAt.toISOString(),
            remark,
            source: 'SHIPMENT_SIGN',
            loadGroupId: loadGroup?.id ?? null,
          },
        })
      }

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
