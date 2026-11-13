import { createHash } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import type { SalesOrderFulfillmentStatus, SalesOrderStatus } from '../../../generated/prisma/enums'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import {
  hasPersistenceCode,
  readPersistenceErrorFacts,
} from '../../../infrastructure/database/persistence-error-facts'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AccessControlService } from '../../access-control/access-control.service'
import { DataScopeService } from '../../access-control/data-scope.service'
import { AuditService } from '../../audit/audit.service'
import { clearShipmentsContainerLoaded } from '../../container-batches/container-unload-fact'
import { readClaimedQuantitiesBySalesLine } from '../../sales-orders/sales-order-claim-coverage'
import { salesOrderScopeWhere } from '../../sales-orders/sales-order-access'
import { parsePurchaseOrderIdempotencyKey } from '../purchase-order-command.normalizer'
import { PurchaseOrderMutationService } from '../purchase-order-mutation.service'
import { SalesOrderPurchaseCoverageService } from '../sales-order-purchase-coverage.service'
import {
  lockSalesOrderChains,
  retreatSalesOrdersWhenShipmentsUnloaded,
} from '../shipments/sales-order-container-load-progress'
import {
  buildPurchaseCorrectionPlan,
  type PurchaseCorrectionContainerItemSnapshot,
  type PurchaseCorrectionPackagingSnapshot,
  type PurchaseCorrectionPaymentSnapshot,
  type PurchaseCorrectionPlan,
  type PurchaseCorrectionPurchaseSnapshot,
  type PurchaseCorrectionReconciliationSnapshot,
} from './purchase-correction-plan'
import type {
  PurchaseCorrectionCancelledOrderDto,
  PurchaseCorrectionContainerItemDto,
  PurchaseCorrectionContextDto,
  PurchaseCorrectionPackagingDto,
  PurchaseCorrectionPaymentDto,
  PurchaseCorrectionPurchaseDto,
  PurchaseCorrectionReconciliationDto,
  PurchaseCorrectionRequestDto,
  PurchaseCorrectionResultDto,
} from './purchase-correction.dto'

export interface PurchaseCorrectionContext {
  readonly actorUserId: string
  readonly requestId: string
}

interface LoadedCorrection {
  readonly order: {
    readonly id: string
    readonly orderNo: string
    readonly orderStatus: SalesOrderStatus
    readonly fulfillmentStatus: SalesOrderFulfillmentStatus
    readonly version: number
  }
  readonly purchases: readonly PurchaseCorrectionPurchaseDto[]
  readonly plan: PurchaseCorrectionPlan
  readonly loadedPartIds: readonly string[]
}

const CORRECTION_PAYMENT_SOURCE = 'PURCHASE_CHAIN_CORRECTION'
const CORRECTION_HISTORY_REASON = '误建采购链纠正，销售订单退回待采购'

function correctionFailure(
  code: string,
  message: string,
  status: number = HttpStatus.UNPROCESSABLE_ENTITY,
): never {
  throw new ApiException(status, code, message)
}

function stateChanged(): never {
  correctionFailure(
    'PURCHASE_CORRECTION_STATE_CHANGED',
    '纠正数据已变化，请刷新后重试',
    HttpStatus.CONFLICT,
  )
}

function normalizeText(value: string): string {
  return value.trim().normalize('NFKC')
}

function toPaymentDto(payment: PurchaseCorrectionPaymentSnapshot): PurchaseCorrectionPaymentDto {
  return {
    id: payment.id,
    purchaseOrderId: payment.purchaseOrderId,
    purchaseOrderNo: payment.purchaseOrderNo,
    paymentType: payment.paymentType,
    amount: payment.amount,
    paidAt: payment.paidAt.toISOString(),
    paymentMethod: payment.paymentMethod,
  }
}

function toPackagingDto(cost: {
  readonly id: string
  readonly purchaseOrderId: string
  readonly shipmentId: string
  readonly shipmentNo: string
  readonly amount: string
  readonly status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED'
}): PurchaseCorrectionPackagingDto {
  return {
    id: cost.id,
    purchaseOrderId: cost.purchaseOrderId,
    shipmentId: cost.shipmentId,
    shipmentNo: cost.shipmentNo,
    amount: cost.amount,
    status: cost.status,
  }
}

function toReconciliationDto(
  reconciliation: PurchaseCorrectionReconciliationSnapshot,
): PurchaseCorrectionReconciliationDto {
  return {
    id: reconciliation.id,
    batchNo: reconciliation.batchNo,
    completedAt: reconciliation.completedAt?.toISOString() ?? null,
  }
}

function toContainerItemDto(
  item: PurchaseCorrectionContainerItemSnapshot,
): PurchaseCorrectionContainerItemDto {
  return {
    id: item.id,
    shipmentId: item.shipmentId,
    containerBatchId: item.containerBatchId,
    containerBatchNo: item.containerBatchNo,
    hasChanges: item.hasChanges,
    reconciliations: item.reconciliations.map(toReconciliationDto),
  }
}

@Injectable()
export class PurchaseCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessControlService,
    private readonly scope: DataScopeService,
    private readonly mutations: PurchaseOrderMutationService,
    private readonly coverage: SalesOrderPurchaseCoverageService,
  ) {}

  async context(
    context: PurchaseCorrectionContext,
    salesOrderId: string,
  ): Promise<PurchaseCorrectionContextDto> {
    return this.prisma.$transaction(async (transaction) => {
      const loaded = await this.load(transaction, context, salesOrderId)
      return this.toContext(loaded)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }

  async apply(
    context: PurchaseCorrectionContext,
    input: PurchaseCorrectionRequestDto,
    rawKey: unknown,
  ): Promise<PurchaseCorrectionResultDto> {
    const requestKey = parsePurchaseOrderIdempotencyKey(rawKey)
    const reason = normalizeText(input.reason)
    if (reason.length === 0) {
      correctionFailure('VALIDATION_FAILED', '纠正原因不能为空')
    }
    const confirmOrderNo = normalizeText(input.confirmOrderNo)
    const purchaseOrders = [...input.purchaseOrders].sort((left, right) => (
      left.purchaseOrderId.localeCompare(right.purchaseOrderId)
    ))
    if (new Set(purchaseOrders.map(row => row.purchaseOrderId)).size !== purchaseOrders.length) {
      correctionFailure('VALIDATION_FAILED', '采购单版本明细不能重复')
    }
    const payloadHash = createHash('sha256').update(JSON.stringify({
      format: 'purchase-correction.v1',
      salesOrderId: input.salesOrderId,
      expectedSalesOrderVersion: input.expectedSalesOrderVersion,
      purchaseOrders,
      reason,
      confirmOrderNo,
    })).digest()

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const previous = await transaction.purchaseChainCorrection.findUnique({
          where: { actorUserId_requestKey: {
            actorUserId: context.actorUserId,
            requestKey,
          } },
        })
        if (previous !== null) {
          if (!Buffer.from(previous.payloadHash).equals(payloadHash)) {
            correctionFailure(
              'PURCHASE_CORRECTION_IDEMPOTENCY_CONFLICT',
              '该提交标识已用于不同的纠正内容',
              HttpStatus.CONFLICT,
            )
          }
          if (previous.appliedAt === null) {
            correctionFailure(
              'PURCHASE_CORRECTION_IN_PROGRESS',
              '同一纠正正在处理中，请刷新后重试',
              HttpStatus.CONFLICT,
            )
          }
          if (previous.resultSnapshot === null) stateChanged()
          return previous.resultSnapshot as unknown as PurchaseCorrectionResultDto
        }

        const scope = await this.scope.resolveInTransaction(transaction, context.actorUserId)
        const visible = await transaction.salesOrder.findFirst({
          where: { id: input.salesOrderId, ...salesOrderScopeWhere(scope, context.actorUserId) },
          select: { id: true },
        })
        if (visible === null) {
          throw new ApiException(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
        }

        // 与发货、入仓、装柜共用锁序：销售明细 -> 采购单 -> 销售主行 -> 货件/柜次。
        await lockSalesOrderChains(transaction, [input.salesOrderId])
        const loaded = await this.load(transaction, context, input.salesOrderId)
        if (loaded.order.version !== input.expectedSalesOrderVersion) stateChanged()
        const expected = new Map(purchaseOrders.map(row => [row.purchaseOrderId, row.expectedVersion]))
        if (
          loaded.purchases.length !== expected.size
          || loaded.purchases.some(purchase => expected.get(purchase.id) !== purchase.version)
        ) {
          stateChanged()
        }
        if (confirmOrderNo !== loaded.order.orderNo) {
          correctionFailure(
            'PURCHASE_CORRECTION_CONFIRMATION_MISMATCH',
            '销售单号确认不一致，请重新输入',
          )
        }
        const firstBlocker = loaded.plan.blockers[0]
        if (firstBlocker !== undefined) {
          correctionFailure(firstBlocker.code, firstBlocker.message)
        }

        if (loaded.plan.payments.length > 0) {
          const codes = await this.access.getPermissionCodesInTransaction(transaction, context.actorUserId)
          if (!this.access.hasAll(codes, ['purchase-orders:payment'])) {
            correctionFailure('FORBIDDEN', '权限不足', HttpStatus.FORBIDDEN)
          }
        }

        await this.lockCorrectionObjects(transaction, loaded)

        const correction = await transaction.purchaseChainCorrection.create({
          data: {
            salesOrderId: loaded.order.id,
            actorUserId: context.actorUserId,
            reason,
            requestKey,
            payloadHash,
          },
          select: { id: true },
        })
        await transaction.purchaseChainCorrectionOrder.createMany({
          data: loaded.purchases.map(purchase => ({
            correctionId: correction.id,
            purchaseOrderId: purchase.id,
          })),
        })

        for (const payment of loaded.plan.payments) {
          await this.mutations.voidPaymentInTransaction(
            transaction,
            context,
            payment.purchaseOrderId,
            payment.id,
            `误建采购链纠正：${reason}`,
            { source: CORRECTION_PAYMENT_SOURCE, correctionId: correction.id },
          )
        }

        for (const cost of loaded.plan.packagingCostsToCancel) {
          const updated = await transaction.packagingCostRequest.updateMany({
            where: { id: cost.id, status: 'PENDING_PAYMENT' },
            data: { status: 'CANCELLED', version: { increment: 1 } },
          })
          if (updated.count !== 1) stateChanged()
          await this.audit.record(transaction, {
            eventType: AuditEventType.PACKAGING_COST_CANCELLED,
            outcome: AuditOutcome.SUCCESS,
            actorType: AuditActorType.USER,
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            targetType: 'PACKAGING_COST_REQUEST',
            targetId: cost.id,
            metadata: {
              amount: cost.amount,
              correctionId: correction.id,
              shipmentNo: cost.shipmentNo,
              source: CORRECTION_PAYMENT_SOURCE,
            },
          })
        }

        for (const item of loaded.plan.containerItemsToDetach) {
          const previousShipmentId = item.shipmentId
          await transaction.containerLoadingItem.update({
            where: { id: item.id },
            data: {
              shipmentId: null,
              version: { increment: 1 },
              updatedById: context.actorUserId,
            },
          })
          await transaction.containerBatch.update({
            where: { id: item.containerBatchId },
            data: { version: { increment: 1 }, updatedById: context.actorUserId },
          })
          await this.audit.record(transaction, {
            eventType: AuditEventType.CONTAINER_LOADING_ITEM_UPDATED,
            outcome: AuditOutcome.SUCCESS,
            actorType: AuditActorType.USER,
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            targetType: 'CONTAINER_LOADING_ITEM',
            targetId: item.id,
            metadata: {
              containerBatchId: item.containerBatchId,
              correctionId: correction.id,
              previousShipmentId,
              shipmentId: null,
              source: CORRECTION_PAYMENT_SOURCE,
            },
          })
        }

        const loadedPartIds = loaded.loadedPartIds
        if (loadedPartIds.length > 0) {
          await clearShipmentsContainerLoaded(transaction, this.audit, {
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            containerBatchId: null,
            loadingItemId: null,
            shipmentIds: loadedPartIds,
            source: 'CORRECTION',
          })
          await retreatSalesOrdersWhenShipmentsUnloaded(transaction, this.audit, {
            actorUserId: context.actorUserId,
            containerBatchId: null,
            requestId: context.requestId,
            shipmentIds: loadedPartIds,
            salesOrderIds: [loaded.order.id],
            ignoreActiveDeliveryReceipt: true,
          })
        }

        for (const groupId of loaded.plan.loadGroupIds) {
          const group = await transaction.shipmentLoadGroup.findUnique({
            where: { id: groupId },
            select: { id: true, status: true, purchaseOrderId: true, members: { where: { active: true }, select: { shipmentId: true } } },
          })
          if (group === null || group.status !== 'ACTIVE') continue
          await transaction.shipmentLoadGroup.update({
            where: { id: groupId },
            data: {
              status: 'RELEASED',
              releasedAt: new Date(),
              releasedById: context.actorUserId,
              releaseReason: `误建采购链纠正：${reason}`,
              version: { increment: 1 },
            },
          })
          await transaction.shipmentLoadGroupMember.updateMany({
            where: { groupId, active: true },
            data: { active: false },
          })
          await this.audit.record(transaction, {
            eventType: AuditEventType.PURCHASE_SHIPMENT_LOAD_GROUP_RELEASED,
            outcome: AuditOutcome.SUCCESS,
            actorType: AuditActorType.USER,
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            targetType: 'SHIPMENT_LOAD_GROUP',
            targetId: groupId,
            metadata: {
              correctionId: correction.id,
              purchaseOrderId: group.purchaseOrderId,
              reason,
              shipmentIds: group.members.map(member => member.shipmentId).join(','),
            },
          })
        }

        const partIdsWithShippingFacts = loaded.plan.partIds
        // 触发器的纠正分支要求装柜事实已清空、签收事实为空；这里一次清空发货与到仓事实。
        await transaction.$executeRaw(Prisma.sql`
          UPDATE "purchase_order_parts"
          SET "shipped_at" = NULL,
              "shipped_by_id" = NULL,
              "shipment_recorded_at" = NULL,
              "shipment_remark" = NULL,
              "tracking_no" = NULL,
              "destination_warehouse_value" = NULL,
              "warehouse_received_at" = NULL,
              "warehouse_received_by_id" = NULL,
              "warehouse_recorded_at" = NULL,
              "warehouse_remark" = NULL
          WHERE "id" IN (${Prisma.join(partIdsWithShippingFacts.map(id => Prisma.sql`${id}::uuid`))})
            AND ("shipped_at" IS NOT NULL OR "warehouse_received_at" IS NOT NULL)
        `)

        for (const purchase of loaded.purchases) {
          await this.mutations.cancelForCorrection(
            transaction,
            context,
            purchase.id,
            `误建采购链纠正：${reason}`,
          )
        }

        const firstPurchase = loaded.purchases[0]
        if (firstPurchase === undefined) stateChanged()
        await this.coverage.recalculateAfterPurchaseCancellation(transaction, {
          actorUserId: context.actorUserId,
          purchaseOrderId: firstPurchase.id,
          purchaseOrderNo: firstPurchase.orderNo,
          requestId: context.requestId,
          salesOrderId: loaded.order.id,
          historyReason: CORRECTION_HISTORY_REASON,
          trigger: CORRECTION_PAYMENT_SOURCE,
        })

        const finalOrder = await transaction.salesOrder.findUnique({
          where: { id: loaded.order.id },
          select: { fulfillmentStatus: true },
        })
        if (finalOrder?.fulfillmentStatus !== 'PENDING') {
          stateChanged()
        }

        const result: PurchaseCorrectionResultDto = {
          correctionId: correction.id,
          salesOrderId: loaded.order.id,
          salesOrderNo: loaded.order.orderNo,
          fulfillmentStatus: 'PENDING',
          cancelledPurchaseOrders: loaded.purchases.map<PurchaseCorrectionCancelledOrderDto>(purchase => ({
            id: purchase.id,
            orderNo: purchase.orderNo,
          })),
          reversedPayments: loaded.plan.payments.map(toPaymentDto),
          totalReversedAmount: loaded.plan.totalPaymentAmount,
          cancelledPackagingCosts: loaded.plan.packagingCostsToCancel.map(toPackagingDto),
          detachedContainerItems: loaded.plan.containerItemsToDetach.map(toContainerItemDto),
          preservedReconciliations: loaded.plan.preservedReconciliations.map(toReconciliationDto),
        }

        await transaction.purchaseChainCorrection.update({
          where: { id: correction.id },
          data: {
            appliedAt: new Date(),
            resultSnapshot: result as unknown as Prisma.InputJsonValue,
          },
        })

        await this.audit.record(transaction, {
          eventType: AuditEventType.PURCHASE_ORDER_CORRECTION_APPLIED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'SALES_ORDER',
          targetId: loaded.order.id,
          metadata: {
            cancelledPurchaseOrderCount: loaded.purchases.length,
            correctionId: correction.id,
            detachedContainerItemCount: loaded.plan.containerItemsToDetach.length,
            paymentCount: loaded.plan.payments.length,
            preservedReconciliationCount: loaded.plan.preservedReconciliations.length,
            purchaseOrderNos: loaded.purchases.map(purchase => purchase.orderNo).join(','),
            reasonProvided: true,
            salesOrderNo: loaded.order.orderNo,
            totalReversedAmount: loaded.plan.totalPaymentAmount,
          },
        })

        return result
      }, { timeout: 60_000 })
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      const facts = readPersistenceErrorFacts(error)
      if (
        ['40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))
        || hasPersistenceCode(facts, '23514')
      ) {
        stateChanged()
      }
      throw error
    }
  }

  private async load(
    transaction: Prisma.TransactionClient,
    context: PurchaseCorrectionContext,
    salesOrderId: string,
  ): Promise<LoadedCorrection> {
    const scope = await this.scope.resolveInTransaction(transaction, context.actorUserId)
    const order = await transaction.salesOrder.findFirst({
      where: { id: salesOrderId, ...salesOrderScopeWhere(scope, context.actorUserId) },
      select: {
        id: true,
        orderNo: true,
        orderStatus: true,
        fulfillmentStatus: true,
        version: true,
        lines: { where: { removedAt: null }, select: { id: true, quantity: true } },
      },
    })
    if (order === null) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
    }

    const purchases = await transaction.purchaseOrder.findMany({
      where: {
        salesOrderId,
        purchaseType: 'SALES_LINKED',
        orderStatus: { not: 'CANCELLED' },
      },
      orderBy: { id: 'asc' },
      include: {
        parts: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: [{ partNumber: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            partNumber: true,
            shipmentNo: true,
            status: true,
            shippedAt: true,
            warehouseReceivedAt: true,
            loadedAt: true,
            deliveredAt: true,
            ownershipCurrent: { select: { ownerType: true, ownerSalesOrderId: true, state: true } },
            storageRecords: { select: { id: true }, take: 1 },
          },
        },
        payments: {
          where: { voidedAt: null },
          orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
          select: { id: true, amount: true, paymentType: true, paidAt: true, paymentMethod: true },
        },
      },
    })

    const partToPurchase = new Map<string, string>()
    for (const purchase of purchases) {
      for (const part of purchase.parts) partToPurchase.set(part.id, purchase.id)
    }
    // 包装费按采购单读取，而不是只读当前有效货件：已取消货件上的待付款提报
    // 同样会被提交时的延迟约束检查，必须先进入取消计划或阻断。
    const purchaseIds = purchases.map(purchase => purchase.id)
    const packagingRows = purchaseIds.length === 0
      ? []
      : await transaction.packagingCostRequest.findMany({
          where: { purchaseOrderId: { in: purchaseIds } },
          select: { id: true, purchaseOrderId: true, shipmentId: true, shipmentNo: true, amount: true, status: true },
        })
    const packagingByPurchase = new Map<string, PurchaseCorrectionPackagingSnapshot[]>()
    for (const cost of packagingRows) {
      const rows = packagingByPurchase.get(cost.purchaseOrderId) ?? []
      rows.push({
        id: cost.id,
        purchaseOrderId: cost.purchaseOrderId,
        shipmentId: cost.shipmentId,
        shipmentNo: cost.shipmentNo,
        amount: cost.amount.toFixed(2),
        status: cost.status,
      })
      packagingByPurchase.set(cost.purchaseOrderId, rows)
    }
    const partIds = [...partToPurchase.keys()]
    const containerItems = partIds.length === 0
      ? []
      : await transaction.containerLoadingItem.findMany({
          where: { shipmentId: { in: partIds } },
          select: {
            id: true,
            shipmentId: true,
            containerBatchId: true,
            containerBatch: { select: { containerBatchNo: true } },
            changes: { select: { id: true }, take: 1 },
            reconciliationBatchLines: {
              select: { batch: { select: { id: true, batchNo: true, completedAt: true } } },
            },
          },
        })
    const itemsByPurchase = new Map<string, PurchaseCorrectionContainerItemSnapshot[]>()
    for (const item of containerItems) {
      if (item.shipmentId === null) continue
      const purchaseId = partToPurchase.get(item.shipmentId)
      if (purchaseId === undefined) continue
      const rows = itemsByPurchase.get(purchaseId) ?? []
      rows.push({
        id: item.id,
        shipmentId: item.shipmentId,
        containerBatchId: item.containerBatchId,
        containerBatchNo: item.containerBatch.containerBatchNo,
        hasChanges: item.changes.length > 0,
        reconciliations: item.reconciliationBatchLines.map(line => line.batch),
      })
      itemsByPurchase.set(purchaseId, rows)
    }

    const groupRows = partIds.length === 0
      ? []
      : await transaction.shipmentLoadGroupMember.findMany({
          where: { shipmentId: { in: partIds }, active: true, group: { status: 'ACTIVE' } },
          select: {
            shipmentId: true,
            group: {
              select: {
                id: true,
                version: true,
                members: { where: { active: true }, select: { shipmentId: true } },
              },
            },
          },
        })
    const groupsByPurchase = new Map<string, {
      readonly id: string
      readonly version: number
      readonly memberShipmentIds: readonly string[]
    }[]>()
    const seenGroups = new Set<string>()
    for (const row of groupRows) {
      if (seenGroups.has(row.group.id)) continue
      const purchaseId = partToPurchase.get(row.shipmentId)
      if (purchaseId === undefined) continue
      seenGroups.add(row.group.id)
      const rows = groupsByPurchase.get(purchaseId) ?? []
      rows.push({
        id: row.group.id,
        version: row.group.version,
        memberShipmentIds: row.group.members.map(member => member.shipmentId),
      })
      groupsByPurchase.set(purchaseId, rows)
    }

    const claimedQuantities = await readClaimedQuantitiesBySalesLine(
      transaction,
      salesOrderId,
      order.lines.map(line => line.id),
    )

    const purchaseSnapshots: PurchaseCorrectionPurchaseSnapshot[] = purchases.map(purchase => ({
      id: purchase.id,
      orderNo: purchase.orderNo,
      orderStatus: purchase.orderStatus,
      fulfillmentStatus: purchase.fulfillmentStatus,
      paymentStatus: purchase.paymentStatus,
      version: purchase.version,
      parts: purchase.parts.map(part => ({
        id: part.id,
        partNumber: part.partNumber,
        shipmentNo: part.shipmentNo,
        status: part.status,
        shippedAt: part.shippedAt,
        warehouseReceivedAt: part.warehouseReceivedAt,
        loadedAt: part.loadedAt,
        deliveredAt: part.deliveredAt,
        storageRecordCount: part.storageRecords.length,
        ownership: part.ownershipCurrent === null
          ? null
          : {
              ownerType: part.ownershipCurrent.ownerType,
              ownerSalesOrderId: part.ownershipCurrent.ownerSalesOrderId,
              state: part.ownershipCurrent.state,
            },
      })),
      payments: purchase.payments.map(payment => ({
        id: payment.id,
        purchaseOrderId: purchase.id,
        purchaseOrderNo: purchase.orderNo,
        paymentType: payment.paymentType,
        amount: payment.amount.toFixed(2),
        paidAt: payment.paidAt,
        paymentMethod: payment.paymentMethod ?? null,
      })),
      packagingCosts: packagingByPurchase.get(purchase.id) ?? [],
      containerItems: itemsByPurchase.get(purchase.id) ?? [],
      loadGroups: groupsByPurchase.get(purchase.id) ?? [],
    }))

    const plan = buildPurchaseCorrectionPlan({
      order: {
        id: order.id,
        orderNo: order.orderNo,
        orderStatus: order.orderStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        version: order.version,
      },
      purchases: purchaseSnapshots,
      claimedQuantities,
    })

    return {
      order: {
        id: order.id,
        orderNo: order.orderNo,
        orderStatus: order.orderStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        version: order.version,
      },
      purchases: purchases.map(purchase => ({
        id: purchase.id,
        orderNo: purchase.orderNo,
        orderStatus: purchase.orderStatus,
        fulfillmentStatus: purchase.fulfillmentStatus,
        paymentStatus: purchase.paymentStatus,
        version: purchase.version,
      })),
      plan,
      loadedPartIds: purchaseSnapshots
        .flatMap(purchase => purchase.parts)
        .filter(part => part.loadedAt !== null)
        .map(part => part.id),
    }
  }

  private async lockCorrectionObjects(
    transaction: Prisma.TransactionClient,
    loaded: LoadedCorrection,
  ): Promise<void> {
    if (loaded.plan.partIds.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "purchase_order_parts"
        WHERE "id" IN (${Prisma.join(loaded.plan.partIds.map(id => Prisma.sql`${id}::uuid`))})
        ORDER BY "id" FOR UPDATE
      `)
    }
    if (loaded.plan.containerItemsToDetach.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "container_loading_items"
        WHERE "id" IN (${Prisma.join(loaded.plan.containerItemsToDetach.map(item => Prisma.sql`${item.id}::uuid`))})
        ORDER BY "id" FOR UPDATE
      `)
    }
    if (loaded.plan.loadGroupIds.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "shipment_load_groups"
        WHERE "id" IN (${Prisma.join(loaded.plan.loadGroupIds.map(id => Prisma.sql`${id}::uuid`))})
        ORDER BY "id" FOR UPDATE
      `)
    }
    if (loaded.plan.packagingCostsToCancel.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "packaging_cost_requests"
        WHERE "id" IN (${Prisma.join(loaded.plan.packagingCostsToCancel.map(cost => Prisma.sql`${cost.id}::uuid`))})
        ORDER BY "id" FOR UPDATE
      `)
    }
  }

  private toContext(loaded: LoadedCorrection): PurchaseCorrectionContextDto {
    return {
      salesOrderId: loaded.order.id,
      salesOrderNo: loaded.order.orderNo,
      orderStatus: loaded.order.orderStatus,
      fulfillmentStatus: loaded.order.fulfillmentStatus,
      version: loaded.order.version,
      purchaseOrders: [...loaded.purchases],
      payments: loaded.plan.payments.map(toPaymentDto),
      totalPaymentAmount: loaded.plan.totalPaymentAmount,
      packagingCosts: loaded.plan.packagingCostsToCancel.map(toPackagingDto),
      containerItems: loaded.plan.containerItemsToDetach.map(toContainerItemDto),
      preservedReconciliations: loaded.plan.preservedReconciliations.map(toReconciliationDto),
      blockers: loaded.plan.blockers.map(blocker => ({
        code: blocker.code,
        message: blocker.message,
        targetType: blocker.targetType,
        targetId: blocker.targetId,
      })),
      canApply: loaded.plan.canApply,
    }
  }
}
