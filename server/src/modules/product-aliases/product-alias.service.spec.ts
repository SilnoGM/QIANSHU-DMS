import { AuditEventType } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ProductAliasService } from './product-alias.service'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_USER_ID = '44444444-4444-4444-8444-444444444444'

function fixture() {
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    product: {
      findUnique: jest.fn().mockResolvedValue({ id: PRODUCT_ID, productNo: 'PROD/00001', name: '破碎机' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    userProductAlias: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }: { create: { productId: string, alias: string } }) => Promise.resolve({
        productId: create.productId,
        alias: create.alias,
        updatedAt: new Date('2026-11-17T00:00:00.000Z'),
      })),
      delete: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const prisma = {
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    product: transaction.product,
    userProductAlias: transaction.userProductAlias,
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new ProductAliasService(
    prisma as unknown as PrismaService,
    audit,
  )
  return { service, transaction, audit }
}

describe('ProductAliasService', () => {
  it('creates a normalized alias and records an audit event', async () => {
    const { service, transaction, audit } = fixture()
    const result = await service.upsert(
      { actorUserId: USER_ID, requestId: 'request-1' },
      PRODUCT_ID,
      { alias: '  破碎  机  ' },
    )
    expect(result).toEqual({
      productId: PRODUCT_ID,
      alias: '破碎 机',
      updatedAt: '2026-11-17T00:00:00.000Z',
    })
    expect(transaction.userProductAlias.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId_userId: { productId: PRODUCT_ID, userId: USER_ID } },
      create: { productId: PRODUCT_ID, userId: USER_ID, alias: '破碎 机' },
      update: { alias: '破碎 机' },
    }))
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: AuditEventType.PRODUCT_ALIAS_UPDATED,
      actorUserId: USER_ID,
      targetType: 'PRODUCT_ALIAS',
      targetId: PRODUCT_ID,
      metadata: {
        productNo: 'PROD/00001',
        productName: '破碎机',
        previousAlias: null,
        alias: '破碎 机',
      },
    }))
  })

  it('does not write audit when the alias is unchanged', async () => {
    const { service, transaction, audit } = fixture()
    transaction.userProductAlias.findUnique.mockResolvedValue({
      productId: PRODUCT_ID,
      alias: '破碎机',
      updatedAt: new Date('2026-11-17T00:00:00.000Z'),
    })
    const result = await service.upsert(
      { actorUserId: USER_ID, requestId: 'request-1' },
      PRODUCT_ID,
      { alias: '破碎机' },
    )
    expect(result.alias).toBe('破碎机')
    expect(transaction.userProductAlias.upsert).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rejects ×, control characters and empty aliases', async () => {
    const { service } = fixture()
    await expect(service.upsert(
      { actorUserId: USER_ID, requestId: 'request-1' },
      PRODUCT_ID,
      { alias: 'A×2' },
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(service.upsert(
      { actorUserId: USER_ID, requestId: 'request-1' },
      PRODUCT_ID,
      { alias: '   ' },
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('returns 404 when the product does not exist', async () => {
    const { service, transaction } = fixture()
    transaction.product.findUnique.mockResolvedValue(null)
    await expect(service.upsert(
      { actorUserId: USER_ID, requestId: 'request-1' },
      PRODUCT_ID,
      { alias: '破碎机' },
    )).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' })
  })

  it('deletes only the current user alias and records a clear event', async () => {
    const { service, transaction, audit } = fixture()
    transaction.userProductAlias.findUnique.mockResolvedValue({ alias: '破碎机' })
    await service.clear({ actorUserId: USER_ID, requestId: 'request-2' }, PRODUCT_ID)
    expect(transaction.userProductAlias.delete).toHaveBeenCalledWith({
      where: { productId_userId: { productId: PRODUCT_ID, userId: USER_ID } },
    })
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: AuditEventType.PRODUCT_ALIAS_CLEARED,
      targetId: PRODUCT_ID,
      metadata: expect.objectContaining({ previousAlias: '破碎机' }) as unknown,
    }))
  })

  it('does not write audit when clearing a missing alias', async () => {
    const { service, transaction, audit } = fixture()
    await service.clear({ actorUserId: USER_ID, requestId: 'request-2' }, PRODUCT_ID)
    expect(transaction.userProductAlias.delete).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('lists aliases filtered by product IDs and rejects invalid UUIDs', async () => {
    const { service, transaction } = fixture()
    transaction.userProductAlias.findMany.mockResolvedValue([{
      productId: PRODUCT_ID,
      alias: '破碎机',
      updatedAt: new Date('2026-11-17T00:00:00.000Z'),
    }])
    await expect(service.listMine(USER_ID, { productIds: `${PRODUCT_ID},${OTHER_PRODUCT_ID}` }))
      .resolves.toEqual({ items: [{
        productId: PRODUCT_ID,
        alias: '破碎机',
        updatedAt: '2026-11-17T00:00:00.000Z',
      }] })
    await expect(service.listMine(USER_ID, { productIds: 'not-a-uuid' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('resolves aliases by issuer and product, keeping users isolated', async () => {
    const { service, transaction } = fixture()
    transaction.userProductAlias.findMany.mockResolvedValue([
      { userId: USER_ID, productId: PRODUCT_ID, alias: '破碎机' },
      { userId: OTHER_USER_ID, productId: OTHER_PRODUCT_ID, alias: '木桌' },
    ])
    const resolved = await service.resolveForIssuer(USER_ID, [PRODUCT_ID, OTHER_PRODUCT_ID])
    expect([...resolved]).toEqual([[PRODUCT_ID, '破碎机']])
    expect(transaction.userProductAlias.findMany).toHaveBeenCalledWith({
      where: { OR: [
        { userId: USER_ID, productId: PRODUCT_ID },
        { userId: USER_ID, productId: OTHER_PRODUCT_ID },
      ] },
      select: { userId: true, productId: true, alias: true },
    })
  })

  it('resolves product default aliases in one batch and drops null values', async () => {
    const { service, transaction } = fixture()
    transaction.product.findMany.mockResolvedValue([
      { id: PRODUCT_ID, defaultAlias: '默认破碎机' },
      { id: OTHER_PRODUCT_ID, defaultAlias: null },
    ])
    const resolved = await service.resolveDefaults([PRODUCT_ID, OTHER_PRODUCT_ID, PRODUCT_ID])
    expect([...resolved]).toEqual([[PRODUCT_ID, '默认破碎机']])
    expect(transaction.product.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [PRODUCT_ID, OTHER_PRODUCT_ID] },
        defaultAlias: { not: null },
      },
      select: { id: true, defaultAlias: true },
    })
    await expect(service.resolveDefaults([])).resolves.toEqual(new Map())
  })
})
