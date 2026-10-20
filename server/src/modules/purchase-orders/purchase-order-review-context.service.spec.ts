import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { PurchaseShippingMarkResolverService } from '../purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import { PurchaseOrderReviewContextService } from './purchase-order-review-context.service'
import { purchaseReviewSourceBlockReason } from './purchase-order-review-source'

function setup() {
  const order = {
    orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED',
    purchaseType: 'SALES_LINKED', salesOrder: { orderStatus: 'CONFIRMED' },
    productMode: 'CATALOG', supplierValue: 'SUPPLIER_A',
    createRequestFingerprintVersion: 'purchase-order.create.v5',
    shippingMarkText: null, shippingMarkIssuanceId: null, _count: { parts: 2 },
  }
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    purchaseOrder: {
      findUnique: jest.fn().mockResolvedValue(order),
      findFirst: jest.fn().mockResolvedValue(order),
    },
  }
  const prisma = { $transaction: jest.fn().mockImplementation((callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) }
  const resolver = { resolve: jest.fn().mockResolvedValue({ availability: 'AVAILABLE', message: '可派发' }) }
  const service = new PurchaseOrderReviewContextService(prisma as unknown as PrismaService, resolver as unknown as PurchaseShippingMarkResolverService)
  ;(transaction.purchaseOrder as Record<string, unknown>).findFirst = transaction.purchaseOrder.findUnique
  return { service, prisma, resolver, transaction, order }
}

describe('PurchaseOrderReviewContextService', () => {
  it.each(['purchase-order.create.v5', 'purchase-order.create.v6'])('checks current rule read-only for %s without issuance and uses one consistent snapshot', async version => {
    const fixture = setup()
    fixture.order.createRequestFingerprintVersion = version
    await expect(fixture.service.read('order-id')).resolves.toEqual({ available: true, message: null })
    expect(fixture.resolver.resolve).toHaveBeenCalledWith(fixture.transaction, { productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' }, false)
    expect(fixture.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' })
  })

  it.each(['purchase-order.create.v5', 'purchase-order.create.v6'])('reuses %s issued marks even when their rule is later disabled', async version => {
    const fixture = setup()
    fixture.order.createRequestFingerprintVersion = version
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({ ...fixture.order, shippingMarkText: 'MARK0001', shippingMarkIssuanceId: 'issuance-id' })
    fixture.resolver.resolve.mockResolvedValue({ availability: 'DISABLED', message: '停用' })
    await expect(fixture.service.read('order-id')).resolves.toEqual({ available: true, message: null })
    expect(fixture.resolver.resolve).not.toHaveBeenCalled()
  })

  it('returns rule remediation verbatim and keeps confirmation unavailable', async () => {
    const fixture = setup()
    fixture.resolver.resolve.mockResolvedValue({ availability: 'UNBOUND', message: '该供应商尚未绑定唛头规则，请联系管理员配置' })
    await expect(fixture.service.read('order-id')).resolves.toEqual({ available: false, message: '该供应商尚未绑定唛头规则，请联系管理员配置' })
  })

  it.each(['CANCELLED', 'PENDING_RECONCILIATION', 'COMPLETED', 'DRAFT'] as const)('explains unavailable source %s before looking up marks', async (status) => {
    const fixture = setup()
    fixture.order.salesOrder.orderStatus = status
    const result = await fixture.service.read('order-id')
    expect(result).toEqual({ available: false, message: purchaseReviewSourceBlockReason(status) })
    expect(result.message).not.toContain('请重试')
    expect(fixture.resolver.resolve).not.toHaveBeenCalled()
  })

  it.each(['CONFIRMED', 'COMPLETED', 'CANCELLED'])('does not offer confirmation after order becomes %s', async (status) => {
    const fixture = setup()
    fixture.order.orderStatus = status
    expect((await fixture.service.read('order-id')).available).toBe(false)
    expect(fixture.resolver.resolve).not.toHaveBeenCalled()
  })

  it.each(['purchase-order.create.v3', 'purchase-order.create.v4'])('preserves legacy %s marks without requiring current rules', async (version) => {
    const fixture = setup()
    fixture.order.createRequestFingerprintVersion = version
    await expect(fixture.service.read('order-id')).resolves.toEqual({ available: true, message: null })
    expect(fixture.resolver.resolve).not.toHaveBeenCalled()
  })

  it.each(['purchase-order.create.v5', 'purchase-order.create.v6'])('blocks incomplete %s part configuration and missing source, and permits stock without source', async version => {
    const fixture = setup()
    fixture.order.createRequestFingerprintVersion = version
    fixture.order._count.parts = 0
    expect((await fixture.service.read('order-id')).available).toBe(false)
    fixture.order._count.parts = 1
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({ ...fixture.order, salesOrder: null })
    expect((await fixture.service.read('order-id')).message).toMatch(/销售来源不存在/u)
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({ ...fixture.order, purchaseType: 'STOCK', salesOrder: null })
    await expect(fixture.service.read('order-id')).resolves.toEqual({ available: true, message: null })
  })

  it('returns not found for a missing purchase order', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue(null)
    await expect(fixture.service.read('missing')).rejects.toMatchObject({ code: 'PURCHASE_ORDER_NOT_FOUND' })
  })
})
