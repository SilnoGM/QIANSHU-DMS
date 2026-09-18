import { PaymentRecipientService } from '../../payment-recipients/payment-recipient.service'
import type { PaymentRecipientAccountDto } from '../../payment-recipients/payment-recipient.dto'
import { createHash, randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { Prisma, PurchaseOrderPayment, PurchaseOrderPayable } from '../../../generated/prisma/client'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AccessControlService } from '../../access-control/access-control.service'
import { FundPostingService } from '../../fund-accounts/application/fund-posting.contract'
import { FundPostingError } from '../../fund-accounts/application/fund-posting.errors'
import { FundCalculationError } from '../../fund-accounts/domain/fund-calculation.errors'
import { PURCHASE_PAYMENT_FUND_SOURCE, PURCHASE_PAYMENT_POSTING_TYPE, PURCHASE_PAYMENT_PAY_CONSUMER, PURCHASE_PAYMENT_STOCK_PAY_CONSUMER, PURCHASE_PAYMENT_VOID_CONSUMER } from '../../fund-accounts/application/fund-purchase-payment'
import type { PurchaseOrderMutationContext } from '../purchase-order-mutation.service'
import { payableFailure, payableStateChanged, resolvePayableOwner, summarizePayable } from './purchase-payable.logic'

export interface PayableConfirmation { readonly payableId: string, readonly expectedVersion: number, readonly idempotencyKey: string }
export interface PurchasePayablePaymentInput {
  paymentType: 'DEPOSIT' | 'BALANCE' | 'OTHER', amount: string, paymentMethod: string, remark: string | null, paidAt: Date,
  mediaAssetId: string | null, recipientAccountId: string, recipientProfileVersion: number
}
export interface PayableRequestIdentity { readonly idempotencyKeyHash: Buffer<ArrayBuffer>, readonly requestFingerprintHash: Buffer<ArrayBuffer> }
export interface PreparedPayablePayment {
  readonly recipientSnapshot: PaymentRecipientAccountDto | null
  readonly recipientQrMediaAssetId: string | null
  readonly replay: boolean
  readonly payable: PurchaseOrderPayable | null
  readonly amount: string
  readonly paymentId: string
  readonly idempotencyKeyHash: Buffer<ArrayBuffer>
  readonly requestFingerprintHash: Buffer<ArrayBuffer>
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest()

@Injectable()
export class PurchasePayableService {
  constructor(private readonly funds: FundPostingService, private readonly access: AccessControlService, private readonly recipients: PaymentRecipientService) {}

  async createForReview(tx: Prisma.TransactionClient, context: PurchaseOrderMutationContext, orderId: string): Promise<void> {
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { salesOrder: { select: { issuerUserId: true } } } })
    const owner = resolvePayableOwner(order.purchaseType, order.salesOrder?.issuerUserId ?? null)
    // 审核持有采购父单锁，唯一约束进一步保证定金和尾款各生成一次；零金额也保留该阶段。
    await tx.purchaseOrderPayable.createMany({ data: [
      { paymentType: 'DEPOSIT' as const, dueAmount: order.depositDueAmount },
      { paymentType: 'BALANCE' as const, dueAmount: order.balanceDueAmount },
    ].map(stage => ({ ...stage, ...owner, purchaseOrderId: orderId, createdByUserId: context.actorUserId })) })
  }
  async closeForCancellation(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.purchaseOrderPayable.updateMany({ where: { purchaseOrderId: orderId, closedAt: null }, data: { closedAt: new Date(), version: { increment: 1 } } })
  }
  async authorize(tx: Prisma.TransactionClient, context: PurchaseOrderMutationContext) {
    const [user, granted] = await Promise.all([
      tx.user.findUnique({ where: { id: context.actorUserId }, select: { status: true } }),
      this.access.getPermissionCodesInTransaction(tx, context.actorUserId),
    ])
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(granted, ['purchase-orders:payment'])) return payableFailure('FORBIDDEN', '权限不足', 403)
  }
  async preparePayment(tx: Prisma.TransactionClient, context: PurchaseOrderMutationContext, orderId: string,
    input: { paymentType: string, amount: string, paymentMethod: string, remark: string | null, paidAt: Date, mediaAssetId: string | null, recipientAccountId: string, recipientProfileVersion: number }, confirmation?: PayableConfirmation, batchIdentity?: PayableRequestIdentity): Promise<PreparedPayablePayment> {
    await this.authorize(tx, context)
    const idempotencyKeyHash = batchIdentity?.idempotencyKeyHash ?? hash([context.actorUserId, confirmation?.idempotencyKey ?? randomUUID()])
    // 财务页面的付款时间由服务端产生，不进入用户请求指纹；重试不会因时钟推进而改变身份。
    const requestFingerprintHash = batchIdentity?.requestFingerprintHash ?? hash(confirmation
      ? { payableId: confirmation.payableId, expectedVersion: confirmation.expectedVersion, paymentMethod: input.paymentMethod, remark: input.remark, mediaAssetId: input.mediaAssetId, recipientAccountId: input.recipientAccountId, recipientProfileVersion: input.recipientProfileVersion }
      : { orderId, ...input })
    const previous = await tx.purchaseOrderPayment.findUnique({ where: { idempotencyKeyHash } })
    if (previous) {
      if (!previous.requestFingerprintHash || !Buffer.from(previous.requestFingerprintHash).equals(requestFingerprintHash)) {
        return payableFailure('PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同的付款内容', 409)
      }
      return { recipientSnapshot: null, recipientQrMediaAssetId: null, replay: true, payable: null, amount: previous.amount.toFixed(2), paymentId: previous.id, idempotencyKeyHash, requestFingerprintHash }
    }
    if (!input.mediaAssetId) return payableFailure('PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', '请先上传付款截图')
    const payable = await tx.purchaseOrderPayable.findFirst({ where: { purchaseOrderId: orderId, paymentType: input.paymentType as 'DEPOSIT' | 'BALANCE' } })
    if (!payable || (confirmation && payable.id !== confirmation.payableId)) return payableFailure('PURCHASE_PAYABLE_NOT_AVAILABLE', '该采购单没有可支付的应付款，请在采购付款页面核对')
    // 所有审核、付款、作废及取消先锁父采购单；无需倒序锁销售单或用户账户。
    if (payable.closedAt || (confirmation && payable.version !== confirmation.expectedVersion)) return payableStateChanged()
    const payments = await tx.purchaseOrderPayment.findMany({ where: { payableId: payable.id, voidedAt: null }, select: { amount: true } })
    const summary = summarizePayable(payable.dueAmount.toFixed(2), payments.map(payment => payment.amount.toFixed(2)), false)
    if (summary.status !== 'PENDING_PAYMENT') return payableStateChanged()
    if (!confirmation && input.amount !== summary.remainingAmount) return payableFailure('PURCHASE_PAYABLE_NOT_AVAILABLE', '请按该阶段剩余应付金额一次完成付款')
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, productMode: true, supplierValue: true } })
    const recipient = await this.recipients.resolveForPayment(tx, order, input)
    return { recipientSnapshot: recipient.snapshot, recipientQrMediaAssetId: recipient.qrMediaAssetId, replay: false, payable, amount: summary.remainingAmount, paymentId: randomUUID(), idempotencyKeyHash, requestFingerprintHash }
  }
  async lockPaymentAccounts(tx: Prisma.TransactionClient, context: PurchaseOrderMutationContext, entries: readonly { prepared: PreparedPayablePayment, orderNo: string }[]) {
    try {
      await this.funds.lockBusinessEventAccountsInTransaction(tx, entries.map(entry => this.paymentFundRequest(context, entry.prepared, entry.orderNo)))
    } catch (error) { return this.mapFundError(error) }
  }
  private paymentFundRequest(context: PurchaseOrderMutationContext, prepared: PreparedPayablePayment, orderNo: string) {
    const payable = prepared.payable!
    return { context: { ...context, sourceCode: PURCHASE_PAYMENT_FUND_SOURCE,
      consumerCode: payable.accountOwnerType === 'COMPANY' ? PURCHASE_PAYMENT_STOCK_PAY_CONSUMER : PURCHASE_PAYMENT_PAY_CONSUMER },
    input: { postingTypeCode: PURCHASE_PAYMENT_POSTING_TYPE, ...(payable.ownerUserId ? { userId: payable.ownerUserId } : {}), amount: prepared.amount,
      businessId: prepared.paymentId, businessNo: orderNo, summary: `采购${payable.paymentType === 'DEPOSIT' ? '定金' : '尾款'}付款`, idempotencyKey: prepared.paymentId,
      metadata: { purchaseOrderId: payable.purchaseOrderId, payableId: payable.id, paymentType: payable.paymentType } } }
  }
  async postPayment(tx: Prisma.TransactionClient, context: PurchaseOrderMutationContext, prepared: PreparedPayablePayment, orderNo: string) {
    const payable = prepared.payable!
    const { context: fundContext, input } = this.paymentFundRequest(context, prepared, orderNo)
    try {
      const preview = await this.funds.previewBusinessEventInTransaction(tx, fundContext, input)
      const posting = await this.funds.postBusinessEventInTransaction(tx, fundContext, input, preview)
      await tx.purchaseOrderPayable.update({ where: { id: payable.id }, data: { version: { increment: 1 } } })
      return { recipientSnapshot: prepared.recipientSnapshot as unknown as Prisma.InputJsonObject, recipientQrMediaAssetId: prepared.recipientQrMediaAssetId, id: prepared.paymentId, payableId: payable.id, fundPostingBatchId: posting.batchId,
        idempotencyKeyHash: prepared.idempotencyKeyHash, requestFingerprintHash: prepared.requestFingerprintHash }
    } catch (error) { return this.mapFundError(error) }
  }
  async reversePayment(tx: Prisma.TransactionClient, context: PurchaseOrderMutationContext, payment: Pick<PurchaseOrderPayment, 'id' | 'payableId' | 'fundPostingBatchId' | 'amount'>, reason: string): Promise<string | null> {
    if (!payment.fundPostingBatchId) return null // 历史记账事实从未动用资金账户，不能凭空补记冲正。
    await this.authorize(tx, context)
    try {
      const result = await this.funds.reverseBusinessEventInTransaction(tx, { ...context, sourceCode: PURCHASE_PAYMENT_FUND_SOURCE, consumerCode: PURCHASE_PAYMENT_VOID_CONSUMER },
        { originalBatchId: payment.fundPostingBatchId, amount: payment.amount.toFixed(2), reason, idempotencyKey: payment.id })
      if (payment.payableId) await tx.purchaseOrderPayable.update({ where: { id: payment.payableId }, data: { version: { increment: 1 } } })
      return result.batchId
    } catch (error) { return this.mapFundError(error) }
  }
  private mapFundError(error: unknown): never {
    if (error instanceof ApiException) throw error
    if (error instanceof FundPostingError) {
      if (error.code === 'FUND_CONCURRENT_STATE_CHANGED') return payableStateChanged()
      if (error.code === 'FUND_INTERNAL_ERROR') return payableFailure('INTERNAL_ERROR', '资金服务内部错误', 500)
      return payableFailure('PURCHASE_PAYABLE_POSTING_UNAVAILABLE', '资金账户或 PURCHASE_PAYMENT 规则当前不可用，付款操作未完成')
    }
    if (error instanceof FundCalculationError) return payableFailure('PURCHASE_PAYABLE_POSTING_UNAVAILABLE', '当前金额无法按采购付款规则记账，付款操作未完成')
    throw error
  }
}
