import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  type SalesOrderFulfillmentStatus,
  type SalesOrderPaymentStatus,
  type SalesOrderPaymentType,
  type SalesOrderStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  deriveSalesOrderPaymentStatus,
  formatSalesOrderAmountUnits,
  normalizePositiveSalesOrderAmount,
  parseSalesOrderAmountUnits,
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
import {
  SalesOrderQueryService,
  type SalesOrderDetail,
} from './sales-order-query.service'

const PAYMENT_TYPES = new Set<SalesOrderPaymentType>([
  'DEPOSIT',
  'BALANCE',
  'OTHER',
])
const ORDER_STATUSES = new Set<SalesOrderStatus>([
  'DRAFT',
  'CONFIRMED',
  'CANCELLED',
])
const FULFILLMENT_STATUSES = new Set<SalesOrderFulfillmentStatus>([
  'PENDING',
  'PREPARING',
  'SHIPPED',
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
    lineSubtotalAmount: true
    agreedTotalAmount: true
    depositDueAmount: true
    balanceDueAmount: true
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

@Injectable()
export class SalesOrderMutationService {
  private readonly dependencies: SalesOrderMutationDependencies

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly query: SalesOrderQueryService,
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
    const reason = optionalText(body.reason, 'reason', 500)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const order = await this.lockOrder(transaction, salesOrderId)
      const receivedAmount = await this.readReceivedAmount(transaction, salesOrderId)
      assertSalesOrderStatusTransition(order.orderStatus, toStatus, {
        activeReceivedAmount: receivedAmount,
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
      const order = await this.lockOrder(transaction, salesOrderId)
      if (order.orderStatus === 'CANCELLED') {
        return salesOrderRuleFailure(
          'SALES_ORDER_CANCELLED',
          '已取消订单不能继续履约',
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
      deriveSalesOrderPaymentStatus(amounts.agreedTotalAmount, receivedAmount)
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
          version: { increment: 1 },
        },
      })
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.SALES_ORDER_PAYMENT_TERMS_UPDATED,
        targetId: salesOrderId,
        metadata: { reasonProvided: true },
      })
    })
    return this.query.getById(salesOrderId)
  }

  async recordPayment(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    const trusted = validateContext(context)
    const salesOrderId = requireUuid(rawSalesOrderId, 'salesOrderId')
    const body = requireRecord(input)
    if (
      typeof body.paymentType !== 'string'
      || !PAYMENT_TYPES.has(body.paymentType as SalesOrderPaymentType)
    ) {
      return salesOrderValidationFailure('paymentType')
    }
    const amount = normalizePositiveSalesOrderAmount(body.amount)
    const receivedAt = this.normalizeReceivedAt(body.receivedAt)
    const paymentMethod = optionalText(body.paymentMethod, 'paymentMethod', 64)
    const referenceNo = optionalText(body.referenceNo, 'referenceNo', 128)
    const remark = optionalText(body.remark, 'remark', 500)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const order = await this.lockOrder(transaction, salesOrderId)
      if (order.orderStatus === 'CANCELLED') {
        return salesOrderRuleFailure(
          'SALES_ORDER_CANCELLED',
          '已取消订单不能记录收款',
        )
      }
      const oldReceivedAmount = await this.readReceivedAmount(
        transaction,
        salesOrderId,
      )
      const newReceivedAmount = formatSalesOrderAmountUnits(
        parseSalesOrderAmountUnits(oldReceivedAmount)
        + parseSalesOrderAmountUnits(amount),
      )
      const newStatus = deriveSalesOrderPaymentStatus(
        fixed4(order.agreedTotalAmount),
        newReceivedAmount,
      )
      const payment = await transaction.salesOrderPayment.create({
        data: {
          salesOrderId,
          paymentType: body.paymentType as SalesOrderPaymentType,
          amount,
          receivedAt,
          paymentMethod,
          referenceNo,
          remark,
          createdByUserId: trusted.actorUserId,
        },
        select: { id: true },
      })
      await this.writePaymentStatus(
        transaction,
        trusted,
        order,
        newStatus,
      )
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.SALES_ORDER_PAYMENT_RECORDED,
        targetId: payment.id,
        metadata: {
          salesOrderId,
          paymentType: body.paymentType as SalesOrderPaymentType,
        },
      })
    })
    return this.query.getById(salesOrderId)
  }

  async voidPayment(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    rawPaymentId: unknown,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    const trusted = validateContext(context)
    const salesOrderId = requireUuid(rawSalesOrderId, 'salesOrderId')
    const paymentId = requireUuid(rawPaymentId, 'paymentId')
    const body = requireRecord(input)
    const reason = requireText(body.reason, 'reason', 500)
    const now = this.dependencies.now()
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const order = await this.lockOrder(transaction, salesOrderId)
      const payment = await transaction.salesOrderPayment.findFirst({
        where: { id: paymentId, salesOrderId },
        select: { id: true, amount: true, voidedAt: true },
      })
      if (payment === null) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'SALES_ORDER_PAYMENT_NOT_FOUND',
          '实际收款记录不存在',
        )
      }
      if (payment.voidedAt !== null) {
        return salesOrderRuleFailure(
          'SALES_ORDER_PAYMENT_ALREADY_VOIDED',
          '实际收款记录已作废',
        )
      }
      const oldReceivedAmount = await this.readReceivedAmount(
        transaction,
        salesOrderId,
      )
      const newReceivedAmount = formatSalesOrderAmountUnits(
        parseSalesOrderAmountUnits(oldReceivedAmount)
        - parseSalesOrderAmountUnits(fixed4(payment.amount)),
      )
      const newStatus = deriveSalesOrderPaymentStatus(
        fixed4(order.agreedTotalAmount),
        newReceivedAmount,
      )
      await transaction.salesOrderPayment.update({
        where: { id: paymentId },
        data: {
          voidedAt: now,
          voidedByUserId: trusted.actorUserId,
          voidReason: reason,
        },
      })
      await this.writePaymentStatus(
        transaction,
        trusted,
        order,
        newStatus,
      )
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.SALES_ORDER_PAYMENT_VOIDED,
        targetId: paymentId,
        metadata: { salesOrderId, reasonProvided: true },
      })
    })
    return this.query.getById(salesOrderId)
  }

  private normalizeReceivedAt(value: unknown): Date {
    if (typeof value !== 'string') return salesOrderValidationFailure('receivedAt')
    const receivedAt = new Date(value)
    const now = this.dependencies.now()
    if (
      !Number.isFinite(receivedAt.getTime())
      || receivedAt.toISOString() !== value
      || receivedAt.getTime() > now.getTime()
    ) {
      return salesOrderValidationFailure(
        'receivedAt',
        '收款时间必须是有效且不晚于当前时间的 UTC 时间',
      )
    }
    return receivedAt
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
        lineSubtotalAmount: true,
        agreedTotalAmount: true,
        depositDueAmount: true,
        balanceDueAmount: true,
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
