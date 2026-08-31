import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPaymentStatus,
  PurchaseOrderPaymentType,
} from '../../generated/prisma/enums'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  DictionaryLookupService,
  DictionaryValueUnavailableError,
} from '../dictionaries/dictionary-lookup.service'
import { normalizeDictionaryItemValue } from '../dictionaries/dictionary.normalizer'
import {
  MediaAssetLifecycleError,
  MediaAssetService,
} from '../media/media-asset.service'
import {
  derivePurchaseOrderPaymentStatus,
  formatPurchaseOrderAmountUnits,
  normalizePositivePurchaseOrderAmount,
  parsePurchaseOrderAmountUnits,
} from './domain/purchase-order-decimal'
import {
  purchaseOrderRuleFailure,
  purchaseOrderValidationFailure,
} from './domain/purchase-order-errors'
import {
  assertPurchaseOrderFulfillmentTransition,
  assertPurchaseOrderStatusTransition,
} from './domain/purchase-order-state-machine'
import { isCanonicalPurchaseOrderActorId } from './purchase-order-command.normalizer'
import {
  PurchaseOrderQueryService,
  type PurchaseOrderDetail,
} from './purchase-order-query.service'

const PAYMENT_METHOD_DICTIONARY_CODE = 'payment.method'
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PAYMENT_TYPES = new Set<PurchaseOrderPaymentType>([
  'DEPOSIT',
  'BALANCE',
  'OTHER',
])
const FULFILLMENT_STATUSES = new Set<PurchaseOrderFulfillmentStatus>([
  'ORDERED',
  'PREPARING',
  'SHIPPED',
  'SIGNED',
])

export interface PurchaseOrderMutationContext {
  readonly actorUserId: string
  readonly requestId: string
}

interface PurchaseOrderMutationDependencies {
  readonly now: () => Date
}

const DEFAULT_DEPENDENCIES: PurchaseOrderMutationDependencies = {
  now: () => new Date(),
}

const PURCHASE_ORDER_MUTATION_DEPENDENCIES = Symbol(
  'qianshu.purchase-order.mutation-dependencies',
)

type MutablePurchaseOrder = Prisma.PurchaseOrderGetPayload<{
  select: {
    id: true
    orderStatus: true
    fulfillmentStatus: true
    paymentStatus: true
    purchaseTotalAmount: true
    version: true
  }
}>

function validateContext(
  context: PurchaseOrderMutationContext,
): PurchaseOrderMutationContext {
  if (
    !isCanonicalPurchaseOrderActorId(context.actorUserId)
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
    return purchaseOrderValidationFailure(field, '必须是规范的小写 UUID v4')
  }
  return value
}

function requireRecord(
  value: unknown,
  field = 'body',
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return purchaseOrderValidationFailure(field)
  }
  return value as Readonly<Record<string, unknown>>
}

function rejectUnknownKeys(
  body: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  field = 'body',
): void {
  const allowed = new Set(allowedKeys)
  if (Object.keys(body).some(key => !allowed.has(key))) {
    return purchaseOrderValidationFailure(field)
  }
}

function requireText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') return purchaseOrderValidationFailure(field)
  const normalized = value.trim().normalize('NFKC')
  if ([...normalized].length < 1 || [...normalized].length > maximum) {
    return purchaseOrderValidationFailure(field)
  }
  return normalized
}

function optionalText(
  value: unknown,
  field: string,
  maximum: number,
): string | null {
  return value === undefined || value === null
    ? null
    : requireText(value, field, maximum)
}

function fixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function effectivePaidAmount(
  aggregate: {
    readonly _sum: {
      readonly amount: { toFixed(decimalPlaces: number): string } | null
    }
  },
): string {
  return aggregate._sum.amount === null ? '0.0000' : fixed4(aggregate._sum.amount)
}

@Injectable()
export class PurchaseOrderMutationService {
  private readonly dependencies: PurchaseOrderMutationDependencies

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dictionaryLookup: DictionaryLookupService,
    private readonly mediaAsset: MediaAssetService,
    private readonly query: PurchaseOrderQueryService,
    @Optional()
    @Inject(PURCHASE_ORDER_MUTATION_DEPENDENCIES)
    dependencyOverrides: Partial<PurchaseOrderMutationDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  async updateOrderStatus(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    input: unknown,
  ): Promise<PurchaseOrderDetail> {
    const trusted = validateContext(context)
    const purchaseOrderId = requireUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const body = requireRecord(input)
    rejectUnknownKeys(body, ['toStatus', 'reason'])
    if (body.toStatus !== 'CANCELLED') {
      return purchaseOrderValidationFailure('toStatus')
    }
    const reason = optionalText(body.reason, 'reason', 500)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      // 取消与创建使用同一“销售来源行 UUID 升序”锁序，确保释放数量不会穿透并发确认。
      await this.lockSourceSalesLines(transaction, purchaseOrderId)
      const order = await this.lockOrder(transaction, purchaseOrderId)
      const paidAmount = await this.readPaidAmount(transaction, purchaseOrderId)
      assertPurchaseOrderStatusTransition(order.orderStatus, 'CANCELLED', {
        activePaidAmount: paidAmount,
      })
      await transaction.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { orderStatus: 'CANCELLED', version: { increment: 1 } },
      })
      await transaction.purchaseOrderStatusHistory.create({ data: {
        purchaseOrderId,
        dimension: 'ORDER',
        fromStatus: order.orderStatus,
        toStatus: 'CANCELLED',
        reason,
        changedByUserId: trusted.actorUserId,
      } })
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.PURCHASE_ORDER_ORDER_STATUS_CHANGED,
        targetId: purchaseOrderId,
        metadata: { fromStatus: order.orderStatus, toStatus: 'CANCELLED' },
      })
    })
    return this.query.getById(purchaseOrderId)
  }

  async updateFulfillmentStatus(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    input: unknown,
  ): Promise<PurchaseOrderDetail> {
    const trusted = validateContext(context)
    const purchaseOrderId = requireUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const body = requireRecord(input)
    rejectUnknownKeys(body, ['toStatus', 'reason'])
    if (
      typeof body.toStatus !== 'string'
      || !FULFILLMENT_STATUSES.has(
        body.toStatus as PurchaseOrderFulfillmentStatus,
      )
    ) {
      return purchaseOrderValidationFailure('toStatus')
    }
    const toStatus = body.toStatus as PurchaseOrderFulfillmentStatus
    const reason = optionalText(body.reason, 'reason', 500)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const order = await this.lockOrder(transaction, purchaseOrderId)
      assertPurchaseOrderFulfillmentTransition(
        order.fulfillmentStatus,
        toStatus,
        { orderStatus: order.orderStatus },
      )
      await transaction.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { fulfillmentStatus: toStatus, version: { increment: 1 } },
      })
      await transaction.purchaseOrderStatusHistory.create({ data: {
        purchaseOrderId,
        dimension: 'FULFILLMENT',
        fromStatus: order.fulfillmentStatus,
        toStatus,
        reason,
        changedByUserId: trusted.actorUserId,
      } })
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED,
        targetId: purchaseOrderId,
        metadata: { fromStatus: order.fulfillmentStatus, toStatus },
      })
    })
    return this.query.getById(purchaseOrderId)
  }

  async recordPayment(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    input: unknown,
  ): Promise<PurchaseOrderDetail> {
    const trusted = validateContext(context)
    const purchaseOrderId = requireUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const body = requireRecord(input)
    rejectUnknownKeys(body, [
      'paymentType',
      'amount',
      'paidAt',
      'paymentMethod',
      'remark',
      'voucher',
    ])
    if (
      typeof body.paymentType !== 'string'
      || !PAYMENT_TYPES.has(body.paymentType as PurchaseOrderPaymentType)
    ) {
      return purchaseOrderValidationFailure('paymentType')
    }
    const paymentType = body.paymentType as PurchaseOrderPaymentType
    const amount = normalizePositivePurchaseOrderAmount(body.amount)
    const now = this.dependencies.now()
    const paidAt = this.normalizePaidAt(body.paidAt, now)
    let paymentMethod: string
    try {
      paymentMethod = normalizeDictionaryItemValue(body.paymentMethod)
    }
    catch {
      return purchaseOrderValidationFailure('paymentMethod')
    }
    const remark = optionalText(body.remark, 'remark', 500)
    const mediaAssetId = body.voucher === undefined || body.voucher === null
      ? null
      : this.normalizeVoucher(body.voucher)
    try {
      await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const order = await this.lockOrder(transaction, purchaseOrderId)
        if (order.orderStatus === 'CANCELLED') {
          return purchaseOrderRuleFailure(
            'PURCHASE_ORDER_CANCELLED',
            '已取消的采购订单不能记录付款',
          )
        }
        const method = await this.dictionaryLookup.requireEffectiveValue(
          transaction,
          { dictionaryCode: PAYMENT_METHOD_DICTIONARY_CODE, value: paymentMethod },
        )
        if (mediaAssetId !== null) {
          const asset = await transaction.mediaAsset.findFirst({
            where: {
              id: mediaAssetId,
              createdByUserId: trusted.actorUserId,
              status: 'UPLOADING',
              mediaType: { in: ['IMAGE', 'DOCUMENT'] },
              deletedAt: null,
              objectKey: { not: null },
            },
            select: { id: true },
          })
          if (asset === null) {
            return purchaseOrderRuleFailure(
              'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE',
              '所选付款凭证当前不可用',
            )
          }
        }
        const oldPaidAmount = await this.readPaidAmount(
          transaction,
          purchaseOrderId,
        )
        const newPaidAmount = formatPurchaseOrderAmountUnits(
          parsePurchaseOrderAmountUnits(oldPaidAmount)
          + parsePurchaseOrderAmountUnits(amount),
        )
        const newStatus = derivePurchaseOrderPaymentStatus(
          fixed4(order.purchaseTotalAmount),
          newPaidAmount,
        )
        const payment = await transaction.purchaseOrderPayment.create({
          data: {
            purchaseOrderId,
            paymentType,
            amount,
            paidAt,
            paymentMethod: method.value,
            remark,
            createdByUserId: trusted.actorUserId,
          },
          select: { id: true },
        })
        if (mediaAssetId !== null) {
          await this.mediaAsset.activate(transaction, mediaAssetId)
          const document = await transaction.purchaseOrderDocument.create({
            data: {
              purchaseOrderId,
              mediaAssetId,
              paymentId: payment.id,
              documentType: 'PAYMENT_VOUCHER',
              title: `付款凭证-${paymentType}`,
              remark: null,
              createdByUserId: trusted.actorUserId,
            },
            select: { id: true },
          })
          await this.recordAudit(transaction, trusted, {
            eventType: AuditEventType.PURCHASE_ORDER_DOCUMENT_ATTACHED,
            targetId: document.id,
            metadata: { purchaseOrderId, documentType: 'PAYMENT_VOUCHER' },
          })
        }
        await this.writePaymentStatus(
          transaction,
          trusted,
          order,
          newStatus,
        )
        await this.recordAudit(transaction, trusted, {
          eventType: AuditEventType.PURCHASE_ORDER_PAYMENT_RECORDED,
          targetId: payment.id,
          metadata: { purchaseOrderId, paymentType },
        })
      })
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      if (error instanceof DictionaryValueUnavailableError) {
        return purchaseOrderRuleFailure(
          'PURCHASE_ORDER_PAYMENT_METHOD_UNAVAILABLE',
          '付款方式当前不可用',
          'paymentMethod',
        )
      }
      if (error instanceof MediaAssetLifecycleError) {
        return purchaseOrderRuleFailure(
          'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE',
          '所选付款凭证当前不可用',
        )
      }
      throw error
    }
    return this.query.getById(purchaseOrderId)
  }

  async voidPayment(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    rawPaymentId: unknown,
    input: unknown,
  ): Promise<PurchaseOrderDetail> {
    const trusted = validateContext(context)
    const purchaseOrderId = requireUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const paymentId = requireUuid(rawPaymentId, 'paymentId')
    const body = requireRecord(input)
    rejectUnknownKeys(body, ['reason'])
    const reason = requireText(body.reason, 'reason', 500)
    const now = this.dependencies.now()
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const order = await this.lockOrder(transaction, purchaseOrderId)
      const payment = await transaction.purchaseOrderPayment.findFirst({
        where: { id: paymentId, purchaseOrderId },
        select: { id: true, amount: true, voidedAt: true },
      })
      if (payment === null) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'PURCHASE_ORDER_PAYMENT_NOT_FOUND',
          '实际付款记录不存在',
        )
      }
      if (payment.voidedAt !== null) {
        return purchaseOrderRuleFailure(
          'PURCHASE_ORDER_PAYMENT_ALREADY_VOIDED',
          '实际付款记录已作废',
        )
      }
      const oldPaidAmount = await this.readPaidAmount(
        transaction,
        purchaseOrderId,
      )
      const newPaidAmount = formatPurchaseOrderAmountUnits(
        parsePurchaseOrderAmountUnits(oldPaidAmount)
        - parsePurchaseOrderAmountUnits(fixed4(payment.amount)),
      )
      const newStatus = derivePurchaseOrderPaymentStatus(
        fixed4(order.purchaseTotalAmount),
        newPaidAmount,
      )
      await transaction.purchaseOrderPayment.update({
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
        eventType: AuditEventType.PURCHASE_ORDER_PAYMENT_VOIDED,
        targetId: paymentId,
        metadata: { purchaseOrderId, reasonProvided: true },
      })
    })
    return this.query.getById(purchaseOrderId)
  }

  private normalizeVoucher(value: unknown): string {
    const voucher = requireRecord(value, 'voucher')
    rejectUnknownKeys(voucher, ['mediaAssetId'], 'voucher')
    return requireUuid(voucher.mediaAssetId, 'voucher.mediaAssetId')
  }

  private normalizePaidAt(value: unknown, now: Date): Date {
    if (typeof value !== 'string') return purchaseOrderValidationFailure('paidAt')
    const paidAt = new Date(value)
    if (
      !Number.isFinite(paidAt.getTime())
      || paidAt.toISOString() !== value
      || paidAt.getTime() > now.getTime()
    ) {
      return purchaseOrderValidationFailure(
        'paidAt',
        '付款时间必须是有效且不晚于当前时间的 UTC 时间',
      )
    }
    return paidAt
  }

  private async lockSourceSalesLines(
    transaction: Prisma.TransactionClient,
    purchaseOrderId: string,
  ): Promise<void> {
    const rows = await transaction.purchaseOrderLine.findMany({
      where: { purchaseOrderId, sourceSalesOrderLineId: { not: null } },
      select: { sourceSalesOrderLineId: true },
    })
    const sourceIds = [...new Set(rows.flatMap(row => (
      row.sourceSalesOrderLineId === null ? [] : [row.sourceSalesOrderLineId]
    )))].sort()
    if (sourceIds.length === 0) return
    const ids = sourceIds.map(id => Prisma.sql`CAST(${id} AS uuid)`)
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "sales_order_lines"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE
    `)
  }

  private async lockOrder(
    transaction: Prisma.TransactionClient,
    purchaseOrderId: string,
  ): Promise<MutablePurchaseOrder> {
    const locks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "purchase_orders"
      WHERE "id" = CAST(${purchaseOrderId} AS uuid)
      FOR UPDATE
    `)
    if (locks.length !== 1) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PURCHASE_ORDER_NOT_FOUND',
        '采购订单不存在',
      )
    }
    const order = await transaction.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        id: true,
        orderStatus: true,
        fulfillmentStatus: true,
        paymentStatus: true,
        purchaseTotalAmount: true,
        version: true,
      },
    })
    if (order === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PURCHASE_ORDER_NOT_FOUND',
        '采购订单不存在',
      )
    }
    return order
  }

  private async readPaidAmount(
    transaction: Prisma.TransactionClient,
    purchaseOrderId: string,
  ): Promise<string> {
    const aggregate = await transaction.purchaseOrderPayment.aggregate({
      where: { purchaseOrderId, voidedAt: null },
      _sum: { amount: true },
    })
    return effectivePaidAmount(aggregate)
  }

  private async writePaymentStatus(
    transaction: Prisma.TransactionClient,
    context: PurchaseOrderMutationContext,
    order: MutablePurchaseOrder,
    newStatus: PurchaseOrderPaymentStatus,
  ): Promise<void> {
    await transaction.purchaseOrder.update({
      where: { id: order.id },
      data: { paymentStatus: newStatus, version: { increment: 1 } },
    })
    if (newStatus === order.paymentStatus) return
    await transaction.purchaseOrderStatusHistory.create({ data: {
      purchaseOrderId: order.id,
      dimension: 'PAYMENT',
      fromStatus: order.paymentStatus,
      toStatus: newStatus,
      reason: null,
      changedByUserId: context.actorUserId,
    } })
  }

  private recordAudit(
    transaction: Prisma.TransactionClient,
    context: PurchaseOrderMutationContext,
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
      targetType: 'PURCHASE_ORDER',
      targetId: input.targetId,
      requestId: context.requestId,
      metadata: input.metadata,
    })
  }
}
