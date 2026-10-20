import type { PaymentRecipientService } from '../../payment-recipients/payment-recipient.service'
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
        payments: [{ amount: new Prisma.Decimal('70'), paidAt: new Date('2026-09-16T12:00:00Z'), documents: [], createdBy: { id: 'payer', displayName: '财务' } }] },
      { id: 'deposit', paymentType: 'DEPOSIT', dueAmount: new Prisma.Decimal('30'), accountOwnerType: 'USER', owner: { id: 'issuer', displayName: '销售出单人' }, version: 1, closedAt: null, payments: [] },
    ],
  }
}
function setup() {
  const order = row()
  const tx = {
    purchaseOrder: { findMany: jest.fn().mockResolvedValue([order]), count: jest.fn().mockResolvedValue(5), findUnique: jest.fn().mockResolvedValue(order), findFirst: jest.fn().mockResolvedValue(order) },
    purchaseOrderPayable: { findUnique: jest.fn().mockResolvedValue({ purchaseOrder: order }), findFirst: jest.fn().mockResolvedValue({ purchaseOrder: order }) },
  }
  const prisma = { $transaction: jest.fn((action: (tx: unknown) => Promise<unknown>) => action(tx)) }
  ;(tx.purchaseOrder as Record<string, unknown>).findFirst = tx.purchaseOrder.findUnique
  ;(tx.purchaseOrderPayable as Record<string, unknown>).findFirst = tx.purchaseOrderPayable.findUnique
  const dictionary = { resolveStoredValueInTransaction: jest.fn().mockResolvedValue({ known: true, label: '已停用历史供应商' }) }
  return { order, tx, prisma, dictionary, service: new PurchasePayableQueryService(prisma as unknown as PrismaService, dictionary as unknown as DictionaryLookupService, { getForOrder: jest.fn().mockResolvedValue(null) } as unknown as PaymentRecipientService) }
}
describe('PurchasePayableQueryService', () => {
  it('lists historical outstanding dictionary supplier values and excludes custom suppliers', async () => {
    const h = setup()
    h.tx.purchaseOrder.findMany.mockResolvedValue([{ supplierValue: 'SUPPLIER' }])
    expect(await h.service.batchSuppliers()).toEqual({ items: [{ value: 'SUPPLIER', label: '已停用历史供应商' }] })
    expect(h.tx.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      distinct: ['supplierValue'], where: expect.objectContaining({ productMode: 'CATALOG', supplierValue: { not: null }, paymentStatus: { not: 'PAID' } }) as unknown,
    }))
  })
  it('returns every outstanding order for the exact stable supplier with complete installments', async () => {
    const h = setup()
    expect((await h.service.batchOrders('SUPPLIER')).items[0].items).toHaveLength(2)
    const args = h.tx.purchaseOrder.findMany.mock.calls[0] as [{ where: unknown, skip?: unknown, take?: unknown }]
    expect(args[0].where).toMatchObject({ productMode: 'CATALOG', supplierValue: 'SUPPLIER', orderStatus: 'CONFIRMED', paymentStatus: { not: 'PAID' } })
    expect(args[0]).not.toHaveProperty('skip')
    expect(args[0]).not.toHaveProperty('take')
  })
  it('looks up the specific payable and maps its complete parent in the same repeatable-read transaction', async () => {
    const h = setup()
    const result = await h.service.getByPayableId('balance')
    expect(result).toMatchObject({ id: 'order', owner: { id: 'issuer', name: '销售出单人' }, items: [
      { id: 'deposit', dueAmount: '30.00', status: 'PENDING_PAYMENT' }, { id: 'balance', dueAmount: '70.00', status: 'PAID' },
    ] })
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' })
    expect(h.tx.purchaseOrderPayable.findUnique).toHaveBeenCalledWith({ where: { id: 'balance' }, select: { purchaseOrder: { include: expect.any(Object) as unknown } } })
    expect(h.dictionary.resolveStoredValueInTransaction).toHaveBeenCalledWith(h.tx, { dictionaryCode: 'service_provider.supplier', value: 'SUPPLIER' })
    expect(h.tx.purchaseOrder.findUnique).not.toHaveBeenCalled()
    expect(h.tx.purchaseOrder.findMany).not.toHaveBeenCalled()
    expect(h.tx.purchaseOrder.count).not.toHaveBeenCalled()
  })
  it.each(['PAID', 'CANCELLED', 'NO_PAYMENT'])('resolves old links whose order no longer belongs in the outstanding list: %s', async status => {
    const h = setup()
    const order = { ...h.order, payables: h.order.payables.map(item => ({ ...item,
      closedAt: status === 'CANCELLED' ? new Date('2026-09-17') : null,
      dueAmount: status === 'NO_PAYMENT' ? new Prisma.Decimal(0) : item.dueAmount,
      payments: status === 'PAID' ? [{ amount: item.dueAmount, paidAt: new Date('2026-09-16'), documents: [], createdBy: { id: 'payer', displayName: '财务' } }] : [],
    })) }
    h.tx.purchaseOrderPayable.findUnique.mockResolvedValue({ purchaseOrder: order })
    expect((await h.service.getByPayableId('balance')).items.map(item => item.status)).toEqual([status, status])
  })
  it('returns a payable-specific 404 and does not fall back to a parent-id or outstanding list lookup', async () => {
    const h = setup()
    h.tx.purchaseOrderPayable.findUnique.mockResolvedValue(null)
    await expect(h.service.getByPayableId('order')).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_NOT_FOUND', status: 404 })
    expect(h.tx.purchaseOrder.findUnique).not.toHaveBeenCalled()
    expect(h.tx.purchaseOrder.findMany).not.toHaveBeenCalled()
    expect(h.dictionary.resolveStoredValueInTransaction).not.toHaveBeenCalled()
  })
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
    ] }, include: expect.objectContaining({ payables: { include: expect.objectContaining({ payments: { where: { voidedAt: null }, include: { documents: { where: { detachedAt: null, documentType: 'PAYMENT_VOUCHER' }, take: 1 }, createdBy: { select: { id: true, displayName: true } } }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }] } }) as unknown } }) as unknown }))
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
