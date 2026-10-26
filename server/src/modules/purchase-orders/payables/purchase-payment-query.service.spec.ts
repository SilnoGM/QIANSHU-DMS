import type { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import type { DataScopeService } from '../../access-control/data-scope.service'
import { Prisma } from '../../../generated/prisma/client'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import { PurchasePaymentQueryService } from './purchase-payment-query.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    payableId: 'payable-1',
    paymentType: 'DEPOSIT',
    amount: new Prisma.Decimal('30.00'),
    paidAt: new Date('2026-10-20T08:00:00.000Z'),
    paymentMethod: 'BANK_TRANSFER',
    remark: '定金',
    createdAt: new Date('2026-10-20T08:01:00.000Z'),
    voidedAt: null,
    voidReason: null,
    createdBy: {
      id: 'user-1',
      displayName: '财务甲',
      profile: { avatarUrl: null },
    },
    voidedBy: null,
    purchaseOrder: {
      id: 'order-1',
      orderNo: 'PO/20261020-00001',
      orderDate: new Date('2026-10-19T00:00:00.000Z'),
      purchaseType: 'SALES_LINKED',
      orderStatus: 'CONFIRMED',
      fulfillmentStatus: 'PREPARING',
      supplierValue: 'SUPPLIER',
      customSupplierName: null,
      salesOrder: { orderNo: 'SO/20261019-00001' },
    },
    ...overrides,
  }
}

function setup(scope: 'ALL' | 'SELF' = 'ALL') {
  const rows: unknown[] = [row()]
  const tx = {
    purchaseOrderPayment: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
    },
  }
  const prisma = {
    $transaction: jest.fn(
      (callback: (transaction: unknown) => Promise<unknown>) => callback(tx),
    ),
  }
  const dictionary = {
    resolveStoredValuesInTransaction: jest.fn().mockResolvedValue([
      { known: true, label: '供应商甲' },
    ]),
  }
  const dataScope = {
    resolveInTransaction: jest.fn().mockResolvedValue(scope),
  }
  return {
    tx,
    rows,
    prisma,
    dictionary,
    dataScope,
    service: new PurchasePaymentQueryService(
      prisma as unknown as PrismaService,
      dictionary as unknown as DictionaryLookupService,
      dataScope as unknown as DataScopeService,
    ),
  }
}

describe('PurchasePaymentQueryService', () => {
  it('maps a flat payment record with order, supplier, person and void fields', async () => {
    const h = setup()
    await expect(h.service.list({}, ACTOR_ID)).resolves.toEqual({
      items: [{
        id: 'payment-1',
        purchaseOrderId: 'order-1',
        payableId: 'payable-1',
        orderNo: 'PO/20261020-00001',
        orderDate: '2026-10-19',
        supplierName: '供应商甲',
        purchaseType: 'SALES_LINKED',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
        salesOrderNo: 'SO/20261019-00001',
        paymentType: 'DEPOSIT',
        amount: '30.00',
        paidAt: '2026-10-20T08:00:00.000Z',
        paymentMethod: 'BANK_TRANSFER',
        remark: '定金',
        createdBy: {
          id: 'user-1',
          displayName: '财务甲',
          avatarUrl: null,
        },
        createdAt: '2026-10-20T08:01:00.000Z',
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    expect(h.dataScope.resolveInTransaction).toHaveBeenCalledWith(h.tx, ACTOR_ID)
    expect(h.dictionary.resolveStoredValuesInTransaction).toHaveBeenCalledWith(
      h.tx,
      { dictionaryCode: 'service_provider.supplier', values: ['SUPPLIER'] },
    )
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    })
  })

  it('paginates flat records newest first and omits status scope for ALL', async () => {
    const h = setup()
    await h.service.list({ page: 3, pageSize: 50, status: 'ALL' }, ACTOR_ID)
    expect(h.tx.purchaseOrderPayment.findMany).toHaveBeenCalledWith({
      where: { AND: [] },
      select: expect.any(Object) as unknown,
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      skip: 100,
      take: 50,
    })
    expect(h.tx.purchaseOrderPayment.count).toHaveBeenCalledWith({
      where: { AND: [] },
    })
  })

  it.each([
    ['ACTIVE', { voidedAt: null }],
    ['VOIDED', { voidedAt: { not: null } }],
  ] as const)('applies the %s status filter', async (status, clause) => {
    const h = setup()
    await h.service.list({ status }, ACTOR_ID)
    expect(h.tx.purchaseOrderPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ...clause, AND: [] } }),
    )
  })

  it('scopes SELF by payable owner and falls back to order ownership without a payable', async () => {
    const h = setup('SELF')
    await h.service.list({}, ACTOR_ID)
    const where = (h.tx.purchaseOrderPayment.findMany.mock.calls[0] as [
      { where: unknown },
    ])[0].where
    expect(where).toMatchObject({
      AND: [{
        OR: [
          { payable: { is: { ownerUserId: ACTOR_ID } } },
          {
            payableId: null,
            purchaseOrder: {
              is: {
                salesOrder: { is: { issuerUserId: ACTOR_ID } },
              },
            },
          },
        ],
      }],
    })
  })

  it('searches order number, custom supplier, sales order and payment remark', async () => {
    const h = setup()
    await h.service.list({ keyword: '  PO/2026  ' }, ACTOR_ID)
    const where = (h.tx.purchaseOrderPayment.findMany.mock.calls[0] as [
      { where: unknown },
    ])[0].where
    expect(where).toMatchObject({
      AND: [{
        OR: [
          { purchaseOrder: { is: { orderNo: { contains: 'PO/2026', mode: 'insensitive' } } } },
          { purchaseOrder: { is: { customSupplierName: { contains: 'PO/2026', mode: 'insensitive' } } } },
          { purchaseOrder: { is: { salesOrder: { is: { orderNo: { contains: 'PO/2026', mode: 'insensitive' } } } } } },
          { remark: { contains: 'PO/2026', mode: 'insensitive' } },
        ],
      }],
    })
  })

  it('prefers a custom supplier name and preserves unknown dictionary values', async () => {
    const h = setup()
    h.rows[0] = row({
      purchaseOrder: {
        ...row().purchaseOrder,
        customSupplierName: '临时供应商',
        supplierValue: null,
      },
    })
    await expect(h.service.list({}, ACTOR_ID)).resolves.toMatchObject({
      items: [{ supplierName: '临时供应商' }],
    })
    expect(h.dictionary.resolveStoredValuesInTransaction).not.toHaveBeenCalled()

    h.rows[0] = row()
    h.dictionary.resolveStoredValuesInTransaction.mockResolvedValue([
      { known: false },
    ])
    await expect(h.service.list({}, ACTOR_ID)).resolves.toMatchObject({
      items: [{ supplierName: 'SUPPLIER' }],
    })
  })
})
