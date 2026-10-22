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
import { normalizePositiveSalesOrderAmount, deriveSalesOrderPaymentStatus } from '../domain/sales-order-decimal'
import { createSalesOrderDocumentTitle } from '../domain/sales-order-document-title'
import { SalesOrderAutomaticStateService } from '../sales-order-automatic-state.service'
import { parseSalesOrderIdempotencyKey } from '../sales-order-command.normalizer'
import type { SalesOrderMutationContext } from '../sales-order-mutation.service'
import type { SalesReceiptApproveDto, SalesReceiptRejectDto, SalesReceiptRequestCreateDto, SalesReceiptApprovalContextDto } from '../dto/sales-receipt.dto'
import { SalesReceiptQueryService } from './sales-receipt-query.service'
import { assertReceiptCapacity, convertReceiptToCny, receiptFailure } from './sales-receipt-money'

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
      tx.salesReceiptRequest.aggregate({ where: { salesOrderId, status: 'PENDING_REVIEW' }, _sum: { amount: true } }),
    ])
    assertReceiptCapacity(total, paid._sum.amount?.toFixed(2) ?? '0.00', pending._sum.amount?.toFixed(2) ?? '0.00', additional)
  }
  private auditEvent(tx: Tx, context: SalesOrderMutationContext, eventType: AuditEventType, targetId: string, salesOrderId: string) {
    return this.audit.record(tx, { eventType, outcome: AuditOutcome.SUCCESS, actorType: AuditActorType.USER,
      actorUserId: context.actorUserId, targetType: eventType === AuditEventType.SALES_ORDER_PAYMENT_VOIDED ? 'SALES_ORDER_PAYMENT' : 'SALES_RECEIPT_REQUEST', targetId, requestId: context.requestId, metadata: { salesOrderId } })
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
  private postingInput(row: { id: string, accountOwnerUserId: string, receivedAt: Date }, orderNo: string, amount: string) {
    return { postingTypeCode: 'ORDER_SETTLEMENT', userId: row.accountOwnerUserId, amount, businessId: row.id, businessNo: orderNo,
      summary: '销售收款审核入账', businessOccurredAt: row.receivedAt.toISOString(), idempotencyKey: row.id }
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
        const asset = await tx.mediaAsset.findFirst({ where: { id: normalized.voucherMediaAssetId, status: reuse ? 'READY' : 'UPLOADING', ...(reuse ? {} : { createdByUserId: context.actorUserId }), mediaType: { in: ['IMAGE', 'DOCUMENT'] }, deletedAt: null, objectKey: { not: null } } })
        if (!asset) receiptFailure('SALES_ORDER_DOCUMENT_UNAVAILABLE', '所选收款凭证当前不可用')
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
        if (row.status !== 'PENDING_REVIEW') receiptFailure('SALES_RECEIPT_STATE_CHANGED', '申请已处理', HttpStatus.CONFLICT)
        this.assertOpen(order)
        const rate = await this.rate(tx, row.currencyCode)
        const amount = convertReceiptToCny(row.amount.toFixed(2), rate.rate.toFixed(4))
        const preview = await this.funds.previewBusinessEventInTransaction(tx, this.fundContext(context, 'APPROVE'), this.postingInput(row, order.orderNo, amount))
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
        if (row.status !== 'PENDING_REVIEW' || row.version !== input.expectedVersion) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '申请已变化，请刷新后重试', HttpStatus.CONFLICT)
        this.assertOpen(order)
        if (order.version !== input.expectedContext.orderVersion) receiptFailure('SALES_RECEIPT_CONTEXT_CHANGED', '订单已变化，请重新核对', HttpStatus.CONFLICT)
        await this.capacity(tx, order.id, order.agreedTotalAmount.toFixed(2))
        const rate = await this.rate(tx, row.currencyCode)
        if (rate.id !== input.expectedContext.exchangeRateId || rate.version !== input.expectedContext.exchangeRateVersion) receiptFailure('SALES_RECEIPT_CONTEXT_CHANGED', '当前汇率已变化，请重新核对', HttpStatus.CONFLICT)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id = ${row.voucherMediaAssetId}::uuid FOR SHARE`)
        const asset = await tx.mediaAsset.findFirst({ where: { id: row.voucherMediaAssetId, status: 'READY', deletedAt: null, objectKey: { not: null } } })
        if (!asset) receiptFailure('SALES_ORDER_DOCUMENT_UNAVAILABLE', '收款凭证当前不可用')
        await this.verifyVoucher(asset.objectKey!)
        const amount = convertReceiptToCny(row.amount.toFixed(2), rate.rate.toFixed(4))
        const posting = await this.funds.postBusinessEventInTransaction(tx, this.fundContext(context, 'APPROVE'), this.postingInput(row, order.orderNo, amount), { ruleVersionId: input.expectedContext.ruleVersionId, userShareRate: input.expectedContext.userShareRate })
        // 统一使用应用时钟：不再把数据库读出的时间再经 Prisma 写回，避免适配器按会话时区重解释。
        const now = new Date()
        const payment = await tx.salesOrderPayment.create({ data: { salesOrderId: order.id, paymentType: row.paymentType, amount: row.amount, receivedAt: row.receivedAt, paymentMethod: row.paymentMethod, remark: row.remark, createdByUserId: context.actorUserId,
          origin: 'REVIEWED', fundPostingBatchId: posting.batchId, exchangeRateId: rate.id, exchangeRateVersionSnapshot: rate.version, foreignUnitsPerCnySnapshot: rate.rate, exchangeRateCapturedAt: now } })
        await tx.salesOrderDocument.create({ data: { salesOrderId: order.id, paymentId: payment.id, mediaAssetId: row.voucherMediaAssetId, documentType: 'PAYMENT_VOUCHER', title: row.voucherTitle, createdByUserId: context.actorUserId } })
        await tx.salesReceiptRequest.update({ where: { id }, data: { status: 'APPROVED', reviewedByUserId: context.actorUserId, reviewedAt: now, reviewRemark, approvedPaymentId: payment.id, version: { increment: 1 } } })
        await this.updatePaymentStatus(tx, context, order, true, reviewRemark ?? '收款审核通过，系统重新计算付款状态')
        await this.auditEvent(tx, context, AuditEventType.SALES_RECEIPT_APPROVED, id, order.id)
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
      if (row.status !== 'PENDING_REVIEW' || row.version !== input.expectedVersion) receiptFailure('SALES_RECEIPT_STATE_CHANGED', '申请已变化，请刷新后重试', HttpStatus.CONFLICT)
      const now = new Date()
      await tx.salesReceiptRequest.update({ where: { id }, data: { status: 'REJECTED', reviewedByUserId: context.actorUserId, reviewedAt: now, reviewRemark, version: { increment: 1 } } })
      await this.auditEvent(tx, context, AuditEventType.SALES_RECEIPT_REJECTED, id, order.id)
    })
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
