import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { ProductMediaContentService } from '../products/media/product-media-content.service'
import { ShipmentStorageImageService } from './shipment-storage-image.service'

const RECORD_ID = '00000000-0000-4000-8000-000000000601'
const SHIPMENT_ID = '00000000-0000-4000-8000-000000000602'
const ORDER_ID = '00000000-0000-4000-8000-000000000603'
const LINE_ID = '00000000-0000-4000-8000-000000000604'
const MEDIA_ID = '00000000-0000-4000-8000-000000000605'
const PRODUCT_ID = '00000000-0000-4000-8000-000000000606'

function fixture(options: {
  readonly allocations?: readonly unknown[]
  readonly line?: { readonly productId: string | null } | null
} = {}) {
  const resolve = jest.fn().mockResolvedValue({
    headers: { 'Accept-Ranges': 'bytes', ETag: '"etag"' },
    status: 200,
  })
  const prisma = {
    shipmentStorageRecord: {
      findUnique: jest.fn().mockResolvedValue({
        shipmentId: SHIPMENT_ID,
        originPurchaseOrderId: ORDER_ID,
        originAllocations: options.allocations ?? [{ purchaseOrderLineId: LINE_ID }],
      }),
    },
    purchaseOrderLine: {
      findFirst: jest.fn().mockResolvedValue(options.line === undefined
        ? { productId: PRODUCT_ID }
        : options.line),
    },
  }
  const service = new ShipmentStorageImageService(
    prisma as unknown as PrismaService,
    { resolve } as unknown as ProductMediaContentService,
  )
  return { prisma, resolve, service }
}

describe('ShipmentStorageImageService', () => {
  it('resolves a current primary image only for a line in the storage snapshot', async () => {
    const f = fixture()

    await f.service.resolve(RECORD_ID, LINE_ID, MEDIA_ID, undefined, undefined, 'GET', undefined)

    expect(f.prisma.purchaseOrderLine.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: LINE_ID,
        purchaseOrderId: ORDER_ID,
        lineType: 'CATALOG',
        productId: { not: null },
        partItems: { some: { purchaseOrderPartId: SHIPMENT_ID } },
      }) as unknown,
      select: { productId: true },
    })
    expect(f.resolve).toHaveBeenCalledWith(
      PRODUCT_ID,
      MEDIA_ID,
      undefined,
      undefined,
      'GET',
      undefined,
    )
  })

  it('rejects a line that is not part of the storage snapshot', async () => {
    const f = fixture({ allocations: [] })

    await expect(f.service.resolve(
      RECORD_ID,
      LINE_ID,
      MEDIA_ID,
      undefined,
      undefined,
      'GET',
      undefined,
    )).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_PRODUCT_IMAGE_NOT_FOUND' })
    expect(f.prisma.purchaseOrderLine.findFirst).not.toHaveBeenCalled()
  })

  it('rejects a detached or non-primary image', async () => {
    const f = fixture({ line: null })

    await expect(f.service.resolve(
      RECORD_ID,
      LINE_ID,
      MEDIA_ID,
      undefined,
      undefined,
      'GET',
      undefined,
    )).rejects.toMatchObject({
      code: 'SHIPMENT_STORAGE_PRODUCT_IMAGE_NOT_FOUND',
    })
    expect(f.resolve).not.toHaveBeenCalled()
  })
})
