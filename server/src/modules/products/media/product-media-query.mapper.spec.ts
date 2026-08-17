import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
} from '../../../generated/prisma/enums'
import {
  ProductMediaDataIntegrityError,
  mapProductMedia,
  type ProductMediaQueryRow,
} from './product-media-query.mapper'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'

function createMediaRow(
  overrides: Partial<ProductMediaQueryRow> = {},
): ProductMediaQueryRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    productId: PRODUCT_ID,
    kind: ProductMediaKind.IMAGE,
    sortOrder: 0,
    isPrimary: true,
    createdAt: new Date('2026-08-14T01:00:00.000Z'),
    mediaAsset: {
      mediaType: MediaType.IMAGE,
      status: MediaAssetStatus.READY,
      originalFilename: 'front.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048n,
      width: 1200,
      height: 800,
      durationMs: null,
    },
    ...overrides,
  }
}

describe('mapProductMedia', () => {
  it('returns ordered structured media and keeps the primary image in images', () => {
    const secondImage = createMediaRow({
      id: '33333333-3333-4333-8333-333333333333',
      isPrimary: false,
      sortOrder: 1,
      mediaAsset: {
        mediaType: MediaType.IMAGE,
        status: MediaAssetStatus.READY,
        originalFilename: 'detail.webp',
        mimeType: 'image/webp',
        sizeBytes: 4096n,
        width: 600,
        height: 600,
        durationMs: null,
      },
    })
    const video = createMediaRow({
      id: '44444444-4444-4444-8444-444444444444',
      kind: ProductMediaKind.VIDEO,
      isPrimary: false,
      sortOrder: 0,
      createdAt: new Date('2026-08-14T02:00:00.000Z'),
      mediaAsset: {
        mediaType: MediaType.VIDEO,
        status: MediaAssetStatus.READY,
        originalFilename: 'demo.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 8192n,
        width: 1920,
        height: 1080,
        durationMs: 30_000,
      },
    })

    const result = mapProductMedia(PRODUCT_ID, [video, secondImage, createMediaRow()])

    expect(result).toEqual({
      mainImage: {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'IMAGE',
        originalFilename: 'front.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: '2048',
        width: 1200,
        height: 800,
        durationMs: null,
        sortOrder: 0,
        isPrimary: true,
        contentUrl: `/api/products/${PRODUCT_ID}/media/22222222-2222-4222-8222-222222222222/content`,
        createdAt: '2026-08-14T01:00:00.000Z',
      },
      images: [
        expect.objectContaining({
          id: '22222222-2222-4222-8222-222222222222',
          sortOrder: 0,
          isPrimary: true,
        }),
        expect.objectContaining({
          id: '33333333-3333-4333-8333-333333333333',
          sortOrder: 1,
          isPrimary: false,
        }),
      ],
      videos: [expect.objectContaining({
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'VIDEO',
        durationMs: 30_000,
        contentUrl: `/api/products/${PRODUCT_ID}/media/44444444-4444-4444-8444-444444444444/content`,
      })],
    })
    expect(result.mainImage).toBe(result.images[0])
    expect(JSON.stringify(result)).not.toMatch(
      /mediaAssetId|objectKey|checksum|storageDriver|mediaAsset|status|mediaType/u,
    )
  })

  it('returns a stable empty structure', () => {
    expect(mapProductMedia(PRODUCT_ID, [])).toEqual({
      mainImage: null,
      images: [],
      videos: [],
    })
  })

  it.each([
    [
      'multiple primary images',
      [
        createMediaRow(),
        createMediaRow({
          id: '33333333-3333-4333-8333-333333333333',
          sortOrder: 1,
        }),
      ],
    ],
    [
      'a primary video',
      [createMediaRow({
        kind: ProductMediaKind.VIDEO,
        mediaAsset: {
          mediaType: MediaType.VIDEO,
          status: MediaAssetStatus.READY,
          originalFilename: 'demo.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 8192n,
          width: 1920,
          height: 1080,
          durationMs: 1000,
        },
      })],
    ],
    [
      'a non-ready asset',
      [createMediaRow({
        mediaAsset: {
          mediaType: MediaType.IMAGE,
          status: MediaAssetStatus.UPLOADING,
          originalFilename: 'front.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2048n,
          width: 1200,
          height: 800,
          durationMs: null,
        },
      })],
    ],
    [
      'a mismatched asset type',
      [createMediaRow({
        mediaAsset: {
          mediaType: MediaType.VIDEO,
          status: MediaAssetStatus.READY,
          originalFilename: 'front.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2048n,
          width: 1200,
          height: 800,
          durationMs: null,
        },
      })],
    ],
  ])('fails closed for %s', (_case, rows) => {
    expect(() => mapProductMedia(PRODUCT_ID, rows))
      .toThrow(ProductMediaDataIntegrityError)
  })
})
