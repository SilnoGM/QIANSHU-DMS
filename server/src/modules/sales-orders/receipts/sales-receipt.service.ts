import { NumberingGeneratorService } from '../../numbering/numbering-generator.service'
import { NumberingGenerationError, NUMBERING_ERROR_CODES, NUMBERING_BOUNDARY_ERROR_CODES } from '../../numbering/numbering.errors'
import { normalizeReceiptReason as reason } from './sales-receipt-normalizer'
import { AccessControlService } from '../../access-control/access-control.service'
import { DataScopeService, dataScopeFallback } from '../../access-control/data-scope.service'
import { salesOrderScopeWhere } from '../sales-order-access'
import { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../../media/media-storage'
import { createHash } from 'node:crypto'
import { HttpStatus, Injectable } from '@nestjs/common'
import { Prisma } from '../../../generated/prisma/client'
import { AuditActorType, AuditEventType, AuditOutcome } from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AuditService } from '../../audit/audit.service'
import { DictionaryLookupService, DictionaryValueUnavailableError } from '../../dictionaries/dictionary-lookup.service'
import { MediaAssetService, MediaAssetLifecycleError } from '../../media/media-asset.service'
import { FundPostingService, type FundBusinessTransactionContext } from '../../fund-accounts/application/fund-posting.contract'
import { FundPostingError } from '../../fund-accounts/application/fund-posting.errors'
import { FundCalculationError } from '../../fund-accounts/domain/fund-calculation.errors'
import { truncateFundSourceText } from '../../fund-accounts/application/fund-source-snapshot'
import { normalizePositiveSalesOrderAmount, deriveSalesOrderPaymentStatus } from '../domain/sales-order-decimal'
import { createSalesOrderDocumentTitle } from '../domain/sales-order-document-title'
import { SalesOrderAutomaticStateService } from '../sales-order-automatic-state.service'
import { parseSalesOrderIdempotencyKey } from '../sales-order-command.normalizer'
import type { SalesOrderMutationContext } from '../sales-order-mutation.service'
import { noopSystemNotifications } from '../../notifications/noop-system-notification'
import { SystemNotificationService } from '../../notifications/system-notification.service'
import type { SystemNotificationPublishResult } from '../../notifications/notification.types'
import { formatNotificationDateTime, salesOrderPaymentTypeLabel } from '../../notifications/notification-display-labels'
import type { SalesReceiptActionDto, SalesReceiptApproveDto, SalesReceiptRejectDto, SalesReceiptRequestCreateDto, SalesReceiptApprovalContextDto } from '../dto/sales-receipt.dto'
import { SalesReceiptQueryService } from './sales-receipt-query.service'
import { assertReceiptCapacity, convertReceiptToCny, receiptFailure } from './sales-receipt-money'
import { SALES_RECEIPT_ENTRY_STATUS, SALES_RECEIPT_IN_FLIGHT_STATUSES, SALES_RECEIPT_POSTING_STATUS, isSalesReceiptInFlight } from './sales-receipt-status'
import { hasQueuedOutboundDelivery } from './sales-receipt-delivery'

type Tx = Prisma.TransactionClient
function hash(value: string) { return createHash('sha256').update(value).digest() }
function mapError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof NumberingGenerationError) {
    if (error.code === NUMBERING_ERROR_CODES.IDEMPOTENCY_CONFLICT) receiptFailure('SALES_RECEIPT_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同收款内容', HttpStatus.CONFLICT)
    if (error.code === NUMBERING_ERROR_CODES.OUTPUT_CONFLICT) receiptFailure('SALES_RECEIPT_NUMBER_CONFLICT', '销售收款编号发生冲突，请核对编号规则', HttpStatus.CONFLICT)
    if (error.code === NUMBERING_BOUNDARY_ERROR_CODES.INTERNAL_ERROR || error.code === NUMBERING_BOUNDARY_ERROR_CODES.VALIDATION_FAILED) receiptFailure('INTERNAL_ERROR', '服务器内部错误', HttpStatus.INTERNAL_SERVER_ERROR)
    if (error.code === NUMBERING_ERROR_CODES.RULE_STATE_CHANGED || error.code === NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '编号规则状态已变化，请使用原提交标识重试', HttpStatus.CONFLICT)
    receiptFailure('SALES_RECEIPT_NUMBERING_UNAVAILABLE', '销售收款编号规则当前不可用，请联系管理员配置 SALES_COLLECTION', HttpStatus.CONFLICT)
  }
  if (error instanceof DictionaryValueUnavailableError) receiptFailure('SALES_ORDER_PAYMENT_METHOD_UNAVAILABLE', '收款方式当前不可用')
  if (error instanceof MediaAssetLifecycleError) receiptFailure('SALES_ORDER_DOCUMENT_UNAVAILABLE', '收款凭证当前不可用')
  if (error instanceof FundPostingError) {
    if (error.code === 'FUND_CONCURRENT_STATE_CHANGED') receiptFailure('SALES_RECEIPT_CONTEXT_CHANGED', '入账规则或比例已变化，请重新核对', HttpStatus.CONFLICT)
    if (error.code === 'FUND_REVERSAL_STATE_CHANGED') receiptFailure('SALES_RECEIPT_REVERSAL_CONFLICT', '原收款入账已发生冲正，无法重复作废', HttpStatus.CONFLICT)
    receiptFailure('SALES_RECEIPT_POSTING_UNAVAILABLE', '账户或入账规则当前不可用')
  }
  if (error instanceof FundCalculationError) receiptFailure('SALES_RECEIPT_POSTING_UNAVAILABLE', '当前金额无法按入账规则计算')
  throw error
}

@Injectable()
export class SalesReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: SalesReceiptQueryService,
    private readonly dictionary: DictionaryLookupService,
    private readonly media: MediaAssetService,
    private readonly funds: FundPostingService,
    private readonly audit: AuditService,
    private readonly automatic: SalesOrderAutomaticStateService,
    private readonly access: AccessControlService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly numbering: NumberingGeneratorService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
    private readonly notifications: SystemNotificationService = noopSystemNotifications,
  ) {}

  private async authorize(tx: Tx, context: SalesOrderMutationContext, codes: string[]) {
    const user = await tx.user.findUnique({ where: { id: context.actorUserId }, select: { status: true } })
    const granted = await this.access.getPermissionCodesInTransaction(tx, context.actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(granted, codes)) receiptFailure('FORBIDDEN', '权限不足', HttpStatus.FORBIDDEN)
  }
  private async verifyVoucher(objectKey: string) {
    try {
      const stored = await this.delivery.stat(requireMediaObjectKeyNamespace(objectKey, 'assets'))
      if (!stored) receiptFailure('SALES_ORDER_DOCUMENT_UNAVAILABLE', '收款凭证文件不存在')
    } catch (error) {
      if (error instanceof ApiException) throw error
      receiptFailure('MEDIA_STORAGE_UNAVAILABLE', '凭证存储暂时不可用', HttpStatus.SERVICE_UNAVAILABLE)
    }
  }
  private async lockOrder(tx: Tx, id: string, actorUserId: string) {
    const scope = await this.dataScope.resolveInTransaction(tx, actorUserId)
    const scopeSql = scope === 'SELF'
      ? Prisma.sql`AND "issuer_user_id" = CAST(${actorUserId} AS uuid)`
      : Prisma.sql``
    await tx.$queryRaw(Prisma.sql`SELECT id FROM sales_orders WHERE id = ${id}::uuid ${scopeSql} FOR UPDATE`)
    const order = await tx.salesOrder.findFirst({
      where: { id, ...salesOrderScopeWhere(scope, actorUserId) },
    })
    if (!order) return receiptFailure('SALES_ORDER_NOT_FOUND', '销售订单不存在', HttpStatus.NOT_FOUND)
    return order
  }
  private assertOpen(order: { orderStatus: string }) {
    if (order.orderStatus === 'COMPLETED') receiptFailure('SALES_ORDER_COMPLETED', '已完成订单不能操作收款')
    if (order.orderStatus === 'CANCELLED') receiptFailure('SALES_ORDER_CANCELLED', '已取消订单不能操作收款')
    if (order.orderStatus === 'TERMINATED') receiptFailure('SALES_ORDER_TERMINATED', '已终止订单不能操作收款')
  }
  private async lockRequest(tx: Tx, id: string, actorUserId: string) {
    const locator = await tx.salesReceiptRequest.findUnique({ where: { id }, select: { salesOrderId: true } })
    if (!locator) return receiptFailure('SALES_RECEIPT_NOT_FOUND', '收款申请不存在', HttpStatus.NOT_FOUND)
    const order = await this.lockOrder(tx, locator.salesOrderId, actorUserId)
    await tx.$queryRaw(Prisma.sql`SELECT id FROM sales_receipt_requests WHERE id = ${id}::uuid FOR UPDATE`)
    const row = await tx.salesReceiptRequest.findUniqueOrThrow({ where: { id } })
    return { order, row }
  }
  private async capacity(tx: Tx, salesOrderId: string, total: string, additional = '0.00') {
    const [paid, pending] = await Promise.all([
      tx.salesOrderPayment.aggregate({ where: { salesOrderId, voidedAt: null }, _sum: { amount: true } }),
      tx.salesReceiptRequest.aggregate({ where: { salesOrderId, status: { in: [...SALES_RECEIPT_IN_FLIGHT_STATUSES] } }, _sum: { amount: true } }),
    ])
    assertReceiptCapacity(total, paid._sum.amount?.toFixed(2) ?? '0.00', pending._sum.amount?.toFixed(2) ?? '0.00', additional)
  }
  private auditEvent(tx: Tx, context: SalesOrderMutationContext, eventType: AuditEventType, targetId: string, salesOrderId: string, metadata: Record<string, unknown> = {}) {
    return this.audit.record(tx, { eventType, outcome: AuditOutcome.SUCCESS, actorType: AuditActorType.USER,
      actorUserId: context.actorUserId, targetType: eventType === AuditEventType.SALES_ORDER_PAYMENT_VOIDED ? 'SALES_ORDER_PAYMENT' : 'SALES_RECEIPT_REQUEST', targetId, requestId: context.requestId, metadata: { salesOrderId, ...metadata } })
  }
  private fundContext(context: SalesOrderMutationContext, action: 'APPROVE' | 'VOID'): FundBusinessTransactionContext {
    return { ...context, sourceCode: 'SALES_RECEIPT', consumerCode: `SALES_RECEIPT.${action}` }
  }
  private async updatePaymentStatus(tx: Tx, context: SalesOrderMutationContext, order: { id: string, agreedTotalAmount: Prisma.Decimal, paymentStatus: string }, advance: boolean, changeReason: string) {
    const paid = await tx.salesOrderPayment.aggregate({ where: { salesOrderId: order.id, voidedAt: null }, _sum: { amount: true } })
    const paymentStatus = deriveSalesOrderPaymentStatus(order.agreedTotalAmount.toFixed(2), paid._sum.amount?.toFixed(2) ?? '0.00')
    await tx.salesOrder.update({ where: { id: order.id }, data: { paymentStatus, version: { increment: 1 } } })
    if (paymentStatus !== order.paymentStatus) await tx.salesOrderStatusHistory.create({ data: { salesOrderId: order.id, dimension: 'PAYMENT', fromStatus: order.paymentStatus, toStatus: paymentStatus, reason: changeReason, changedByUserId: context.actorUserId } })
    if (advance) await this.automatic.advanceWhenEligible(tx, context, order.id, 'PAYMENT')
  }
  private async rate(tx: Tx, currencyCode: string) {
    // 与汇率写入端保持 Currency → ExchangeRate 的确定锁序，不依赖 JOIN 执行计划。
    const currencies = await tx.$queryRaw<Array<{ id: string, enabled: boolean }>>(Prisma.sql`
      SELECT id, enabled FROM currencies WHERE code = ${currencyCode} FOR SHARE`)
    const currency = currencies[0]
    if (!currency?.enabled) return receiptFailure('SALES_RECEIPT_RATE_UNAVAILABLE', '订单币种当前缺少有效汇率')
    const rows = await tx.$queryRaw<Array<{ id: string, version: number, rate: Prisma.Decimal }>>(Prisma.sql`
      SELECT id, version, foreign_units_per_cny AS rate FROM exchange_rates
      WHERE currency_id = ${currency.id}::uuid FOR SHARE`)
    const rate = rows[0]
    if (!rate || rate.rate.lte(0)) return receiptFailure('SALES_RECEIPT_RATE_UNAVAILABLE', '订单币种当前缺少有效汇率')
    return rate
  }
  private postingInput(
    row: {
      id: string
      accountOwnerUserId: string
      receivedAt: Date
      paymentType: string
      paymentMethodNameSnapshot: string
      remark: string | null
    },
    order: { id: string, orderNo: string, customerName: string },
    amount: string,
  ) {
    const paymentTypeLabel = salesOrderPaymentTypeLabel(row.paymentType)
    return {
      postingTypeCode: 'ORDER_SETTLEMENT', userId: row.accountOwnerUserId, amount, businessId: row.id, businessNo: order.orderNo,
      summary: '销售收款审核入账',
      // 来源说明只服务展示，不参与幂等指纹；客户与订单来自本次事务内已锁定的订单行。
      source: {
        headline: `${order.customerName} · 销售${paymentTypeLabel}收款`,
        subject: order.customerName,
        action: `销售${paymentTypeLabel}收款`,
        customerName: order.customerName,
        documentNo: order.orderNo,
        link: { kind: 'SALES_ORDER' as const, id: order.id },
        detail: [
          { label: '收款类型', value: paymentTypeLabel },
          { label: '收款方式', value: row.paymentMethodNameSnapshot },
          ...(row.remark
            ? [{ label: '备注', value: truncateFundSourceText(row.remark) }]
            : []),
        ],
      },
      businessOccurredAt: row.receivedAt.toISOString(), idempotencyKey: row.id,
    }
  }

  async submit(context: SalesOrderMutationContext, salesOrderId: string, input: SalesReceiptRequestCreateDto, key: unknown) {
    const idempotencyKeyHash = hash(parseSalesOrderIdempotencyKey(key))
    const amount = normalizePositiveSalesOrderAmount(input.amount)
    const receivedAt = new Date(input.receivedAt)
    if (!Number.isFinite(receivedAt.getTime()) || receivedAt.toISOString() !== input.receivedAt || receivedAt > new Date()) receiptFailure('VALIDATION_FAILED', '收款时间必须是有效且不晚于当前时间的 UTC 时间')
    const normalized = { salesOrderId, paymentType: input.paymentType, amount, receivedAt: receivedAt.toISOString(), paymentMethod: input.paymentMethod.trim().normalize('NFKC'), remark: reason(input.remark), voucherMediaAssetId: input.voucher.mediaAssetId, resubmittedFromId: input.resubmittedFromId ?? null }
    if ([...normalized.paymentMethod].length < 1 || [...normalized.paymentMethod].length > 64) receiptFailure('VALIDATION_FAILED', '收款方式格式无效')
    const requestFingerprintHash = hash(JSON.stringify({ format: 'sales-receipt.submit.v1', ...normalized }))
    const replay = async (tx: Pick<Tx, 'salesReceiptRequest'>) => {
      const existing = await tx.salesReceiptRequest.findFirst({ where: { submittedByUserId: context.actorUserId, idempotencyKeyHash } })
      if (existing && !Buffer.from(existing.requestFingerprintHash).equals(requestFingerprintHash)) receiptFailure('SALES_RECEIPT_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同收款内容', HttpStatus.CONFLICT)
      return existing
    }
    let id: string
    try {
      id = await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context, ['sales-orders:payment', 'sales-orders:document'])
        const order = await this.lockOrder(tx, salesOrderId, context.actorUserId)
        const previous = await replay(tx)
        if (previous) return previous.id
        this.assertOpen(order)
        const method = await this.dictionary.requireEffectiveValue(tx, { dictionaryCode: 'payment.method', value: normalized.paymentMethod })
        await this.capacity(tx, salesOrderId, order.agreedTotalAmount.toFixed(2), amount)
        let reuse = false
        if (normalized.resubmittedFromId) {
          await this.authorize(tx, context, ['sales-orders:read'])
          const source = await tx.salesReceiptRequest.findFirst({ where: { id: normalized.resubmittedFromId, salesOrderId, status: 'REJECTED' } })
          if (!source) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '只能重新提交本订单已驳回的申请', HttpStatus.CONFLICT)
          reuse = source.voucherMediaAssetId === normalized.voucherMediaAssetId
        }
        await tx.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id = ${normalized.voucherMediaAssetId}::uuid FOR UPDATE`)
        // 新提交与重提都只接受图片；历史 DOCUMENT 申请仍可在审批侧读取，但不能再作为新申请凭证。
        const asset = await tx.mediaAsset.findFirst({ where: { id: normalized.voucherMediaAssetId, status: reuse ? 'READY' : 'UPLOADING', ...(reuse ? {} : { createdByUserId: context.actorUserId }), mediaType: 'IMAGE', deletedAt: null, objectKey: { not: null } } })
        if (!asset) receiptFailure('SALES_ORDER_DOCUMENT_UNAVAILABLE', '所选收款凭证不可用；收款凭证仅支持图片（JPG/PNG/WebP）')
        if (!reuse && await tx.salesReceiptRequest.count({ where: { voucherMediaAssetId: asset.id } }) > 0) receiptFailure('SALES_ORDER_DOCUMENT_UNAVAILABLE', '收款凭证已关联其他申请')
        await this.verifyVoucher(asset.objectKey!)
        await this.media.activate(tx, asset.id)
        // 发号与申请共用事务；后续任何写入失败都会回滚派发表及期间计数。
        // 编号域的幂等键跨用户唯一，复用提交时冻结的摘要而不暴露原始请求键。
        const issuance = await this.numbering.generateScopedInTransaction(tx, {
          ruleCode: 'SALES_COLLECTION', consumerCode: 'SALES_COLLECTION.CREATE',
          idempotencyKey: `${context.actorUserId}:${idempotencyKeyHash.toString('hex')}`,
          requestFingerprint: requestFingerprintHash.toString('hex'),
        })
        const row = await tx.salesReceiptRequest.create({ data: { ...normalized, receivedAt, accountOwnerUserId: order.issuerUserId, currencyCode: order.currencyCode,
          paymentMethodNameSnapshot: method.label, voucherTitle: createSalesOrderDocumentTitle(order.customerName, input.paymentType, new Date()),
          submittedByUserId: context.actorUserId, idempotencyKeyHash, requestFingerprintHash, collectionNo: issuance.number, numberingIssuanceId: issuance.issuanceId } })
        await this.auditEvent(tx, context, AuditEventType.SALES_RECEIPT_SUBMITTED, row.id, salesOrderId)
        await this.notifications.publish({
          eventType: 'SALES_RECEIPT_REVIEW_PENDING',
          source: { type: 'SALES_RECEIPT_REQUEST', id: row.id },
          target: { kind: 'PERMISSION', permissionCode: 'sales-receipts:review' },
          templateKey: 'sales.receipt.pending',
          variables: {
            amount: row.amount.toFixed(2),
            collectionNo: row.collectionNo ?? '',
            currencyCode: row.currencyCode,
            customerName: order.customerName,
            orderNo: order.orderNo,
            paymentMethod: row.paymentMethodNameSnapshot,
            paymentType: salesOrderPaymentTypeLabel(row.paymentType),
            receivedAt: formatNotificationDateTime(row.receivedAt),
            remark: row.remark ?? '',
          },
          // 凭证已在本次事务内激活为 READY；这里只传资产 ID，是否真正发送由模板附件策略裁决。
          media: [{ assetId: row.voucherMediaAssetId, sourceKey: 'salesReceipt.voucher' }],
          dedupeKey: `sales-receipt-review:${row.id}:v${row.version}`,
          requestedByUserId: context.actorUserId,
        }, { transaction: tx })
        return row.id
      })
    } catch (error) {
      // 唯一键竞争使事务失效，必须在外层回滚结束后才读取已经提交的幂等结果。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await replay(this.prisma)
        if (existing) return this.query.getById(existing.id, context.actorUserId)
      }
      return mapError(error)
    }
    return this.query.getById(id, context.actorUserId)
  }

  async approvalContext(context: SalesOrderMutationContext, id: string): Promise<SalesReceiptApprovalContextDto> {
    try {
      return await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context, ['sales-receipts:review'])
        const { order, row } = await this.lockRequest(tx, id, context.actorUserId)
        if (row.status !== SALES_RECEIPT_POSTING_STATUS) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '申请尚未进入待入账', HttpStatus.CONFLICT)
        this.assertOpen(order)
        const rate = await this.rate(tx, row.currencyCode)
        const amount = convertReceiptToCny(row.amount.toFixed(2), rate.rate.toFixed(4))
        const preview = await this.funds.previewBusinessEventInTransaction(tx, this.fundContext(context, 'APPROVE'), this.postingInput(row, order, amount))
        return { expectedContext: { orderVersion: order.version, exchangeRateId: rate.id, exchangeRateVersion: rate.version, ruleVersionId: preview.ruleVersionId, userShareRate: preview.userShareRate ?? '0.00' },
          foreignUnitsPerCny: rate.rate.toFixed(4), businessAmount: preview.businessAmount, userShareRate: preview.userShareRate, companyShareRate: preview.companyShareRate, entries: [...preview.entries] }
      })
    } catch (error) { return mapError(error) }
  }

  async approve(context: SalesOrderMutationContext, id: string, input: SalesReceiptApproveDto) {
    try {
      await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context, ['sales-receipts:review'])
        const { order, row } = await this.lockRequest(tx, id, context.actorUserId)
        const reviewRemark = reason(input.reason)
        if (row.status === 'APPROVED' && row.reviewedByUserId === context.actorUserId && row.reviewRemark === reviewRemark) return
        if (row.status !== SALES_RECEIPT_POSTING_STATUS || row.version !== input.expectedVersion) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '申请已变化，请刷新后重试', HttpStatus.CONFLICT)
        this.assertOpen(order)
        if (order.version !== input.expectedContext.orderVersion) receiptFailure('SALES_RECEIPT_CONTEXT_CHANGED', '订单已变化，请重新核对', HttpStatus.CONFLICT)
        await this.capacity(tx, order.id, order.agreedTotalAmount.toFixed(2))
        const rate = await this.rate(tx, row.currencyCode)
        if (rate.id !== input.expectedContext.exchangeRateId || rate.version !== input.expectedContext.exchangeRateVersion) receiptFailure('SALES_RECEIPT_CONTEXT_CHANGED', '当前汇率已变化，请重新核对', HttpStatus.CONFLICT)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id = ${row.voucherMediaAssetId}::uuid FOR SHARE`)
        // 不改媒体类型过滤：改动前已提交的历史 DOCUMENT 收款申请必须仍可审批，避免在途申请卡死。
        const asset = await tx.mediaAsset.findFirst({ where: { id: row.voucherMediaAssetId, status: 'READY', deletedAt: null, objectKey: { not: null } } })
        if (!asset) receiptFailure('SALES_ORDER_DOCUMENT_UNAVAILABLE', '收款凭证当前不可用')
        await this.verifyVoucher(asset.objectKey!)
        const amount = convertReceiptToCny(row.amount.toFixed(2), rate.rate.toFixed(4))
        const posting = await this.funds.postBusinessEventInTransaction(tx, this.fundContext(context, 'APPROVE'), this.postingInput(row, order, amount), { ruleVersionId: input.expectedContext.ruleVersionId, userShareRate: input.expectedContext.userShareRate })
        // 统一使用应用时钟：不再把数据库读出的时间再经 Prisma 写回，避免适配器按会话时区重解释。
        const now = new Date()
        const payment = await tx.salesOrderPayment.create({ data: { salesOrderId: order.id, paymentType: row.paymentType, amount: row.amount, receivedAt: row.receivedAt, paymentMethod: row.paymentMethod, remark: row.remark, createdByUserId: context.actorUserId,
          origin: 'REVIEWED', fundPostingBatchId: posting.batchId, exchangeRateId: rate.id, exchangeRateVersionSnapshot: rate.version, foreignUnitsPerCnySnapshot: rate.rate, exchangeRateCapturedAt: now } })
        await tx.salesOrderDocument.create({ data: { salesOrderId: order.id, paymentId: payment.id, mediaAssetId: row.voucherMediaAssetId, documentType: 'PAYMENT_VOUCHER', title: row.voucherTitle, createdByUserId: context.actorUserId } })
        await tx.salesReceiptRequest.update({ where: { id }, data: { status: 'APPROVED', reviewedByUserId: context.actorUserId, reviewedAt: now, reviewRemark, approvedPaymentId: payment.id, version: { increment: 1 } } })
        await this.updatePaymentStatus(tx, context, order, true, reviewRemark ?? '收款审核通过，系统重新计算付款状态')
        await this.auditEvent(tx, context, AuditEventType.SALES_RECEIPT_APPROVED, id, order.id, { fromStatus: row.status })
        await this.notifications.publish({
          eventType: 'SALES_RECEIPT_APPROVED',
          source: { type: 'SALES_RECEIPT_REQUEST', id },
          target: { kind: 'USERS', userIds: [row.submittedByUserId] },
          templateKey: 'sales.receipt.approved',
          variables: {
            amount: row.amount.toFixed(2),
            collectionNo: row.collectionNo ?? '',
            currencyCode: row.currencyCode,
            orderNo: order.orderNo,
            paymentMethod: row.paymentMethodNameSnapshot,
            paymentType: salesOrderPaymentTypeLabel(row.paymentType),
            receivedAt: formatNotificationDateTime(row.receivedAt),
            remark: row.remark ?? '',
          },
          media: [{ assetId: row.voucherMediaAssetId, sourceKey: 'salesReceipt.voucher' }],
          dedupeKey: `sales-receipt-approved:${id}:v${row.version + 1}`,
          priority: 'NORMAL',
          requestedByUserId: context.actorUserId,
        }, { transaction: tx })
      })
    } catch (error) { return mapError(error) }
    return this.query.getById(id, context.actorUserId)
  }

  async reject(context: SalesOrderMutationContext, id: string, input: SalesReceiptRejectDto) {
    const reviewRemark = reason(input.reason)
    if (!reviewRemark) receiptFailure('VALIDATION_FAILED', '必须填写驳回原因')
    await this.prisma.$transaction(async tx => {
      await applyTransactionTimeouts(tx)
      await this.authorize(tx, context, ['sales-receipts:review'])
      const { order, row } = await this.lockRequest(tx, id, context.actorUserId)
      if (row.status === 'REJECTED' && row.reviewedByUserId === context.actorUserId && row.reviewRemark === reviewRemark) return
      // 三个阶段都允许驳回：财务在任一环节发现金额或凭证问题都能退回重提。
      if (!isSalesReceiptInFlight(row.status) || row.version !== input.expectedVersion) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '申请已变化，请刷新后重试', HttpStatus.CONFLICT)
      const now = new Date()
      await tx.salesReceiptRequest.update({ where: { id }, data: { status: 'REJECTED', reviewedByUserId: context.actorUserId, reviewedAt: now, reviewRemark, version: { increment: 1 } } })
      await this.auditEvent(tx, context, AuditEventType.SALES_RECEIPT_REJECTED, id, order.id, { fromStatus: row.status })
      await this.notifications.publish({
        eventType: 'SALES_RECEIPT_REJECTED',
        source: { type: 'SALES_RECEIPT_REQUEST', id },
        target: { kind: 'USERS', userIds: [row.submittedByUserId] },
        templateKey: 'sales.receipt.rejected',
        variables: {
          amount: row.amount.toFixed(2),
          collectionNo: row.collectionNo ?? '',
          currencyCode: row.currencyCode,
          orderNo: order.orderNo,
          paymentMethod: row.paymentMethodNameSnapshot,
          paymentType: salesOrderPaymentTypeLabel(row.paymentType),
          receivedAt: formatNotificationDateTime(row.receivedAt),
          reason: reviewRemark,
          remark: row.remark ?? '',
        },
        media: [{ assetId: row.voucherMediaAssetId, sourceKey: 'salesReceipt.voucher' }],
        dedupeKey: `sales-receipt-rejected:${id}:v${row.version + 1}`,
        requestedByUserId: context.actorUserId,
      }, { transaction: tx })
    })
    return this.query.getById(id, context.actorUserId)
  }

  /**
   * 表外水单发送：文案 + 收款凭证图片播报到财务群。
   *
   * publish 对配置问题不抛异常，只返回 SKIPPED/FAILED，所以这里在业务事务内失败关闭：
   * 抛出 ApiException 会让通知行、通知编号与状态变更一起回滚，申请留在「待发群」。
   * 判定同时覆盖「群渠道已入队」与「凭证图片未被附件策略拦下」，避免只发正文。
   */
  private async publishVoucherToGroup(
    tx: Tx,
    context: SalesOrderMutationContext,
    row: {
      id: string
      amount: Prisma.Decimal
      collectionNo: string | null
      currencyCode: string
      paymentType: string
      paymentMethodNameSnapshot: string
      receivedAt: Date
      remark: string | null
      voucherMediaAssetId: string
      version: number
    },
    order: { orderNo: string, customerName: string },
  ): Promise<SystemNotificationPublishResult> {
    let result: SystemNotificationPublishResult
    try {
      result = await this.notifications.publish({
        eventType: 'SALES_RECEIPT_VOUCHER_SENT',
        source: { type: 'SALES_RECEIPT_REQUEST', id: row.id },
        // 群目标由 ASSISTANT 渠道策略覆盖；命令目标只服务可能配置的站内渠道。
        target: { kind: 'PERMISSION', permissionCode: 'sales-receipts:review' },
        templateKey: 'sales.receipt.voucher-sent',
        variables: {
          amount: row.amount.toFixed(2),
          collectionNo: row.collectionNo ?? '',
          currencyCode: row.currencyCode,
          customerName: order.customerName,
          orderNo: order.orderNo,
          paymentMethod: row.paymentMethodNameSnapshot,
          paymentType: salesOrderPaymentTypeLabel(row.paymentType),
          receivedAt: formatNotificationDateTime(row.receivedAt),
          remark: row.remark ?? '',
        },
        media: [{ assetId: row.voucherMediaAssetId, sourceKey: 'salesReceipt.voucher' }],
        dedupeKey: `sales-receipt-voucher-sent:${row.id}:v${row.version}`,
        requestedByUserId: context.actorUserId,
      }, { transaction: tx })
    } catch (error) {
      if (error instanceof ApiException) throw error
      // 通知编号规则不可用等底层错误统一翻译，避免被 mapError 误报成销售收款编号问题。
      receiptFailure('SALES_RECEIPT_VOUCHER_SEND_UNAVAILABLE', '水单发送失败，请检查群通知配置后重试')
    }
    if (result.duplicated || !hasQueuedOutboundDelivery(result.channels)) {
      receiptFailure('SALES_RECEIPT_VOUCHER_SEND_UNAVAILABLE', '水单未进入群发送队列，请检查群目标、模板与渠道配置')
    }
    // 凭证必须真正进入某一外发渠道的附件队列；notification_media 的 blockedReason
    // 只反映 ASSISTANT 侧的模板策略，WECOM-only 时会有 CHANNEL_DISABLED 的占位行，
    // 因此以实际投递附件行为准。
    const queuedMedia = await tx.assistantDeliveryMedia.findFirst({
      where: {
        mediaAssetId: row.voucherMediaAssetId,
        status: 'PENDING',
        delivery: { notificationId: result.notificationId, status: 'PENDING' },
      },
      select: { id: true },
    }) ?? await tx.wecomDeliveryMedia.findFirst({
      where: {
        mediaAssetId: row.voucherMediaAssetId,
        status: 'PENDING',
        delivery: { notificationId: result.notificationId, status: 'PENDING' },
      },
      select: { id: true },
    })
    if (queuedMedia === null) {
      receiptFailure('SALES_RECEIPT_VOUCHER_SEND_UNAVAILABLE', '收款凭证图片未进入发送队列，请检查模板附件策略')
    }
    return result
  }

  /** 第一步：财务确认凭证可对外播报，发送水单后进入待确认。 */
  async sendVoucher(context: SalesOrderMutationContext, id: string, input: SalesReceiptActionDto) {
    try {
      await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context, ['sales-receipts:review'])
        const { order, row } = await this.lockRequest(tx, id, context.actorUserId)
        // 同一操作者的网络重试：状态已经推进到下一步即视为成功，不重复播报。
        if (row.status === 'PENDING_CONFIRM' && row.voucherSentByUserId === context.actorUserId && row.version === input.expectedVersion + 1) return
        if (row.status !== SALES_RECEIPT_ENTRY_STATUS || row.version !== input.expectedVersion) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '申请已变化，请刷新后重试', HttpStatus.CONFLICT)
        this.assertOpen(order)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id = ${row.voucherMediaAssetId}::uuid FOR SHARE`)
        const asset = await tx.mediaAsset.findFirst({ where: { id: row.voucherMediaAssetId, status: 'READY', deletedAt: null, objectKey: { not: null } }, select: { mediaType: true, objectKey: true } })
        if (!asset) receiptFailure('SALES_ORDER_DOCUMENT_UNAVAILABLE', '收款凭证当前不可用')
        // 水单必须是图片：PDF 凭证无法进入通知附件，只能驳回后换图片重提。
        if (asset.mediaType !== 'IMAGE') receiptFailure('SALES_RECEIPT_VOUCHER_NOT_IMAGE', '凭证为 PDF，无法作为水单图片发送；请驳回后重新上传图片')
        await this.verifyVoucher(asset.objectKey!)
        const now = new Date()
        const next = await tx.salesReceiptRequest.update({ where: { id },
          data: { status: 'PENDING_CONFIRM', voucherSentByUserId: context.actorUserId, voucherSentAt: now, version: { increment: 1 } } })
        await this.auditEvent(tx, context, AuditEventType.SALES_RECEIPT_VOUCHER_SENT, id, order.id, { fromStatus: row.status })
        await this.publishVoucherToGroup(tx, context, next, order)
      })
    } catch (error) { return mapError(error) }
    return this.query.getById(id, context.actorUserId)
  }

  /**
   * 第二步：财务确认款项已经到账。
   *
   * 只推进状态与证据，不生成正式收款、不改订单付款状态；金额与入账规则仍在第三步核对。
   * 本期不为这一步单独发通知，群里的水单本身就是交接信号。
   */
  async confirm(context: SalesOrderMutationContext, id: string, input: SalesReceiptActionDto) {
    try {
      await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context, ['sales-receipts:review'])
        const { order, row } = await this.lockRequest(tx, id, context.actorUserId)
        if (row.status === 'PENDING_POSTING' && row.confirmedByUserId === context.actorUserId && row.version === input.expectedVersion + 1) return
        if (row.status !== 'PENDING_CONFIRM' || row.version !== input.expectedVersion) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '申请已变化，请刷新后重试', HttpStatus.CONFLICT)
        this.assertOpen(order)
        const now = new Date()
        await tx.salesReceiptRequest.update({ where: { id },
          data: { status: 'PENDING_POSTING', confirmedByUserId: context.actorUserId, confirmedAt: now, version: { increment: 1 } } })
        await this.auditEvent(tx, context, AuditEventType.SALES_RECEIPT_CONFIRMED, id, order.id, { fromStatus: row.status })
      })
    } catch (error) { return mapError(error) }
    return this.query.getById(id, context.actorUserId)
  }

  async voidPayment(context: SalesOrderMutationContext, salesOrderId: string, paymentId: string, input: { reason: string, expectedOrderVersion: number }) {
    const voidReason = reason(input.reason)
    if (!voidReason) receiptFailure('VALIDATION_FAILED', '必须填写作废原因')
    try {
      await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context, ['sales-receipts:void'])
        const order = await this.lockOrder(tx, salesOrderId, context.actorUserId)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM sales_order_payments WHERE id = ${paymentId}::uuid FOR UPDATE`)
        const payment = await tx.salesOrderPayment.findFirst({ where: { id: paymentId, salesOrderId }, include: { fundPostingBatch: true } })
        if (!payment) receiptFailure('SALES_ORDER_PAYMENT_NOT_FOUND', '收款记录不存在', HttpStatus.NOT_FOUND)
        if (payment.voidedAt && payment.voidedByUserId === context.actorUserId && payment.voidReason === voidReason) return
        if (payment.voidedAt || order.version !== input.expectedOrderVersion) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '订单或收款记录已变化，请刷新后重试', HttpStatus.CONFLICT)
        if (order.orderStatus === 'COMPLETED') receiptFailure('SALES_ORDER_COMPLETED', '已完成订单不能作废收款')
        let fundReversalBatchId: string | null = null
        if (payment.origin === 'REVIEWED') {
          if (!payment.fundPostingBatch) receiptFailure('SALES_RECEIPT_REVERSAL_CONFLICT', '表外收款缺少原入账记录', HttpStatus.CONFLICT)
          const reversed = await this.funds.reverseBusinessEventInTransaction(tx, this.fundContext(context, 'VOID'), { originalBatchId: payment.fundPostingBatch.id, amount: payment.fundPostingBatch.businessAmount.toFixed(2), reason: voidReason, idempotencyKey: payment.id })
          fundReversalBatchId = reversed.batchId
        }
        const now = new Date()
        await tx.salesOrderPayment.update({ where: { id: paymentId }, data: { voidedAt: now, voidedByUserId: context.actorUserId, voidReason, fundReversalBatchId } })
        await this.updatePaymentStatus(tx, context, order, false, voidReason)
        await this.auditEvent(tx, context, AuditEventType.SALES_ORDER_PAYMENT_VOIDED, paymentId, salesOrderId)
      })
    } catch (error) { return mapError(error) }
    return { paymentId, salesOrderId }
  }
}
