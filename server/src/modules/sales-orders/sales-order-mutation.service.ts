import { assertReceiptCapacity, receiptFailure } from './receipts/sales-receipt-money'
import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  type SalesOrderFulfillmentStatus,
  type SalesOrderPaymentStatus,
  type SalesOrderStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  DictionaryLookupService,
} from '../dictionaries/dictionary-lookup.service'
import {
  MediaAssetService,
} from '../media/media-asset.service'
import {
  deriveSalesOrderPaymentStatus,
  validateSalesOrderAgreedAmounts,
} from './domain/sales-order-decimal'
import {
  salesOrderRuleFailure,
  salesOrderValidationFailure,
} from './domain/sales-order-errors'
import {
  assertSalesOrderFulfillmentTransition,
  assertSalesOrderStatusTransition,
} from './domain/sales-order-state-machine'
import { isCanonicalSalesOrderActorId } from './sales-order-command.normalizer'
import { SalesOrderAutomaticStateService } from './sales-order-automatic-state.service'
import {
  assertSalesOrderPurchaseFulfillment,
  lockSalesOrderPurchaseDependencies,
} from './sales-order-purchase-fulfillment'
import {
  SalesOrderQueryService,
  type SalesOrderDetail,
} from './sales-order-query.service'

const ORDER_STATUSES = new Set<SalesOrderStatus>([
  'DRAFT',
  'CONFIRMED',
  'PENDING_RECONCILIATION',
  'COMPLETED',
  'CANCELLED',
])
const FULFILLMENT_STATUSES = new Set<SalesOrderFulfillmentStatus>([
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
  'SEA_TRANSIT',
  'SIGNED',
])
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export interface SalesOrderMutationContext {
  readonly actorUserId: string
  readonly requestId: string
}

interface SalesOrderMutationDependencies {
  readonly now: () => Date
}

const DEFAULT_DEPENDENCIES: SalesOrderMutationDependencies = {
  now: () => new Date(),
}

const SALES_ORDER_MUTATION_DEPENDENCIES = Symbol(
  'qianshu.sales-order.mutation-dependencies',
)

type MutableOrderRow = Prisma.SalesOrderGetPayload<{
  select: {
    id: true
    orderStatus: true
    fulfillmentStatus: true
    paymentStatus: true
    currencyCode: true
    currency: { select: { symbol: true, minorUnit: true } }
    lineSubtotalAmount: true
    agreedTotalAmount: true
    depositDueAmount: true
    balanceDueAmount: true
    customerName: true
    version: true
  }
}>

function validateContext(
  context: SalesOrderMutationContext,
): SalesOrderMutationContext {
  if (
    !isCanonicalSalesOrderActorId(context.actorUserId)
    || typeof context.requestId !== 'string'
    || context.requestId.length < 1
    || [...context.requestId].length > 64
  ) {
    throw new ApiException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      '服务器内部错误',
    )
  }
  return context
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return salesOrderValidationFailure(field, '必须是规范的小写 UUID v4')
  }
  return value
}

function requireRecord(
  value: unknown,
  field = 'body',
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return salesOrderValidationFailure(field)
  }
  return value as Readonly<Record<string, unknown>>
}

function requireText(
  value: unknown,
  field: string,
  maximum: number,
): string {
  if (typeof value !== 'string') return salesOrderValidationFailure(field)
  const normalized = value.trim().normalize('NFKC')
  if ([...normalized].length < 1 || [...normalized].length > maximum) {
    return salesOrderValidationFailure(field)
  }
  return normalized
}

function optionalText(
  value: unknown,
  field: string,
  maximum: number,
): string | null {
  return value === null || value === undefined
    ? null
    : requireText(value, field, maximum)
}

function fixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function effectiveReceivedAmount(
  aggregate: { readonly _sum: { readonly amount: { toFixed(decimalPlaces: number): string } | null } },
): string {
  return aggregate._sum.amount === null ? '0.0000' : fixed4(aggregate._sum.amount)
}

/**
 * 变更原因属于需要长期留存的业务快照，因此直接使用订单当时关联的货币符号与
 * 小数位规则生成文本。这里全程处理十进制字符串，不转成 number，避免大金额
 * 在添加千分位时发生精度损失。
 */
@Injectable()
export class SalesOrderMutationService {
  private readonly dependencies: SalesOrderMutationDependencies

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mediaAsset: MediaAssetService,
    private readonly dictionaryLookup: DictionaryLookupService,
    private readonly query: SalesOrderQueryService,
    private readonly automaticState: SalesOrderAutomaticStateService,
    @Optional()
    @Inject(SALES_ORDER_MUTATION_DEPENDENCIES)
    dependencyOverrides: Partial<SalesOrderMutationDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  async updateOrderStatus(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    const trusted = validateContext(context)
    const salesOrderId = requireUuid(rawSalesOrderId, 'salesOrderId')
    const body = requireRecord(input)
    if (
      typeof body.toStatus !== 'string'
      || !ORDER_STATUSES.has(body.toStatus as SalesOrderStatus)
    ) {
      return salesOrderValidationFailure('toStatus')
    }
    const toStatus = body.toStatus as SalesOrderStatus
    // 已完成是派生态：只由自动状态服务在「对账已完结」时推进，手工入口一律拒绝。
    if (toStatus === 'COMPLETED') {
      return salesOrderRuleFailure(
        'SALES_ORDER_COMPLETION_IS_AUTOMATIC',
        '已完成由系统在对账完成后自动推进，不支持手动设置',
      )
    }
    const reason = optionalText(body.reason, 'reason', 500)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const order = await this.lockOrder(transaction, salesOrderId)
      const receivedAmount = await this.readReceivedAmount(transaction, salesOrderId)
      if (toStatus === 'CANCELLED' && await transaction.salesReceiptRequest.count({ where: { salesOrderId, status: 'PENDING_REVIEW' } }) > 0) {
        receiptFailure('SALES_RECEIPT_STATE_CHANGED', '订单仍有待审核收款，请先处理申请', HttpStatus.CONFLICT)
      }
      assertSalesOrderStatusTransition(order.orderStatus, toStatus, {
        activeReceivedAmount: receivedAmount,
        fulfillmentStatus: order.fulfillmentStatus,
        paymentStatus: order.paymentStatus,
      })
      await transaction.salesOrder.update({
        where: { id: salesOrderId },
        data: { orderStatus: toStatus, version: { increment: 1 } },
      })
      await transaction.salesOrderStatusHistory.create({ data: {
        salesOrderId,
        dimension: 'ORDER',
        fromStatus: order.orderStatus,
        toStatus,
        reason,
        changedByUserId: trusted.actorUserId,
      } })
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.SALES_ORDER_ORDER_STATUS_CHANGED,
        targetId: salesOrderId,
        metadata: { fromStatus: order.orderStatus, toStatus },
      })
    })
    return this.query.getById(salesOrderId)
  }

  async updateFulfillmentStatus(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    const trusted = validateContext(context)
    const salesOrderId = requireUuid(rawSalesOrderId, 'salesOrderId')
    const body = requireRecord(input)
    if (
      typeof body.toStatus !== 'string'
      || !FULFILLMENT_STATUSES.has(
        body.toStatus as SalesOrderFulfillmentStatus,
      )
    ) {
      return salesOrderValidationFailure('toStatus')
    }
    const toStatus = body.toStatus as SalesOrderFulfillmentStatus
    const reason = optionalText(body.reason, 'reason', 500)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      if (toStatus === 'PREPARING' || toStatus === 'LAND_TRANSIT') {
        await lockSalesOrderPurchaseDependencies(transaction, salesOrderId)
      }
      const order = await this.lockOrder(transaction, salesOrderId)
      if (order.orderStatus === 'CANCELLED') {
        return salesOrderRuleFailure(
          'SALES_ORDER_CANCELLED',
          '已取消订单不能继续履约',
        )
      }
      if (order.orderStatus === 'COMPLETED') {
        return salesOrderRuleFailure(
          'SALES_ORDER_COMPLETED',
          '已完成订单不能继续履约',
        )
      }
      const receiptCount = toStatus === 'SIGNED'
        ? await transaction.salesOrderDocument.count({
            where: {
              salesOrderId,
              documentType: 'DELIVERY_RECEIPT',
              detachedAt: null,
            },
          })
        : 0
      assertSalesOrderFulfillmentTransition(
        order.fulfillmentStatus,
        toStatus,
        { hasActiveDeliveryReceipt: receiptCount > 0 },
      )
      if (toStatus === 'PREPARING' || toStatus === 'LAND_TRANSIT') {
        await assertSalesOrderPurchaseFulfillment(transaction, salesOrderId, toStatus)
      }
      await transaction.salesOrder.update({
        where: { id: salesOrderId },
        data: { fulfillmentStatus: toStatus, version: { increment: 1 } },
      })
      await transaction.salesOrderStatusHistory.create({ data: {
        salesOrderId,
        dimension: 'FULFILLMENT',
        fromStatus: order.fulfillmentStatus,
        toStatus,
        reason,
        changedByUserId: trusted.actorUserId,
      } })
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.SALES_ORDER_FULFILLMENT_STATUS_CHANGED,
        targetId: salesOrderId,
        metadata: { fromStatus: order.fulfillmentStatus, toStatus },
      })
      // 在同一事务内重新读取更新后的三个状态维度，避免调用方凭旧快照判断。
      await this.automaticState.advanceWhenEligible(
        transaction,
        trusted,
        salesOrderId,
        'FULFILLMENT',
      )
    })
    return this.query.getById(salesOrderId)
  }

  async updatePaymentTerms(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    const trusted = validateContext(context)
    const salesOrderId = requireUuid(rawSalesOrderId, 'salesOrderId')
    const body = requireRecord(input)
    const reason = requireText(body.reason, 'reason', 500)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const order = await this.lockOrder(transaction, salesOrderId)
      if (order.orderStatus !== 'CONFIRMED') {
        return salesOrderRuleFailure(
          'SALES_ORDER_PAYMENT_TERMS_NOT_EDITABLE',
          '只有已确认订单可以修改约定收款',
        )
      }
      const amounts = validateSalesOrderAgreedAmounts({
        lineSubtotalAmount: fixed4(order.lineSubtotalAmount),
        agreedTotalAmount: body.agreedTotalAmount,
        depositDueAmount: body.depositDueAmount,
        balanceDueAmount: body.balanceDueAmount,
      })
      const receivedAmount = await this.readReceivedAmount(transaction, salesOrderId)
      const pending = await transaction.salesReceiptRequest.aggregate({ where: { salesOrderId, status: 'PENDING_REVIEW' }, _sum: { amount: true } })
      assertReceiptCapacity(amounts.agreedTotalAmount, receivedAmount, pending._sum.amount?.toFixed(4) ?? '0.0000')
      const newPaymentStatus = deriveSalesOrderPaymentStatus(
        amounts.agreedTotalAmount,
        receivedAmount,
      )
      await transaction.salesOrderAmountRevision.create({ data: {
        salesOrderId,
        oldLineSubtotalAmount: fixed4(order.lineSubtotalAmount),
        oldAgreedTotalAmount: fixed4(order.agreedTotalAmount),
        oldDepositDueAmount: fixed4(order.depositDueAmount),
        oldBalanceDueAmount: fixed4(order.balanceDueAmount),
        newLineSubtotalAmount: amounts.lineSubtotalAmount,
        newAgreedTotalAmount: amounts.agreedTotalAmount,
        newDepositDueAmount: amounts.depositDueAmount,
        newBalanceDueAmount: amounts.balanceDueAmount,
        reason,
        changedByUserId: trusted.actorUserId,
      } })
      await transaction.salesOrder.update({
        where: { id: salesOrderId },
        data: {
          agreedTotalAmount: amounts.agreedTotalAmount,
          depositDueAmount: amounts.depositDueAmount,
          balanceDueAmount: amounts.balanceDueAmount,
          paymentStatus: newPaymentStatus,
          version: { increment: 1 },
        },
      })
      if (newPaymentStatus !== order.paymentStatus) {
        await transaction.salesOrderStatusHistory.create({ data: {
          salesOrderId,
          dimension: 'PAYMENT',
          fromStatus: order.paymentStatus,
          toStatus: newPaymentStatus,
          reason: '修改付款约定后系统重新计算付款状态',
          changedByUserId: trusted.actorUserId,
        } })
      }
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.SALES_ORDER_PAYMENT_TERMS_UPDATED,
        targetId: salesOrderId,
        metadata: { reasonProvided: true },
      })
      await this.automaticState.advanceWhenEligible(
        transaction,
        trusted,
        salesOrderId,
        'PAYMENT_TERMS',
      )
    })
    return this.query.getById(salesOrderId)
  }

  recordPayment(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    void context
    void rawSalesOrderId
    void input
    return Promise.reject(new ApiException(HttpStatus.CONFLICT, 'SALES_ORDER_RECEIPT_REVIEW_REQUIRED', '收款必须提交财务审核，请刷新后重试'))
  }

  voidPayment(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    rawPaymentId: unknown,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    void context
    void rawSalesOrderId
    void rawPaymentId
    void input
    return Promise.reject(new ApiException(HttpStatus.CONFLICT, 'SALES_ORDER_RECEIPT_REVIEW_REQUIRED', '请通过财务纠错入口作废正式收款'))
  }

  private async lockOrder(
    transaction: Prisma.TransactionClient,
    salesOrderId: string,
  ): Promise<MutableOrderRow> {
    const locks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "sales_orders"
      WHERE "id" = CAST(${salesOrderId} AS uuid)
      FOR UPDATE
    `)
    if (locks.length !== 1) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SALES_ORDER_NOT_FOUND',
        '销售订单不存在',
      )
    }
    const order = await transaction.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        id: true,
        orderStatus: true,
        fulfillmentStatus: true,
        paymentStatus: true,
        currencyCode: true,
        currency: { select: { symbol: true, minorUnit: true } },
        lineSubtotalAmount: true,
        agreedTotalAmount: true,
        depositDueAmount: true,
        balanceDueAmount: true,
        customerName: true,
        version: true,
      },
    })
    if (order === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SALES_ORDER_NOT_FOUND',
        '销售订单不存在',
      )
    }
    return order
  }

  private async readReceivedAmount(
    transaction: Prisma.TransactionClient,
    salesOrderId: string,
  ): Promise<string> {
    const aggregate = await transaction.salesOrderPayment.aggregate({
      where: { salesOrderId, voidedAt: null },
      _sum: { amount: true },
    })
    return effectiveReceivedAmount(aggregate)
  }

  private async writePaymentStatus(
    transaction: Prisma.TransactionClient,
    context: SalesOrderMutationContext,
    order: MutableOrderRow,
    newStatus: SalesOrderPaymentStatus,
    reason: string | null = null,
  ): Promise<void> {
    await transaction.salesOrder.update({
      where: { id: order.id },
      data: { paymentStatus: newStatus, version: { increment: 1 } },
    })
    if (newStatus === order.paymentStatus) return
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId: order.id,
      dimension: 'PAYMENT',
      fromStatus: order.paymentStatus,
      toStatus: newStatus,
      reason,
      changedByUserId: context.actorUserId,
    } })
  }

  private recordAudit(
    transaction: Prisma.TransactionClient,
    context: SalesOrderMutationContext,
    input: {
      readonly eventType: AuditEventType
      readonly targetId: string
      readonly metadata: Record<string, string | number | boolean | null>
    },
  ): Promise<unknown> {
    return this.audit.record(transaction, {
      eventType: input.eventType,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: context.actorUserId,
      targetType: 'SALES_ORDER',
      targetId: input.targetId,
      requestId: context.requestId,
      metadata: input.metadata,
    })
  }
}
