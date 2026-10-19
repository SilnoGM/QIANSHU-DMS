import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { Prisma } from '../../../generated/prisma/client'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import { SalesReceiptListQueryDto, SalesReceiptStatusDto } from '../dto/sales-receipt.dto'
import { SalesReceiptQueryService } from './sales-receipt-query.service'

function fixture() {
  const findMany = jest.fn().mockResolvedValue([])
  const count = jest.fn().mockResolvedValue(2)
  const tx = {
    salesOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'order' }) },
    salesReceiptRequest: {
      findMany, count,
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal(3) } }),
    },
  }
  const transaction = jest.fn((callback: (client: typeof tx) => unknown) => Promise.resolve(callback(tx)))
  return { service: new SalesReceiptQueryService({ $transaction: transaction } as unknown as PrismaService), tx, transaction, findMany, count }
}

describe('sales receipt finance views', () => {
  it.each([
    ['APPROVED', { status: 'APPROVED', approvedPayment: { is: { voidedAt: null } } }],
    ['VOIDED', { status: 'APPROVED', approvedPayment: { is: { voidedAt: { not: null } } } }],
    ['PENDING_REVIEW', { status: 'PENDING_REVIEW' }],
    ['REJECTED', { status: 'REJECTED' }],
  ])('%s view filters rows and page total before pagination and overrides legacy status', async (view, expected) => {
    const { service, findMany, count, transaction } = fixture()
    const query = plainToInstance(SalesReceiptListQueryDto, { view, status: 'REJECTED', page: 3, pageSize: 10, currencyCode: 'TWD' })
    const result = await service.list(query)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { currencyCode: 'TWD', ...expected }, skip: 20, take: 10 }))
    expect(count).toHaveBeenNthCalledWith(1, { where: { currencyCode: 'TWD', ...expected } })
    expect(result).toMatchObject({ page: 3, pageSize: 10, total: 2 })
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  })

  it('counts four disjoint views with the same common filters independently of selected view', async () => {
    const { service, count } = fixture()
    count.mockReset().mockResolvedValueOnce(5).mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3).mockResolvedValueOnce(4)
    const submittedFrom = '2026-09-01T00:00:00.000Z'
    const submittedTo = '2026-09-09T00:00:00.000Z'
    const query = plainToInstance(SalesReceiptListQueryDto, { view: 'VOIDED', currencyCode: 'TWD', accountOwnerUserId: 'owner', keyword: 'SC001', submittedFrom, submittedTo })
    const result = await service.list(query, 'order')
    const common = {
      salesOrderId: 'order', currencyCode: 'TWD', accountOwnerUserId: 'owner',
      submittedAt: { gte: new Date(submittedFrom), lte: new Date(submittedTo) },
      OR: [{ collectionNo: { contains: 'SC001', mode: 'insensitive' } }, { salesOrder: { OR: [{ orderNo: { contains: 'SC001', mode: 'insensitive' } }, { customerName: { contains: 'SC001', mode: 'insensitive' } }] } }],
    }
    expect(count.mock.calls.slice(1)).toEqual([
      [{ where: { ...common, status: 'PENDING_REVIEW' } }],
      [{ where: { ...common, status: 'APPROVED', approvedPayment: { is: { voidedAt: null } } } }],
      [{ where: { ...common, status: 'REJECTED' } }],
      [{ where: { ...common, status: 'APPROVED', approvedPayment: { is: { voidedAt: { not: null } } } } }],
    ])
    expect(result.statusCounts).toEqual({ PENDING_REVIEW: 1, APPROVED: 2, REJECTED: 3, VOIDED: 4 })
    expect(result.pendingAmount).toBe('3.00')
  })

  it('keeps legacy APPROVED status query inclusive of voided receipts', async () => {
    const { service, findMany } = fixture()
    await service.list({ status: SalesReceiptStatusDto.APPROVED }, 'order')
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salesOrderId: 'order', status: 'APPROVED' } }))
  })

  it('accepts VOIDED only as a view, not as a persisted review status', async () => {
    expect(await validate(plainToInstance(SalesReceiptListQueryDto, { view: 'VOIDED' }), { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0)
    expect(await validate(plainToInstance(SalesReceiptListQueryDto, { status: 'VOIDED' }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'status' })]))
    expect(await validate(plainToInstance(SalesReceiptListQueryDto, { view: 'INVALID' }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'view' })]))
  })
})
