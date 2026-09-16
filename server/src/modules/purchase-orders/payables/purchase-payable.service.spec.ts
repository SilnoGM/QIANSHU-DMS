import { createHash } from 'node:crypto'
import { Prisma } from '../../../generated/prisma/client'
import type { AccessControlService } from '../../access-control/access-control.service'
import type { FundPostingService } from '../../fund-accounts/application/fund-posting.contract'
import { FundPostingError } from '../../fund-accounts/application/fund-posting.errors'
import { FundCalculationError } from '../../fund-accounts/domain/fund-calculation.errors'
import { PurchasePayableService } from './purchase-payable.service'

const context = { actorUserId: 'finance-user', requestId: 'req-payable-test' }
const confirmation = { payableId: 'payable', expectedVersion: 1, idempotencyKey: 'request-key' }
const input = { paymentType: 'DEPOSIT', amount: '30.00', paymentMethod: 'BANK', remark: null, paidAt: new Date('2026-09-16T01:00:00Z'), mediaAssetId: null }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest()
function setup() {
  const payable = { id: 'payable', purchaseOrderId: 'order', paymentType: 'DEPOSIT', dueAmount: new Prisma.Decimal('30'), accountOwnerType: 'USER', ownerUserId: 'sales-issuer', closedAt: null, version: 1 }
  const tx = {
    user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    purchaseOrder: { findUniqueOrThrow: jest.fn().mockResolvedValue({ purchaseType: 'SALES_LINKED', depositDueAmount: new Prisma.Decimal('0'), balanceDueAmount: new Prisma.Decimal('100'), salesOrder: { issuerUserId: 'sales-issuer' } }) },
    purchaseOrderPayable: { createMany: jest.fn().mockResolvedValue({ count: 2 }), updateMany: jest.fn().mockResolvedValue({ count: 2 }), findFirst: jest.fn().mockResolvedValue(payable), update: jest.fn().mockResolvedValue({}) },
    purchaseOrderPayment: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  }
  const funds = { previewBusinessEventInTransaction: jest.fn().mockResolvedValue({ token: 'preview' }), postBusinessEventInTransaction: jest.fn().mockResolvedValue({ batchId: 'batch' }), reverseBusinessEventInTransaction: jest.fn().mockResolvedValue({ batchId: 'reversal' }) }
  const access = { getPermissionCodesInTransaction: jest.fn().mockResolvedValue(['purchase-orders:payment']), hasAll: jest.fn((granted: string[], required: string[]) => required.every(code => granted.includes(code))) }
  return { tx, transaction: tx as unknown as Prisma.TransactionClient, payable, funds, access, service: new PurchasePayableService(funds as unknown as FundPostingService, access as unknown as AccessControlService) }
}

describe('PurchasePayableService', () => {
  it('creates both review stages including zero, owned by the sales issuer rather than payer', async () => {
    const h = setup()
    await h.service.createForReview(h.transaction, context, 'order')
    expect(h.tx.purchaseOrderPayable.createMany).toHaveBeenCalledWith({ data: [
      { paymentType: 'DEPOSIT', dueAmount: new Prisma.Decimal(0), accountOwnerType: 'USER', ownerUserId: 'sales-issuer', purchaseOrderId: 'order', createdByUserId: 'finance-user' },
      { paymentType: 'BALANCE', dueAmount: new Prisma.Decimal(100), accountOwnerType: 'USER', ownerUserId: 'sales-issuer', purchaseOrderId: 'order', createdByUserId: 'finance-user' },
    ] })
  })
  it('assigns stock to company and rejects sales orders without an issuer', async () => {
    const h = setup()
    h.tx.purchaseOrder.findUniqueOrThrow.mockResolvedValue({ purchaseType: 'STOCK', depositDueAmount: new Prisma.Decimal(0), balanceDueAmount: new Prisma.Decimal(100), salesOrder: null })
    await h.service.createForReview(h.transaction, context, 'order')
    expect(h.tx.purchaseOrderPayable.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ accountOwnerType: 'COMPANY', ownerUserId: null })]) as unknown })
    h.tx.purchaseOrder.findUniqueOrThrow.mockResolvedValue({ purchaseType: 'SALES_LINKED', salesOrder: null })
    await expect(h.service.createForReview(h.transaction, context, 'order')).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_NOT_AVAILABLE' })
    expect(h.tx.purchaseOrderPayable.createMany).toHaveBeenCalledTimes(1)
  })
  it('closes only open stages and advances their optimistic versions on cancellation', async () => {
    const h = setup()
    await h.service.closeForCancellation(h.transaction, 'order')
    expect(h.tx.purchaseOrderPayable.updateMany).toHaveBeenCalledWith({ where: { purchaseOrderId: 'order', closedAt: null }, data: { closedAt: expect.any(Date) as unknown, version: { increment: 1 } } })
  })
  it.each(['disabled-user', 'missing-user', 'missing-permission'])('checks fresh authorization before even an idempotency lookup: %s', async scenario => {
    const h = setup()
    if (scenario === 'disabled-user') h.tx.user.findUnique.mockResolvedValue({ status: 'DISABLED' })
    if (scenario === 'missing-user') h.tx.user.findUnique.mockResolvedValue(null)
    if (scenario === 'missing-permission') h.access.getPermissionCodesInTransaction.mockResolvedValue([])
    await expect(h.service.preparePayment(h.transaction, context, 'order', input, confirmation)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(h.tx.purchaseOrderPayment.findUnique).not.toHaveBeenCalled()
  })
  it('derives the remaining amount from stored payable and active payments', async () => {
    const h = setup()
    h.tx.purchaseOrderPayment.findMany.mockResolvedValue([{ amount: new Prisma.Decimal('10') }])
    const prepared = await h.service.preparePayment(h.transaction, context, 'order', { ...input, amount: '999.00' }, confirmation)
    expect(prepared).toMatchObject({ replay: false, amount: '20.00', payable: h.payable })
    expect(h.tx.purchaseOrderPayment.findMany).toHaveBeenCalledWith({ where: { payableId: 'payable', voidedAt: null }, select: { amount: true } })
  })
  it('replays an identical request even after paidAt changes, but rejects changed content', async () => {
    const h = setup()
    const first = await h.service.preparePayment(h.transaction, context, 'order', input, confirmation)
    h.tx.purchaseOrderPayment.findUnique.mockResolvedValue({ id: first.paymentId, amount: new Prisma.Decimal(first.amount), requestFingerprintHash: first.requestFingerprintHash })
    const replay = await h.service.preparePayment(h.transaction, context, 'order', { ...input, paidAt: new Date('2026-09-17') }, confirmation)
    expect(replay).toMatchObject({ replay: true, paymentId: first.paymentId, amount: '30.00', payable: null })
    expect(replay.idempotencyKeyHash).toEqual(hash([context.actorUserId, confirmation.idempotencyKey]))
    expect(h.tx.purchaseOrderPayable.findFirst).toHaveBeenCalledTimes(1)
    await expect(h.service.preparePayment(h.transaction, context, 'order', { ...input, remark: 'changed' }, confirmation)).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT' })
  })
  it.each([
    ['missing', null, [], 'PURCHASE_PAYABLE_NOT_AVAILABLE'],
    ['wrong id', { id: 'other' }, [], 'PURCHASE_PAYABLE_NOT_AVAILABLE'],
    ['stale version', { version: 2 }, [], 'PURCHASE_PAYABLE_STATE_CHANGED'],
    ['closed', { closedAt: new Date() }, [], 'PURCHASE_PAYABLE_STATE_CHANGED'],
    ['zero', { dueAmount: new Prisma.Decimal(0) }, [], 'PURCHASE_PAYABLE_STATE_CHANGED'],
    ['paid', {}, [{ amount: new Prisma.Decimal(30) }], 'PURCHASE_PAYABLE_STATE_CHANGED'],
    ['overpaid', {}, [{ amount: new Prisma.Decimal(31) }], 'PURCHASE_PAYABLE_NOT_AVAILABLE'],
  ])('refuses invalid payment state: %s', async (_name, override, payments, code) => {
    const h = setup()
    h.tx.purchaseOrderPayable.findFirst.mockResolvedValue(override === null ? null : { ...h.payable, ...override })
    h.tx.purchaseOrderPayment.findMany.mockResolvedValue(payments)
    await expect(h.service.preparePayment(h.transaction, context, 'order', input, confirmation)).rejects.toMatchObject({ code })
    expect(h.funds.postBusinessEventInTransaction).not.toHaveBeenCalled()
  })
  it('requires the old payment entry point to settle the entire remaining stage', async () => {
    const h = setup()
    await expect(h.service.preparePayment(h.transaction, context, 'order', { ...input, amount: '29.00' })).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_NOT_AVAILABLE' })
    await expect(h.service.preparePayment(h.transaction, context, 'order', input)).resolves.toMatchObject({ amount: '30.00' })
  })
  it.each(['USER', 'COMPANY'])('posts in the caller transaction using the controlled %s consumer', async ownerType => {
    const h = setup()
    h.tx.purchaseOrderPayable.findFirst.mockResolvedValue({ ...h.payable, accountOwnerType: ownerType, ownerUserId: ownerType === 'USER' ? 'sales-issuer' : null })
    const prepared = await h.service.preparePayment(h.transaction, context, 'order', input, confirmation)
    const result = await h.service.postPayment(h.transaction, context, prepared, 'PO/TEST')
    expect(h.funds.previewBusinessEventInTransaction).toHaveBeenCalledWith(h.transaction,
      { ...context, sourceCode: 'PURCHASE_PAYMENT', consumerCode: ownerType === 'USER' ? 'PURCHASE_PAYMENT.PAY' : 'PURCHASE_PAYMENT.STOCK_PAY' },
      expect.objectContaining({ amount: '30.00', businessId: prepared.paymentId, businessNo: 'PO/TEST', postingTypeCode: 'PURCHASE_PAYMENT', ...(ownerType === 'USER' ? { userId: 'sales-issuer' } : {}) }))
    const postedInput = h.funds.postBusinessEventInTransaction.mock.calls[0] as unknown[]
    if (ownerType === 'COMPANY') expect(postedInput[2]).not.toHaveProperty('userId')
    expect(postedInput[3]).toEqual({ token: 'preview' })
    expect(result).toMatchObject({ id: prepared.paymentId, payableId: 'payable', fundPostingBatchId: 'batch' })
    expect(h.tx.purchaseOrderPayable.update).toHaveBeenCalledWith({ where: { id: 'payable' }, data: { version: { increment: 1 } } })
  })
  it.each([
    [new FundPostingError('FUND_CONCURRENT_STATE_CHANGED'), 'PURCHASE_PAYABLE_STATE_CHANGED'],
    [new FundPostingError('FUND_ACCOUNT_UNAVAILABLE'), 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE'],
    [new FundPostingError('FUND_INTERNAL_ERROR'), 'INTERNAL_ERROR'],
    [new FundCalculationError('FUND_POSTING_RULE_INVALID', 'Invalid rule'), 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE'],
  ])('maps fund errors and does not advance the payable version: %s', async (error, code) => {
    const h = setup()
    const prepared = await h.service.preparePayment(h.transaction, context, 'order', input, confirmation)
    h.funds.postBusinessEventInTransaction.mockRejectedValue(error)
    await expect(h.service.postPayment(h.transaction, context, prepared, 'PO/TEST')).rejects.toMatchObject({ code })
    expect(h.tx.purchaseOrderPayable.update).not.toHaveBeenCalled()
  })
  it('fully reverses through the purchase void consumer, while legacy unposted payments create no funds', async () => {
    const h = setup()
    const payment = { id: 'payment', payableId: 'payable', fundPostingBatchId: 'batch', amount: new Prisma.Decimal('30') }
    await expect(h.service.reversePayment(h.transaction, context, payment, 'Correction')).resolves.toBe('reversal')
    expect(h.funds.reverseBusinessEventInTransaction).toHaveBeenCalledWith(h.transaction, { ...context, sourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PURCHASE_PAYMENT.VOID' }, { originalBatchId: 'batch', amount: '30.00', reason: 'Correction', idempotencyKey: 'payment' })
    await expect(h.service.reversePayment(h.transaction, context, { ...payment, payableId: null, fundPostingBatchId: null }, 'Legacy correction')).resolves.toBeNull()
    expect(h.funds.reverseBusinessEventInTransaction).toHaveBeenCalledTimes(1)
    expect(h.tx.purchaseOrderPayable.update).toHaveBeenCalledTimes(1)
  })
})
