import { Prisma } from '../../../generated/prisma/client'
import type { PurchaseOrderMutationContext } from '../purchase-order-mutation.service'
import { batchItemKey, batchPaymentIdentity } from './purchase-payable-batch.logic'
import type { PurchasePayableBatchPayDto, PurchasePayableBatchResultDto } from './purchase-payable.dto'
import { payableFailure, payableStateChanged, summarizePayable } from './purchase-payable.logic'
import type { PayableConfirmation, PreparedPayablePayment, PurchasePayablePaymentInput, PurchasePayableService } from './purchase-payable.service'

interface BatchOrder { id: string, orderNo: string, productMode: string, supplierValue: string | null, orderStatus: string }

/** 仅在调用方事务中执行；根幂等、整单集合、资金、凭证与状态必须共同提交或回滚。 */
export async function executeBatchPayment<TOrder extends BatchOrder>(
  tx: Prisma.TransactionClient, context: PurchaseOrderMutationContext, input: PurchasePayableBatchPayDto, key: string, payables: PurchasePayableService,
  dependencies: {
    now: Date
    validatePaymentMethod(): Promise<unknown>
    lockOrder(id: string): Promise<TOrder>
    writePayment(order: TOrder, input: PurchasePayablePaymentInput, confirmation: PayableConfirmation, prepared: PreparedPayablePayment): Promise<void>
  },
): Promise<PurchasePayableBatchResultDto> {
  await payables.authorize(tx, context)
  const identity = batchPaymentIdentity(context.actorUserId, key, input)
  // 同一用户同一批次 key 串行化；根锁不依赖订单集合，改集合也不能绕过重放校验。
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${identity.rootKeyHash.readBigInt64BE()}::bigint)::text`)
  const previous = await tx.purchaseOrderPayment.findUnique({ where: { idempotencyKeyHash: identity.rootKeyHash }, select: { requestFingerprintHash: true } })
  if (previous && (!previous.requestFingerprintHash || !Buffer.from(previous.requestFingerprintHash).equals(identity.fingerprint))) {
    return payableFailure('PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同的批量付款内容', 409)
  }
  const located = await tx.purchaseOrderPayable.findMany({ where: { id: { in: input.items.map(item => item.payableId) } }, select: { id: true, purchaseOrderId: true } })
  if (located.length !== input.items.length) return payableFailure('PURCHASE_PAYABLE_NOT_FOUND', '采购应付款不存在', 404)
  const orderIds = [...new Set(located.map(item => item.purchaseOrderId))].sort()
  const result = { orderIds, paymentCount: input.items.length }
  // 根记录证明整批已经提交；即使款项已付、凭证已归档，也应返回原批次成功。
  if (previous) return result
  const orders = new Map<string, TOrder>()
  for (const id of orderIds) {
    const order = await dependencies.lockOrder(id)
    if (order.orderStatus !== 'CONFIRMED') return payableStateChanged()
    if (order.productMode !== 'CATALOG' || order.supplierValue !== input.supplierValue) return payableFailure('PURCHASE_PAYABLE_NOT_AVAILABLE', '批量付款仅支持同一字典供应商的采购订单')
    orders.set(id, order)
  }
  const stages = await tx.purchaseOrderPayable.findMany({ where: { purchaseOrderId: { in: orderIds } }, include: { payments: { where: { voidedAt: null }, select: { amount: true } } } })
  for (const orderId of orderIds) {
    const orderStages = stages.filter(stage => stage.purchaseOrderId === orderId)
    if (orderStages.length !== 2 || !orderStages.some(stage => stage.paymentType === 'DEPOSIT') || !orderStages.some(stage => stage.paymentType === 'BALANCE')) return payableFailure('PURCHASE_PAYABLE_NOT_AVAILABLE', '采购应付款记录不完整，请核对')
  }
  const pending = stages.map(stage => ({ stage, summary: summarizePayable(stage.dueAmount.toFixed(2), stage.payments.map(payment => payment.amount.toFixed(2)), stage.closedAt !== null) }))
    .filter(item => item.summary.status === 'PENDING_PAYMENT')
  // 核对全部当前待付阶段，不能只检查客户端传来的款项是否合法，遗漏尾款也必须拒绝。
  if (pending.length !== input.items.length || pending.some(item => !input.items.some(requested => requested.payableId === item.stage.id))) return payableStateChanged()
  const preparedEntries: { order: TOrder, input: PurchasePayablePaymentInput, confirmation: PayableConfirmation, prepared: PreparedPayablePayment }[] = []
  for (const [index, item] of input.items.entries()) {
    const current = pending.find(entry => entry.stage.id === item.payableId)!
    if (current.stage.version !== item.expectedVersion) return payableStateChanged()
    const order = orders.get(current.stage.purchaseOrderId)!
    const paymentInput: PurchasePayablePaymentInput = { paymentType: current.stage.paymentType, amount: current.summary.remainingAmount,
      paymentMethod: input.paymentMethod, remark: null, paidAt: dependencies.now, mediaAssetId: item.voucher.mediaAssetId,
      recipientAccountId: input.recipientAccountId, recipientProfileVersion: input.recipientProfileVersion }
    const confirmation = { payableId: item.payableId, expectedVersion: item.expectedVersion, idempotencyKey: key }
    const prepared = await payables.preparePayment(tx, context, order.id, paymentInput, confirmation, {
      idempotencyKeyHash: index === 0 ? identity.rootKeyHash : batchItemKey(context.actorUserId, key, item.payableId), requestFingerprintHash: identity.fingerprint,
    })
    if (prepared.replay) return payableStateChanged()
    preparedEntries.push({ order, input: paymentInput, confirmation, prepared })
  }
  // 所有父单、共同收款资料和图片先锁定，之后才申请资金账户，避免跨订单倒序取锁。
  await dependencies.validatePaymentMethod()
  const voucherPayableIds = new Set(input.items.map(item => item.payableId))
  const mediaIds = [...new Set(input.items.map(item => item.voucher.mediaAssetId))].sort()
  await tx.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id IN (${Prisma.join(mediaIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`)
  // 一张截图可以归档到本批全部阶段，但必须由本人上传、仍属于本批且未被其他业务消费；
  // 在申请资金账户前一次性校验，避免写到最后一张单才发现凭证无效。
  const vouchers = await tx.mediaAsset.findMany({
    where: {
      id: { in: mediaIds },
      createdByUserId: context.actorUserId,
      mediaType: 'IMAGE',
      uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER',
      purchasePayableUploadId: { in: [...voucherPayableIds] },
      deletedAt: null,
      objectKey: { not: null },
      OR: [{ status: 'READY' }, { status: 'UPLOADING', uploadExpiresAt: { gt: dependencies.now } }],
    },
    select: { id: true },
  })
  if (vouchers.length !== mediaIds.length) return payableFailure('PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', '所选付款凭证当前不可用')
  await payables.lockPaymentAccounts(tx, context, preparedEntries.map(entry => ({ prepared: entry.prepared, orderNo: entry.order.orderNo })))
  for (const entry of preparedEntries) {
    // 同单定金写入后重读已持锁父单，使尾款状态历史从最新付款状态继续推进。
    await dependencies.writePayment(await dependencies.lockOrder(entry.order.id), entry.input, entry.confirmation, entry.prepared)
  }
  return result
}
