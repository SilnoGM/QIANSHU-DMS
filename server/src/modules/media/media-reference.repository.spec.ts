import type { Prisma } from '../../generated/prisma/client'
import {
  MEDIA_ASSET_REFERENCE_TABLES,
  MediaAssetReferenceRepository,
} from './media-reference.repository'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'

describe('MediaAssetReferenceRepository', () => {
  it('explicitly checks every implemented active media reference', async () => {
    const productMediaFindFirst = jest.fn().mockResolvedValue(null)
    const salesOrderDocumentFindFirst = jest.fn().mockResolvedValue(null)
    const purchaseOrderDocumentFindFirst = jest.fn().mockResolvedValue({
      id: 'reference-id',
    })
    const reader = {
      productMedia: { findFirst: productMediaFindFirst },
      salesOrderDocument: { findFirst: salesOrderDocumentFindFirst },
      purchaseOrderDocument: { findFirst: purchaseOrderDocumentFindFirst },
    } as unknown as Prisma.TransactionClient
    const repository = new MediaAssetReferenceRepository()

    await expect(repository.hasActiveReferences(reader, ASSET_ID)).resolves.toBe(true)

    expect(MEDIA_ASSET_REFERENCE_TABLES).toEqual([
      'product_media',
      'sales_order_documents',
      'purchase_order_documents',
    ])
    expect(productMediaFindFirst).toHaveBeenCalledWith({
      where: {
        detachedAt: null,
        mediaAssetId: ASSET_ID,
      },
      select: { id: true },
    })
    expect(salesOrderDocumentFindFirst).toHaveBeenCalledWith({
      where: {
        detachedAt: null,
        mediaAssetId: ASSET_ID,
      },
      select: { id: true },
    })
    expect(purchaseOrderDocumentFindFirst).toHaveBeenCalledWith({
      where: {
        detachedAt: null,
        mediaAssetId: ASSET_ID,
      },
      select: { id: true },
    })
  })

  it('returns false when no implemented domain has an active reference', async () => {
    const reader = {
      productMedia: { findFirst: jest.fn().mockResolvedValue(null) },
      salesOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as Prisma.TransactionClient

    await expect(
      new MediaAssetReferenceRepository().hasActiveReferences(reader, ASSET_ID),
    ).resolves.toBe(false)
  })
})
