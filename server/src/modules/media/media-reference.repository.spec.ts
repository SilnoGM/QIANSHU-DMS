import type { Prisma } from '../../generated/prisma/client'
import {
  MEDIA_ASSET_REFERENCE_TABLES,
  MediaAssetReferenceRepository,
} from './media-reference.repository'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'

describe('MediaAssetReferenceRepository', () => {
  it('explicitly checks only active ProductMedia references in the current delivery', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'reference-id' })
    const reader = {
      productMedia: { findFirst },
    } as unknown as Prisma.TransactionClient
    const repository = new MediaAssetReferenceRepository()

    await expect(repository.hasActiveReferences(reader, ASSET_ID)).resolves.toBe(true)

    expect(MEDIA_ASSET_REFERENCE_TABLES).toEqual(['product_media'])
    expect(findFirst).toHaveBeenCalledWith({
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
    } as unknown as Prisma.TransactionClient

    await expect(
      new MediaAssetReferenceRepository().hasActiveReferences(reader, ASSET_ID),
    ).resolves.toBe(false)
  })
})
