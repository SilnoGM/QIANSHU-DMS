import { Prisma } from '../../../generated/prisma/client'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import { PurchasePayableQueryService } from './purchase-payable-query.service'

function row() {
  return {
    id: 'order', orderNo: 'PO/20260916-00001', orderDate: new Date('2026-09-16'), purchaseType: 'SALES_LINKED',
    supplierValue: 'SUPPLIER', customSupplierName: null, salesOrder: { orderNo: 'SO/1' }, purchaseTotalAmount: new Prisma.Decimal('100'),
    payables: [
      { id: 'balance', paymentType: 'BALANCE', dueAmount: new Prisma.Decimal('70'), accountOwnerType: 'USER', owner: { id: 'issuer', displayName: '销售出单人' }, version: 2, closedAt: null,
        payments: [{ amount: new Prisma.Decimal('70'), paidAt: new Date('2026-09-16T12:00:00Z'), createdBy: { id: 'payer', displayName: '财务' } }] },
      { id: 'deposit', paymentType: 'DEPOSIT', dueAmount: new Prisma.Decimal('30'), accountOwnerType: 'USER', owner: { id: 'issuer', displayName: '销售出单人' }, version: 1, closedAt: null, payments: [] },
    ],
  }
}
function setup() {
  const order = row()
  const tx = { purchaseOrder: { findMany: jest.fn().mockResolvedValue([order]), count: jest.fn().mockResolvedValue(5), findUnique: jest.fn().mockResolvedValue(order) } }
  const prisma = { $transaction: jest.fn((action: (tx: unknown) => Promise<unknown>) => action(tx)) }
  const dictionary = { resolveStoredValueInTransaction: jest.fn().mockResolvedValue({ known: true, label: '已停用历史供应商' }) }
  return { order, tx, prisma, dictionary, service: new PurchasePayableQueryService(prisma as unknown as PrismaService, dictionary as unknown as DictionaryLookupService) }
}
describe('PurchasePayableQueryService', () => {
  it('paginates order groups in one repeatable-read snapshot and includes both installment rows', async () => {
    const h = setup()
    const result = await h.service.list({ page: 2, pageSize: 2, keyword: '  PO/2026  ' })
    expect(result).toMatchObject({ total: 5, page: 2, pageSize: 2, items: [{ id: 'order', purchaseTotalAmount: '100.00', supplierName: '已停用历史供应商', owner: { id: 'issuer', name: '销售出单人' }, items: [
      { id: 'deposit', dueAmount: '30.00', remainingAmount: '30.00', paidAmount: '0.00', status: 'PENDING_PAYMENT', paidAt: null, paidBy: null },
      { id: 'balance', dueAmount: '70.00', remainingAmount: '0.00', paidAmount: '70.00', status: 'PAID', paidAt: '2026-09-16T12:00:00.000Z', paidBy: { id: 'payer', name: '财务' } },
    ] }] })
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' })
    expect(h.tx.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 2, take: 2, where: {
      orderStatus: 'CONFIRMED', paymentStatus: { not: 'PAID' }, payables: { some: { closedAt: null, dueAmount: { gt: 0 } } }, OR: [
      { orderNo: { contains: 'PO/2026', mode: 'insensitive' } }, { customSupplierName: { contains: 'PO/2026', mode: 'insensitive' } }, { salesOrder: { orderNo: { contains: 'PO/2026', mode: 'insensitive' } } },
    ] }, include: expect.objectContaining({ payables: { include: expect.objectContaining({ payments: { where: { voidedAt: null }, include: { createdBy: { select: { id: true, displayName: true } } }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }] } }) as unknown } }) as unknown }))
    expect(h.tx.purchaseOrder.count).toHaveBeenCalledWith({ where: (h.tx.purchaseOrder.findMany.mock.calls[0] as [{ where: unknown }])[0].where })
    expect(h.order.payables[0].id).toBe('balance')
  })
  it('represents zero installments and cancelled orders without marking them payable', async () => {
    const h = setup()
    h.order.payables[1].dueAmount = new Prisma.Decimal(0)
    const result = await h.service.getOrder('order')
    expect(result.items[0]).toMatchObject({ status: 'NO_PAYMENT', dueAmount: '0.00', remainingAmount: '0.00' })
    h.tx.purchaseOrder.findUnique.mockResolvedValue({ ...h.order, purchaseType: 'STOCK', supplierValue: null, customSupplierName: '临时供应商', salesOrder: null, payables: h.order.payables.map(item => ({ ...item, closedAt: new Date(), owner: null, accountOwnerType: 'COMPANY' })) })
    const cancelled = await h.service.getOrder('order')
    expect(cancelled).toMatchObject({ supplierName: '临时供应商', salesOrderNo: null, owner: null, accountOwnerType: 'COMPANY' })
    expect(cancelled.items.map(item => item.status)).toEqual(['CANCELLED', 'CANCELLED'])
  })
  it('preserves an unknown stored supplier value', async () => {
    const h = setup()
    h.dictionary.resolveStoredValueInTransaction.mockResolvedValue({ known: false })
    expect((await h.service.getOrder('order')).supplierName).toBe('SUPPLIER')
  })
  it.each([null, { ...row(), payables: [] }])('returns not found for absent or non-participating historical orders', async order => {
    const h = setup()
    h.tx.purchaseOrder.findUnique.mockResolvedValue(order)
    await expect(h.service.getOrder('absent')).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_NOT_FOUND' })
  })
  it('fails closed if only one installment exists instead of silently presenting an incomplete order', async () => {
    const h = setup()
    h.order.payables.pop()
    await expect(h.service.getOrder('order')).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_NOT_AVAILABLE' })
  })
})
