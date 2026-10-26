import { executeBatchPayment } from './payables/purchase-payable-batch.transaction'
import { normalizeBatchPayment } from './payables/purchase-payable-batch.logic'
import { PurchasePayableService, type PayableConfirmation, type PreparedPayablePayment, type PurchasePayablePaymentInput } from './payables/purchase-payable.service'
import type { PurchasePayableBatchPayDto, PurchasePayableBatchResultDto, PurchasePayablePayDto } from './payables/purchase-payable.dto'
import { payableFailure, payableStateChanged } from './payables/purchase-payable.logic'
import { parsePurchaseOrderIdempotencyKey } from './purchase-order-command.normalizer'
import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPaymentStatus,
  PurchaseOrderPaymentType,
  PurchaseOrderStatus,
} from '../../generated/prisma/enums'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback } from '../access-control/data-scope.service'
import type { DataScope } from '../access-control/data-scope'
import { AuditService, AuditWriteFailedError } from '../audit/audit.service'
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
  derivePurchaseOrderStatus,
} from './domain/purchase-order-state-machine'
import { isCanonicalPurchaseOrderActorId } from './purchase-order-command.normalizer'
import { purchaseOrderPayableScopeWhere, purchaseOrderScopeWhere } from './purchase-order-access'
import {
  PurchaseOrderQueryService,
  type PurchaseOrderDetail,
} from './purchase-order-query.service'
import { PurchaseOrderWarehouseReceiptService } from './warehouse-receipts/purchase-order-warehouse-receipt.service'
import { PurchaseOrderImageDraftService } from './order-images/purchase-order-image-draft.service'
import { purchaseReviewSourceBlockReason } from './purchase-order-review-source'
import { SalesOrderPurchaseCoverageService } from './sales-order-purchase-coverage.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { NumberingGenerationError } from '../numbering/numbering.errors'
import { PurchaseShippingMarkResolverService } from '../purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import { PURCHASE_ORDER_CENTS_FINGERPRINT_VERSION, PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION, PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION, PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION, PURCHASE_ORDER_PART_ISSUED_FINGERPRINT_VERSION } from './purchase-order-create-fingerprint'
import { mapShippingMarkGenerationError, PURCHASE_SHIPPING_MARK_CONSUMER, requirePurchaseShippingMark } from './purchase-order-shipping-mark'

const PAYMENT_METHOD_DICTIONARY_CODE = 'payment.method'
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PAYMENT_TYPES = new Set<PurchaseOrderPaymentType>([
  'DEPOSIT',
  'BALANCE',
  'OTHER',
])
const PAYMENT_VOUCHER_TITLE_LABELS: Readonly<Record<PurchaseOrderPaymentType, string>> = {
  DEPOSIT: '定金凭证',
  BALANCE: '尾款凭证',
  OTHER: '其他付款凭证',
}
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

type AutomaticOrderStatusTrigger = 'FULFILLMENT' | 'PAYMENT'

type MutablePurchaseOrder = Prisma.PurchaseOrderGetPayload<{
  select: {
    id: true
    orderNo: true
    orderStatus: true
    fulfillmentStatus: true
    paymentStatus: true
    purchaseTotalAmount: true
    purchaseType: true
    salesOrderId: true
    version: true
    productMode: true
    supplierValue: true
    createRequestFingerprintHash: true
    createRequestFingerprintVersion: true
    shippingMarkText: true
    shippingMarkIssuanceId: true
    _count: { select: { parts: true } }
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

function fixed2(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(2)
}

function effectivePaidAmount(
  aggregate: {
    readonly _sum: {
      readonly amount: { toFixed(decimalPlaces: number): string } | null
    }
  },
): string {
  return aggregate._sum.amount === null ? '0.00' : fixed2(aggregate._sum.amount)
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
    private readonly salesOrderCoverage: SalesOrderPurchaseCoverageService,
    private readonly numbering: NumberingGeneratorService,
    private readonly shippingMarks: PurchaseShippingMarkResolverService,
    private readonly warehouseReceipts: PurchaseOrderWarehouseReceiptService,
    private readonly imageDrafts: PurchaseOrderImageDraftService,
    private readonly payables: PurchasePayableService,
    @Optional()
    @Inject(PURCHASE_ORDER_MUTATION_DEPENDENCIES)
    dependencyOverrides: Partial<PurchaseOrderMutationDependencies> = {},
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  /** 生成图片的第二步：派发结果持久留存，但采购单和货件仍停留在待审核。 */
  async prepareReviewShippingMarks(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    input: unknown,
  ): Promise<PurchaseOrderDetail> {
    const trusted = validateContext(context)
    const purchaseOrderId = requireUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const body = requireRecord(input)
    rejectUnknownKeys(body, ['expectedVersion'])
    const expectedVersion = body.expectedVersion
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return purchaseOrderValidationFailure('expectedVersion')
    }
    try {
      await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const scope = await this.dataScope.resolveInTransaction(transaction, trusted.actorUserId)
        await this.requireVisibleOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
        await this.lockSourceSalesLines(transaction, purchaseOrderId)
        const order = await this.lockOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
        if (order.version !== expectedVersion || order.orderStatus !== 'PENDING_REVIEW' || order.fulfillmentStatus !== 'ORDERED') {
          throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '采购订单已变化，请刷新后重新生成图片')
        }
        if (order.purchaseType === 'SALES_LINKED' && order.salesOrderId !== null) {
          const source = await transaction.salesOrder.findUnique({ where: { id: order.salesOrderId }, select: { orderStatus: true } })
          const reason = purchaseReviewSourceBlockReason(source?.orderStatus ?? null)
          if (reason) throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', reason)
        }
        const mark = await this.issueReviewShippingMark(transaction, order)
        if (mark === null) return
        await transaction.purchaseOrder.update({ where: { id: order.id }, data: {
          shippingMarkText: mark.number, shippingMarkIssuanceId: mark.issuanceId, version: { increment: 1 },
        } })
        // 全部派生唛头和基础号原子写入；不改变封存配置或待审核货件状态。
        await transaction.$executeRaw(Prisma.sql`
          UPDATE purchase_order_parts
          SET shipping_mark_text = CASE WHEN ${order._count.parts} = 1 THEN ${mark.number}
            ELSE ${mark.number} || '/货件-' || lpad(part_number::text, greatest(2, length(part_number::text)), '0') END
          WHERE purchase_order_id = ${order.id}::uuid
        `)
        await this.recordAudit(transaction, trusted, {
          eventType: AuditEventType.PURCHASE_ORDER_REVIEW_MARKS_PREPARED, targetId: order.id,
          metadata: { shippingMarkIssuanceId: mark.issuanceId, shippingMarkRuleCode: mark.ruleCode,
            shippingMarkRevision: mark.ruleRevision, partCount: order._count.parts },
        })
      })
    }
    catch (error) {
      if (error instanceof NumberingGenerationError) throw mapShippingMarkGenerationError(error)
      const facts = readPersistenceErrorFacts(error)
      if ((error instanceof AuditWriteFailedError && error.transactionConflict)
        || ['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
        throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '采购依赖状态已变化，请刷新后重新生成图片')
      }
      throw error
    }
    return this.query.getById(purchaseOrderId, trusted.actorUserId)
  }

  async review(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    input: unknown,
  ): Promise<PurchaseOrderDetail> {
    const trusted = validateContext(context)
    const purchaseOrderId = requireUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const body = requireRecord(input)
    rejectUnknownKeys(body, ['expectedVersion', 'reason', 'imageDraftId'])
    const imageDraftId = requireUuid(body.imageDraftId, 'imageDraftId')
    const expectedVersion = body.expectedVersion
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return purchaseOrderValidationFailure('expectedVersion')
    }
    const reason = body.reason === undefined
      ? '采购订单审核通过，进入备货'
      : requireText(body.reason, 'reason', 500)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const scope = await this.dataScope.resolveInTransaction(transaction, trusted.actorUserId)
      await this.requireVisibleOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
      // 与取消保持“销售来源行 -> 采购单 -> 销售单”锁序。采购行锁内重读版本和
      // 审核态，确保两个审核请求只能有一个写状态、历史并推进销售覆盖。
      await this.lockSourceSalesLines(transaction, purchaseOrderId)
      const order = await this.lockOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
      if (order.version !== expectedVersion || order.orderStatus !== 'PENDING_REVIEW'
        || order.fulfillmentStatus !== 'ORDERED') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'PURCHASE_ORDER_STATE_CHANGED',
          '采购订单已变化或已完成审核，请刷新后重试',
        )
      }
      // 审核只归档操作者已经预览过的同一张图片，不再申请或替换唛头。
      await this.imageDrafts.attachForReview(transaction, trusted, purchaseOrderId, expectedVersion, imageDraftId)
      await transaction.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          orderStatus: 'CONFIRMED',
          fulfillmentStatus: 'PREPARING',
          version: { increment: 1 },
        },
      })
      await this.payables.createForReview(transaction, trusted, purchaseOrderId)
      // 与图片归档、审核共用事务，避免尚未通过的预定义货件被实际作业使用。
      await transaction.purchaseOrderPart.updateMany({
        where: { purchaseOrderId, status: 'PENDING_REVIEW' },
        data: { status: 'ACTIVE' },
      })
      for (const transition of [
        { dimension: 'ORDER', fromStatus: 'PENDING_REVIEW', toStatus: 'CONFIRMED', eventType: AuditEventType.PURCHASE_ORDER_ORDER_STATUS_CHANGED },
        { dimension: 'FULFILLMENT', fromStatus: 'ORDERED', toStatus: 'PREPARING', eventType: AuditEventType.PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED },
      ] as const) {
        await transaction.purchaseOrderStatusHistory.create({ data: {
          purchaseOrderId,
          dimension: transition.dimension,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          reason,
          changedByUserId: trusted.actorUserId,
        } })
        await this.recordAudit(transaction, trusted, {
          eventType: transition.eventType,
          targetId: purchaseOrderId,
          metadata: { action: 'REVIEW', fromStatus: transition.fromStatus, toStatus: transition.toStatus,
            imageDraftId,
          },
        })
      }
      if (order.purchaseType === 'SALES_LINKED' && order.salesOrderId !== null) {
        await this.salesOrderCoverage.advanceWhenFullyCovered(transaction, {
          actorUserId: trusted.actorUserId,
          purchaseOrderId,
          purchaseOrderNo: order.orderNo,
          requestId: trusted.requestId,
          salesOrderId: order.salesOrderId,
        })
      }
    }).catch((error: unknown) => {
      // 只有事务退出后才映射失败；不在 aborted transaction 中恢复，也不把其他审核当作本次成功。
      if (error instanceof NumberingGenerationError) throw mapShippingMarkGenerationError(error)
      const facts = readPersistenceErrorFacts(error)
      if (
        (error instanceof AuditWriteFailedError && error.transactionConflict)
        || ['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))
      ) {
        throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '采购依赖状态已变化，请刷新核对后重试')
      }
      throw error
    })
    return this.query.getById(purchaseOrderId, trusted.actorUserId)
  }

  private async issueReviewShippingMark(transaction: Prisma.TransactionClient, order: MutablePurchaseOrder) {
    // v3/v4 的真实历史派发不可覆盖。v5/v6 在生成审核图片前首次派发。
    if (order.createRequestFingerprintVersion === PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION
      || order.createRequestFingerprintVersion === PURCHASE_ORDER_PART_ISSUED_FINGERPRINT_VERSION) return null
    if ((order.createRequestFingerprintVersion !== PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION && order.createRequestFingerprintVersion !== PURCHASE_ORDER_CENTS_FINGERPRINT_VERSION && order.createRequestFingerprintVersion !== PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION)
      || order.productMode === 'MIXED' || (order.shippingMarkText === null) !== (order.shippingMarkIssuanceId === null) || order._count.parts < 1) {
      throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '采购货件或唛头状态已变化，请刷新核对')
    }
    // 已正式派发的唛头不可因关闭弹窗、重生成图片或规则停用而更换。
    if (order.shippingMarkText !== null) return null
    const resolution = await this.shippingMarks.resolve(transaction, {
      productMode: order.productMode, supplierValue: order.supplierValue,
    }, true)
    const ruleCode = requirePurchaseShippingMark(resolution)
    // 生成图片前读取当前规则与数据库事务时间；订单稳定键/创建指纹可由 SQL 独立验证。
    return this.numbering.generateScopedInTransaction(transaction, {
      ruleCode, consumerCode: PURCHASE_SHIPPING_MARK_CONSUMER, idempotencyKey: order.id,
      requestFingerprint: Buffer.from(order.createRequestFingerprintHash).toString('hex'),
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
      const scope = await this.dataScope.resolveInTransaction(transaction, trusted.actorUserId)
      await this.requireVisibleOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
      // 取消与创建使用同一“销售来源行 UUID 升序”锁序，确保释放数量不会穿透并发确认。
      await this.lockSourceSalesLines(transaction, purchaseOrderId)
      const order = await this.lockOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
      if (['PARTIALLY_SHIPPED', 'SHIPPED', 'SIGNED'].includes(order.fulfillmentStatus)) {
        return purchaseOrderRuleFailure('PURCHASE_ORDER_STATUS_TRANSITION_INVALID', '已有货件发出的采购订单不能整单取消')
      }
      const paidAmount = await this.readPaidAmount(transaction, purchaseOrderId)
      assertPurchaseOrderStatusTransition(order.orderStatus, 'CANCELLED', {
        activePaidAmount: paidAmount,
      })
      await this.closePurchaseOrderAsCancelled(
        transaction,
        order,
        trusted,
        reason ?? '用户取消采购订单',
        null,
      )
    })
    return this.query.getById(purchaseOrderId, trusted.actorUserId)
  }

  /**
   * 审核驳回：只允许待审核订单。原单进入 CANCELLED 终态并写入驳回元数据，
   * 货件、图片草稿与应付款沿用取消清理；不重算销售覆盖（待审核单本就不计入覆盖）。
   */
  async reject(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    input: unknown,
  ): Promise<PurchaseOrderDetail> {
    const trusted = validateContext(context)
    const purchaseOrderId = requireUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const body = requireRecord(input)
    rejectUnknownKeys(body, ['expectedVersion', 'reason'])
    const expectedVersion = body.expectedVersion
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return purchaseOrderValidationFailure('expectedVersion')
    }
    const reason = requireText(body.reason, 'reason', 500)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const scope = await this.dataScope.resolveInTransaction(transaction, trusted.actorUserId)
      await this.requireVisibleOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
      await this.lockSourceSalesLines(transaction, purchaseOrderId)
      const order = await this.lockOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
      if (order.version !== expectedVersion || order.orderStatus !== 'PENDING_REVIEW' || order.fulfillmentStatus !== 'ORDERED') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'PURCHASE_ORDER_STATE_CHANGED',
          '采购订单已变化或已完成审核，请刷新后重试',
        )
      }
      const paidAmount = await this.readPaidAmount(transaction, purchaseOrderId)
      assertPurchaseOrderStatusTransition(order.orderStatus, 'CANCELLED', {
        activePaidAmount: paidAmount,
      })
      await this.closePurchaseOrderAsCancelled(
        transaction,
        order,
        trusted,
        reason,
        { reason },
      )
    })
    return this.query.getById(purchaseOrderId, trusted.actorUserId)
  }

  private async closePurchaseOrderAsCancelled(
    transaction: Prisma.TransactionClient,
    order: MutablePurchaseOrder,
    trusted: PurchaseOrderMutationContext,
    reason: string,
    rejection: { readonly reason: string } | null,
  ): Promise<void> {
    await transaction.purchaseOrder.update({
      where: { id: order.id },
      data: {
        orderStatus: 'CANCELLED',
        ...(rejection === null
          ? {}
          : {
              rejectedAt: new Date(),
              rejectedByUserId: trusted.actorUserId,
              rejectionReason: rejection.reason,
            }),
        version: { increment: 1 },
      },
    })
    // 取消/驳回只改变可用性，原唛头与产品分配继续留存供历史追溯。
    await transaction.purchaseOrderPart.updateMany({
      where: { purchaseOrderId: order.id, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED' },
    })
    await this.payables.closeForCancellation(transaction, order.id)
    await this.imageDrafts.invalidateForOrder(transaction, order.id)
    await transaction.purchaseOrderStatusHistory.create({ data: {
      purchaseOrderId: order.id,
      dimension: 'ORDER',
      fromStatus: order.orderStatus,
      toStatus: 'CANCELLED',
      reason,
      changedByUserId: trusted.actorUserId,
    } })
    await this.recordAudit(transaction, trusted, {
      eventType: rejection === null
        ? AuditEventType.PURCHASE_ORDER_ORDER_STATUS_CHANGED
        : AuditEventType.PURCHASE_ORDER_REJECTED,
      targetId: order.id,
      metadata: rejection === null
        ? { fromStatus: order.orderStatus, toStatus: 'CANCELLED' }
        : { action: 'REJECT', fromStatus: order.orderStatus, toStatus: 'CANCELLED', reason: rejection.reason },
    })
    // 审核驳回不改变销售覆盖：待审核采购从未计入覆盖。取消仍需按来源重算。
    if (rejection === null && order.purchaseType === 'SALES_LINKED' && order.salesOrderId !== null) {
      await this.salesOrderCoverage.recalculateAfterPurchaseCancellation(
        transaction,
        {
          actorUserId: trusted.actorUserId,
          purchaseOrderId: order.id,
          purchaseOrderNo: order.orderNo,
          requestId: trusted.requestId,
          salesOrderId: order.salesOrderId,
        },
      )
    }
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
    // 发货事实只能由货件发货命令写入，通用履约接口不能绕过货件分配。
    if (toStatus === 'SHIPPED' || toStatus === 'PARTIALLY_SHIPPED') {
      return purchaseOrderRuleFailure('PURCHASE_ORDER_FULFILLMENT_TRANSITION_INVALID', '请通过货件发货操作更新发货状态')
    }
    const reason = optionalText(body.reason, 'reason', 500)
    if (toStatus === 'SIGNED') {
      return this.warehouseReceipts.receiveAll(trusted, purchaseOrderId, reason)
    }
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const scope = await this.dataScope.resolveInTransaction(transaction, trusted.actorUserId)
      const order = await this.lockOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
      assertPurchaseOrderFulfillmentTransition(
        order.fulfillmentStatus,
        toStatus,
        { orderStatus: order.orderStatus },
      )
      const newOrderStatus = derivePurchaseOrderStatus({
        orderStatus: order.orderStatus,
        fulfillmentStatus: toStatus,
        paymentStatus: order.paymentStatus,
      })
      await transaction.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          fulfillmentStatus: toStatus,
          orderStatus: newOrderStatus,
          version: { increment: 1 },
        },
      })
      await transaction.purchaseOrderStatusHistory.create({ data: {
        purchaseOrderId,
        dimension: 'FULFILLMENT',
        fromStatus: order.fulfillmentStatus,
        toStatus,
        reason: reason ?? `用户确认采购订单进入${{
          ORDERED: '已下单', PREPARING: '备货中', PARTIALLY_SHIPPED: '部分发货', SHIPPED: '已发货', SIGNED: '已签收',
        }[toStatus]}`,
        changedByUserId: trusted.actorUserId,
      } })
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED,
        targetId: purchaseOrderId,
        metadata: { fromStatus: order.fulfillmentStatus, toStatus },
      })
      await this.recordAutomaticOrderStatusChange(
        transaction,
        trusted,
        order,
        newOrderStatus,
        'FULFILLMENT',
      )
    })
    return this.query.getById(purchaseOrderId, trusted.actorUserId)
  }

  async payBatch(context: PurchaseOrderMutationContext, rawInput: PurchasePayableBatchPayDto, rawKey: unknown): Promise<PurchasePayableBatchResultDto> {
    const trusted = validateContext(context)
    const input = normalizeBatchPayment(rawInput)
    const key = parsePurchaseOrderIdempotencyKey(rawKey)
    try {
      return await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const scope = await this.dataScope.resolveInTransaction(transaction, trusted.actorUserId)
        // 批量付款在写资金前校验整批应付款归属，任一阶段不可见都按不存在拒绝。
        if (scope === 'SELF') {
          const ownedCount = await transaction.purchaseOrderPayable.count({
            where: {
              id: { in: input.items.map(item => item.payableId) },
              ...purchaseOrderPayableScopeWhere(scope, trusted.actorUserId),
            },
          })
          if (ownedCount !== input.items.length) return payableFailure('PURCHASE_PAYABLE_NOT_FOUND', '采购应付款不存在', 404)
        }
        return executeBatchPayment(transaction, trusted, input, key, this.payables, {
          now: this.dependencies.now(),
          validatePaymentMethod: () => this.dictionaryLookup.requireEffectiveValue(transaction, { dictionaryCode: PAYMENT_METHOD_DICTIONARY_CODE, value: input.paymentMethod }),
          lockOrder: id => this.lockOrder(transaction, id, scope, trusted.actorUserId),
          writePayment: (order, paymentInput, confirmation, prepared) => this.writePaymentInTransaction(transaction, trusted, order, paymentInput, confirmation, prepared),
        })
      }, { timeout: 60_000 })
    } catch (error) {
      if (error instanceof ApiException) throw error
      if (error instanceof DictionaryValueUnavailableError) return purchaseOrderRuleFailure('PURCHASE_ORDER_PAYMENT_METHOD_UNAVAILABLE', '付款方式当前不可用', 'paymentMethod')
      if (error instanceof MediaAssetLifecycleError) return purchaseOrderRuleFailure('PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', '所选付款凭证当前不可用')
      const facts = readPersistenceErrorFacts(error)
      if (['40P01', '55P03', '57014', '40001', 'P2034', 'P2028'].some(code => hasPersistenceCode(facts, code))) return payableStateChanged()
      throw error
    }
  }

  async payPayable(context: PurchaseOrderMutationContext, rawId: string, input: PurchasePayablePayDto, rawKey: unknown): Promise<string> {
    const id = requireUuid(rawId, 'id')
    const idempotencyKey = parsePurchaseOrderIdempotencyKey(rawKey)
    const body = requireRecord(input)
    rejectUnknownKeys(body, ['expectedVersion', 'paymentMethod', 'remark', 'recipientAccountId', 'recipientProfileVersion', 'voucher'])
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) return purchaseOrderValidationFailure('expectedVersion')
    const scope = await this.dataScope.resolve(context.actorUserId)
    const payable = await this.prisma.purchaseOrderPayable.findFirst({
      where: { id, ...purchaseOrderPayableScopeWhere(scope, context.actorUserId) },
    })
    if (!payable) return payableFailure('PURCHASE_PAYABLE_NOT_FOUND', '采购应付款不存在', 404)
    await this.recordPayment(context, payable.purchaseOrderId, {
      paymentType: payable.paymentType, amount: payable.dueAmount.toFixed(2),
      paidAt: this.dependencies.now().toISOString(), paymentMethod: input.paymentMethod, remark: input.remark,
      recipientAccountId: input.recipientAccountId, recipientProfileVersion: input.recipientProfileVersion, voucher: input.voucher,
    }, { payableId: id, expectedVersion: input.expectedVersion, idempotencyKey })
    return payable.purchaseOrderId
  }

  async recordPayment(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    input: unknown,
    confirmation?: PayableConfirmation,
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
      'recipientAccountId',
      'recipientProfileVersion',
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
    const recipientAccountId = requireUuid(body.recipientAccountId, 'recipientAccountId')
    const recipientProfileVersion = body.recipientProfileVersion
    if (typeof recipientProfileVersion !== 'number' || !Number.isSafeInteger(recipientProfileVersion) || recipientProfileVersion < 1) return purchaseOrderValidationFailure('recipientProfileVersion')
    const mediaAssetId = body.voucher === undefined || body.voucher === null
      ? null
      : this.normalizeVoucher(body.voucher)
    try {
      await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const scope = await this.dataScope.resolveInTransaction(transaction, trusted.actorUserId)
        const order = await this.lockOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
        await this.writePaymentInTransaction(transaction, trusted, order,
          { paymentType, amount, paidAt, paymentMethod, remark, mediaAssetId, recipientAccountId, recipientProfileVersion }, confirmation)
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
    return this.query.getById(purchaseOrderId, trusted.actorUserId)
  }

  private async writePaymentInTransaction(
    transaction: Prisma.TransactionClient,
    trusted: PurchaseOrderMutationContext,
    order: MutablePurchaseOrder,
    input: PurchasePayablePaymentInput,
    confirmation?: PayableConfirmation,
    suppliedPreparation?: PreparedPayablePayment,
  ): Promise<void> {
    const purchaseOrderId = order.id
    const { paymentType, paidAt, paymentMethod, remark, mediaAssetId, recipientAccountId, recipientProfileVersion } = input
    let { amount } = input
    const now = this.dependencies.now()
    if (order.orderStatus === 'PENDING_REVIEW') {
      return purchaseOrderRuleFailure(
        'PURCHASE_ORDER_STATUS_TRANSITION_INVALID',
        '采购订单审核通过后才能记录付款',
      )
    }
    if (order.orderStatus === 'CANCELLED') {
      return purchaseOrderRuleFailure(
        'PURCHASE_ORDER_CANCELLED',
        '已取消的采购订单不能记录付款',
      )
    }
    const prepared = suppliedPreparation ?? await this.payables.preparePayment(transaction, trusted, purchaseOrderId,
      { paymentType, amount, paidAt, paymentMethod, remark, mediaAssetId, recipientAccountId, recipientProfileVersion }, confirmation)
    if (prepared.replay) return
    amount = prepared.amount
    const method = await this.dictionaryLookup.requireEffectiveValue(
      transaction,
      { dictionaryCode: PAYMENT_METHOD_DICTIONARY_CODE, value: paymentMethod },
    )
    if (mediaAssetId !== null) {
      // 临时截图只能消费一次；不同款项并发使用同一图片时，后到者必须重新上传。
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id = ${mediaAssetId}::uuid FOR UPDATE`)
      const asset = await transaction.mediaAsset.findFirst({
        where: {
          id: mediaAssetId,
          createdByUserId: trusted.actorUserId,
          status: 'UPLOADING',
          mediaType: 'IMAGE',
          uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER',
          purchasePayableUploadId: prepared.payable!.id,
          uploadExpiresAt: { gt: now },
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
      fixed2(order.purchaseTotalAmount),
      newPaidAmount,
    )
    const fundLink = await this.payables.postPayment(transaction, trusted, prepared, order.orderNo)
    const payment = await transaction.purchaseOrderPayment.create({
      data: {
        ...fundLink,
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
          // 凭证展示名只在创建时由已锁定订单的真实编号和付款类型生成；
          // 不改媒体原始文件名，也不在查询时重写历史凭证标题。
          title: `${order.orderNo}-${PAYMENT_VOUCHER_TITLE_LABELS[paymentType]}`,
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
    await this.writePaymentAndOrderStatus(
      transaction,
      trusted,
      order,
      newStatus,
      `新增付款 ${amount} CNY，累计有效付款 ${newPaidAmount} CNY；采购总价 ${fixed2(order.purchaseTotalAmount)} CNY`,
    )
    await this.recordAudit(transaction, trusted, {
      eventType: AuditEventType.PURCHASE_ORDER_PAYMENT_RECORDED,
      targetId: payment.id,
      metadata: { purchaseOrderId, paymentType, fundPostingBatchId: fundLink.fundPostingBatchId },
    })
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
      const scope = await this.dataScope.resolveInTransaction(transaction, trusted.actorUserId)
      const order = await this.lockOrder(transaction, purchaseOrderId, scope, trusted.actorUserId)
      const payment = await transaction.purchaseOrderPayment.findFirst({
        where: { id: paymentId, purchaseOrderId },
        select: { id: true, amount: true, voidedAt: true, payableId: true, fundPostingBatchId: true },
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
        - parsePurchaseOrderAmountUnits(fixed2(payment.amount)),
      )
      const newStatus = derivePurchaseOrderPaymentStatus(
        fixed2(order.purchaseTotalAmount),
        newPaidAmount,
      )
      const fundReversalBatchId = await this.payables.reversePayment(transaction, trusted, payment, reason)
      await transaction.purchaseOrderPayment.update({
        where: { id: paymentId },
        data: {
          fundReversalBatchId,
          voidedAt: now,
          voidedByUserId: trusted.actorUserId,
          voidReason: reason,
        },
      })
      await this.writePaymentAndOrderStatus(
        transaction,
        trusted,
        order,
        newStatus,
        `作废付款 ${fixed2(payment.amount)} CNY，重算累计有效付款 ${newPaidAmount} CNY；采购总价 ${fixed2(order.purchaseTotalAmount)} CNY`,
      )
      await this.recordAudit(transaction, trusted, {
        eventType: AuditEventType.PURCHASE_ORDER_PAYMENT_VOIDED,
        targetId: paymentId,
        metadata: { purchaseOrderId, reasonProvided: true },
      })
    })
    return this.query.getById(purchaseOrderId, trusted.actorUserId)
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

  /** 在锁定销售来源行之前先按数据范围确认采购单可见，避免为不可见订单加行锁。 */
  private async requireVisibleOrder(
    transaction: Prisma.TransactionClient,
    purchaseOrderId: string,
    scope: DataScope,
    actorUserId: string,
  ): Promise<void> {
    const visible = await transaction.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, ...purchaseOrderScopeWhere(scope, actorUserId) },
      select: { id: true },
    })
    if (visible === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PURCHASE_ORDER_NOT_FOUND',
        '采购订单不存在',
      )
    }
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
    scope: DataScope,
    actorUserId: string,
  ): Promise<MutablePurchaseOrder> {
    // 行锁查询本身带上归属条件，不可见采购单不会进入后续状态和版本校验。
    const scopeFilter = scope === 'SELF'
      ? Prisma.sql`
          AND EXISTS (
            SELECT 1
            FROM "sales_orders" AS scope_order
            WHERE scope_order."id" = purchase_order."sales_order_id"
              AND scope_order."issuer_user_id" = CAST(${actorUserId} AS uuid)
          )
        `
      : Prisma.empty
    const locks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT purchase_order."id"
      FROM "purchase_orders" AS purchase_order
      WHERE purchase_order."id" = CAST(${purchaseOrderId} AS uuid)
      ${scopeFilter}
      FOR UPDATE
    `)
    if (locks.length !== 1) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PURCHASE_ORDER_NOT_FOUND',
        '采购订单不存在',
      )
    }
    const order = await transaction.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, ...purchaseOrderScopeWhere(scope, actorUserId) },
      select: {
        id: true,
        orderNo: true,
        orderStatus: true,
        fulfillmentStatus: true,
        paymentStatus: true,
        purchaseTotalAmount: true,
        purchaseType: true,
        salesOrderId: true,
        version: true,
        productMode: true,
        supplierValue: true,
        createRequestFingerprintHash: true,
        createRequestFingerprintVersion: true,
        shippingMarkText: true,
        shippingMarkIssuanceId: true,
        _count: { select: { parts: true } },
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

  private async writePaymentAndOrderStatus(
    transaction: Prisma.TransactionClient,
    context: PurchaseOrderMutationContext,
    order: MutablePurchaseOrder,
    newStatus: PurchaseOrderPaymentStatus,
    reason: string,
  ): Promise<void> {
    const newOrderStatus = derivePurchaseOrderStatus({
      orderStatus: order.orderStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      paymentStatus: newStatus,
    })
    // 付款作废可能让完成订单重新打开。付款与订单状态必须在同一次 UPDATE 中
    // 写入，否则数据库的完成态 CHECK 会拒绝中间不一致状态。
    await transaction.purchaseOrder.update({
      where: { id: order.id },
      data: {
        orderStatus: newOrderStatus,
        paymentStatus: newStatus,
        version: { increment: 1 },
      },
    })
    if (newStatus !== order.paymentStatus) {
      await transaction.purchaseOrderStatusHistory.create({ data: {
        purchaseOrderId: order.id,
        dimension: 'PAYMENT',
        fromStatus: order.paymentStatus,
        toStatus: newStatus,
        reason,
        changedByUserId: context.actorUserId,
      } })
    }
    await this.recordAutomaticOrderStatusChange(
      transaction,
      context,
      order,
      newOrderStatus,
      'PAYMENT',
    )
  }

  private async recordAutomaticOrderStatusChange(
    transaction: Prisma.TransactionClient,
    context: PurchaseOrderMutationContext,
    order: MutablePurchaseOrder,
    newStatus: PurchaseOrderStatus,
    trigger: AutomaticOrderStatusTrigger,
  ): Promise<void> {
    if (newStatus === order.orderStatus) return
    await transaction.purchaseOrderStatusHistory.create({ data: {
      purchaseOrderId: order.id,
      dimension: 'ORDER',
      fromStatus: order.orderStatus,
      toStatus: newStatus,
      // 只为本次真实发生的自动转换生成原因；历史空值由展示层明确标记，不回填。
      reason: newStatus === 'COMPLETED'
        ? `${trigger === 'FULFILLMENT' ? '签收' : '付款'}后满足已签收且已付清，系统自动完成采购订单`
        : '付款作废后不再满足已付清，系统将采购订单恢复为已确认',
      changedByUserId: context.actorUserId,
    } })
    await this.recordAudit(transaction, context, {
      eventType: AuditEventType.PURCHASE_ORDER_ORDER_STATUS_CHANGED,
      targetId: order.id,
      metadata: {
        automatic: true,
        fromStatus: order.orderStatus,
        toStatus: newStatus,
        trigger,
      },
    })
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
