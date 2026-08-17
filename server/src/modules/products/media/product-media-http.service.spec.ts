import { Readable } from 'node:stream'

import { HttpStatus } from '@nestjs/common'

import type { ProductQueryService } from '../product-query.service'
import type { ProductMediaUploadInput } from './product-media.command'
import type { ProductMediaService } from './product-media.service'
import {
  ProductMediaHttpService,
  type ProductMediaUploadResponse,
} from './product-media-http.service'
import type { ProductMediaMultipartParser } from './product-media-multipart.parser'
import type {
  ParsedProductMediaUploadInput,
  ProductMediaMultipartRequest,
} from './product-media-multipart.parser'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const MEDIA_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'
const context = { actorUserId: ACTOR_ID, requestId: 'request-product-media' }

function productFixture() {
  const media = {
    id: MEDIA_ID,
    kind: 'IMAGE' as const,
    originalFilename: 'front.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: '1024',
    width: 100,
    height: 100,
    durationMs: null,
    sortOrder: 0,
    isPrimary: false,
    contentUrl: `/api/products/${PRODUCT_ID}/media/${MEDIA_ID}/content`,
    createdAt: '2026-08-14T00:00:00.000Z',
  }
  return {
    id: PRODUCT_ID,
    name: '媒体产品',
    productNo: 'P-MEDIA-001',
    status: 'DRAFT' as const,
    version: 2,
    media: { mainImage: null, images: [media], videos: [] },
    twdSalePrice: { amount: null, currency: 'TWD' },
    myrSalePrice: { amount: null, currency: 'MYR' },
    purchaseCost: { amount: null, currency: 'CNY' },
    attributes: [],
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  } as unknown as Awaited<ReturnType<ProductQueryService['getById']>>
}

function createFixture() {
  const upload = jest.fn<
    ReturnType<ProductMediaService['upload']>,
    Parameters<ProductMediaService['upload']>
  >().mockResolvedValue({
    affectedProductMediaId: MEDIA_ID,
    changed: true,
    items: [],
    productId: PRODUCT_ID,
    version: 2,
  })
  const updateLayout = jest.fn<
    ReturnType<ProductMediaService['updateLayout']>,
    Parameters<ProductMediaService['updateLayout']>
  >().mockResolvedValue({
    affectedProductMediaId: null,
    changed: false,
    items: [],
    productId: PRODUCT_ID,
    version: 2,
  })
  const detach = jest.fn<
    ReturnType<ProductMediaService['detach']>,
    Parameters<ProductMediaService['detach']>
  >().mockResolvedValue({
    affectedProductMediaId: MEDIA_ID,
    changed: true,
    items: [],
    productId: PRODUCT_ID,
    version: 2,
  })
  const product = productFixture()
  const getById = jest.fn<
    ReturnType<ProductQueryService['getById']>,
    Parameters<ProductQueryService['getById']>
  >().mockResolvedValue(product)
  const parseImplementation = (
    _request: ProductMediaMultipartRequest,
    handler: (input: ParsedProductMediaUploadInput) => Promise<ProductMediaUploadResponse>,
  ): Promise<ProductMediaUploadResponse> => handler({
      declaredMimeType: 'image/jpeg',
      expectedVersion: 1,
      kind: 'IMAGE',
      originalFilename: 'front.jpg',
      stream: Readable.from(['image']),
    })
  const parse = jest.fn(parseImplementation)
  const service = new ProductMediaHttpService(
    { upload, updateLayout, detach } as unknown as ProductMediaService,
    { parse } as unknown as ProductMediaMultipartParser,
    { getById } as unknown as ProductQueryService,
  )
  return { detach, getById, parse, product, service, updateLayout, upload }
}

describe('ProductMediaHttpService', () => {
  it('streams upload into the domain service and returns the latest Product plus affected item', async () => {
    const fixture = createFixture()
    const request = { marker: 'request' } as never

    const result = await fixture.service.upload(context, PRODUCT_ID, request)

    expect(fixture.parse).toHaveBeenCalledWith(request, expect.any(Function))
    const uploadInput: ProductMediaUploadInput | undefined =
      fixture.upload.mock.calls[0]?.[2]
    expect(uploadInput).toMatchObject({
      declaredMimeType: 'image/jpeg',
      expectedVersion: 1,
      kind: 'IMAGE',
      originalFilename: 'front.jpg',
    })
    expect(uploadInput?.stream).toBeInstanceOf(Readable)
    expect(fixture.getById).toHaveBeenCalledWith(PRODUCT_ID)
    expect(result).toEqual({
      product: fixture.product,
      media: fixture.product.media.images[0],
    } satisfies ProductMediaUploadResponse)
  })

  it('fails closed when the committed affected item is absent from the query snapshot', async () => {
    const fixture = createFixture()
    fixture.getById.mockResolvedValue({
      ...fixture.product,
      media: { mainImage: null, images: [], videos: [] },
    })

    await expect(fixture.service.upload(context, PRODUCT_ID, {} as never))
      .rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
      })
  })

  it('returns latest Product snapshots after layout and detach', async () => {
    const fixture = createFixture()
    const layout = {
      expectedVersion: 2,
      imageIds: [MEDIA_ID],
      videoIds: [],
      primaryImageId: MEDIA_ID,
    }
    const detach = { expectedVersion: 2 }

    await expect(fixture.service.updateLayout(context, PRODUCT_ID, layout))
      .resolves.toBe(fixture.product)
    await expect(fixture.service.detach(context, PRODUCT_ID, MEDIA_ID, detach))
      .resolves.toBe(fixture.product)
    expect(fixture.updateLayout).toHaveBeenCalledWith(context, PRODUCT_ID, layout)
    expect(fixture.detach).toHaveBeenCalledWith(
      context,
      PRODUCT_ID,
      MEDIA_ID,
      detach,
    )
    expect(fixture.getById).toHaveBeenCalledTimes(2)
  })
})
