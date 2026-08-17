import { Prisma } from '../../../generated/prisma/client'
import { ProductMediaKind } from '../../../generated/prisma/enums'
import {
  ProductMediaPersistence,
  type ProductMediaSnapshotItem,
} from './product-media.persistence'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const IMAGE_ID = '33333333-3333-4333-8333-333333333333'
const VIDEO_ID = '44444444-4444-4444-8444-444444444444'

function snapshotItem(
  overrides: Partial<ProductMediaSnapshotItem> = {},
): ProductMediaSnapshotItem {
  return {
    id: IMAGE_ID,
    mediaAssetId: '55555555-5555-4555-8555-555555555555',
    kind: ProductMediaKind.IMAGE,
    sortOrder: 0,
    isPrimary: false,
    ...overrides,
  }
}

describe('ProductMediaPersistence', () => {
  it('uses one parameterized non-locking query for the upload preflight', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ mediaCount: 1, version: 3 }])
    const persistence = new ProductMediaPersistence({
      $queryRaw: queryRaw,
    } as never)

    await expect(persistence.readUploadPreflight(
      PRODUCT_ID,
      ProductMediaKind.IMAGE,
    )).resolves.toEqual({ mediaCount: 1, version: 3 })

    const calls = queryRaw.mock.calls as unknown as Array<readonly [unknown]>
    const sql = calls[0]?.[0] as { strings: readonly string[] }
    expect(sql.strings.join('?')).toContain('CAST(? AS uuid)')
    expect(sql.strings.join('?')).toContain('CAST(? AS "product_media_kind")')
    expect(sql.strings.join('?')).not.toContain('FOR UPDATE')
  })

  it('locks the Product row and returns the audit fields needed by every mutation', async () => {
    const queryRaw = jest.fn().mockResolvedValue([])
    const persistence = new ProductMediaPersistence({} as never)
    const transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient

    await persistence.lockProduct(transaction, PRODUCT_ID)

    const calls = queryRaw.mock.calls as unknown as Array<readonly [unknown]>
    const sql = calls[0]?.[0] as { strings: readonly string[] }
    expect(sql.strings.join('?')).toContain('FOR UPDATE')
    expect(sql.strings.join('?')).toContain('"product_no" AS "productNo"')
    expect(sql.strings.join('?')).toContain('"version"')
  })

  it('reads only active associations in deterministic domain order', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const persistence = new ProductMediaPersistence({} as never)
    const transaction = {
      productMedia: { findMany },
    } as unknown as Prisma.TransactionClient

    await persistence.readActiveSnapshot(transaction, PRODUCT_ID)

    expect(findMany).toHaveBeenCalledWith({
      where: { productId: PRODUCT_ID, detachedAt: null },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        mediaAssetId: true,
        kind: true,
        sortOrder: true,
        isPrimary: true,
      },
    })
  })

  it('creates a non-primary association at the supplied continuous order', async () => {
    const create = jest.fn().mockResolvedValue({ id: IMAGE_ID })
    const persistence = new ProductMediaPersistence({} as never)
    const transaction = {
      productMedia: { create },
    } as unknown as Prisma.TransactionClient

    await expect(persistence.createAssociation(transaction, {
      actorUserId: ACTOR_ID,
      kind: ProductMediaKind.IMAGE,
      mediaAssetId: '55555555-5555-4555-8555-555555555555',
      productId: PRODUCT_ID,
      sortOrder: 2,
    })).resolves.toBe(IMAGE_ID)

    expect(create).toHaveBeenCalledWith({
      data: {
        createdByUserId: ACTOR_ID,
        isPrimary: false,
        kind: ProductMediaKind.IMAGE,
        mediaAssetId: '55555555-5555-4555-8555-555555555555',
        productId: PRODUCT_ID,
        sortOrder: 2,
      },
      select: { id: true },
    })
  })

  it('moves active rows to a safe offset before assigning the complete layout', async () => {
    const updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
    const persistence = new ProductMediaPersistence({} as never)
    const transaction = {
      productMedia: { updateMany },
    } as unknown as Prisma.TransactionClient
    const items = [
      snapshotItem({ id: IMAGE_ID, sortOrder: 1, isPrimary: true }),
      snapshotItem({ id: VIDEO_ID, kind: ProductMediaKind.VIDEO }),
    ]

    await persistence.writeCompleteLayout(transaction, {
      imageIds: [IMAGE_ID],
      items,
      primaryImageId: IMAGE_ID,
      productId: PRODUCT_ID,
      videoIds: [VIDEO_ID],
    })

    expect(updateMany.mock.calls).toEqual([
      [{
        where: { productId: PRODUCT_ID, detachedAt: null },
        data: { isPrimary: false, sortOrder: { increment: 3 } },
      }],
      [{
        where: {
          id: IMAGE_ID,
          productId: PRODUCT_ID,
          detachedAt: null,
          kind: ProductMediaKind.IMAGE,
        },
        data: { isPrimary: true, sortOrder: 0 },
      }],
      [{
        where: {
          id: VIDEO_ID,
          productId: PRODUCT_ID,
          detachedAt: null,
          kind: ProductMediaKind.VIDEO,
        },
        data: { isPrimary: false, sortOrder: 0 },
      }],
    ])
  })

  it('soft-detaches with the actor/time pair and bumps Product audit fields separately', async () => {
    const detachedAt = new Date('2026-08-14T10:00:00.000Z')
    const productMediaUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
    const productUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
    const persistence = new ProductMediaPersistence({} as never)
    const transaction = {
      product: { updateMany: productUpdateMany },
      productMedia: { updateMany: productMediaUpdateMany },
    } as unknown as Prisma.TransactionClient

    await expect(persistence.detachAssociation(transaction, {
      actorUserId: ACTOR_ID,
      detachedAt,
      productId: PRODUCT_ID,
      productMediaId: IMAGE_ID,
    })).resolves.toBe(true)
    await expect(persistence.bumpProductVersion(transaction, {
      actorUserId: ACTOR_ID,
      expectedVersion: 7,
      productId: PRODUCT_ID,
    })).resolves.toBe(true)

    expect(productMediaUpdateMany).toHaveBeenCalledWith({
      where: { id: IMAGE_ID, productId: PRODUCT_ID, detachedAt: null },
      data: { detachedAt, detachedByUserId: ACTOR_ID },
    })
    expect(productUpdateMany).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, version: 7 },
      data: { updatedByUserId: ACTOR_ID, version: { increment: 1 } },
    })
  })
})
