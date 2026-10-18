import { HttpStatus } from '@nestjs/common'

import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type {
  ProductMediaContentService,
  ProductMediaContentResponse,
} from '../../products/media/product-media-content.service'
import { PurchaseOrderProductImageService } from './purchase-order-product-image.service'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_MEDIA_ID = '22222222-2222-4222-8222-222222222222'
const SALES_ORDER_ID = '33333333-3333-4333-8333-333333333333'
const SALES_ORDER_LINE_ID = '44444444-4444-4444-8444-444444444444'
const PURCHASE_ORDER_ID = '55555555-5555-4555-8555-555555555555'
const PURCHASE_ORDER_LINE_ID = '66666666-6666-4666-8666-666666666666'
const RESPONSE: ProductMediaContentResponse = {
  status: HttpStatus.OK,
  headers: {
    'Accept-Ranges': 'bytes',
    ETag: '"safe"',
    'X-Content-Type-Options': 'nosniff',
  },
}

function createFixture(
  found: object | null = { id: PRODUCT_MEDIA_ID },
  purchaseOrderLineFound: object | null = { productId: PRODUCT_ID },
) {
  const productMedia = { findFirst: jest.fn().mockResolvedValue(found) }
  const purchaseOrderLine = {
    findFirst: jest.fn().mockResolvedValue(purchaseOrderLineFound),
  }
  const salesOrderLine = {
    findFirst: jest.fn().mockResolvedValue({ productId: PRODUCT_ID }),
  }
  const resolve = jest.fn().mockResolvedValue(RESPONSE)
  return {
    productMedia,
    purchaseOrderLine,
    resolve,
    salesOrderLine,
    service: new PurchaseOrderProductImageService(
      { productMedia, purchaseOrderLine, salesOrderLine } as unknown as PrismaService,
      { resolve } as unknown as ProductMediaContentService,
    ),
  }
}

describe('PurchaseOrderProductImageService', () => {
  it('revalidates a current purchasable product and its primary READY image', async () => {
    const fixture = createFixture()

    await expect(fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      '"known"',
      'bytes=0-0',
      'HEAD',
      undefined,
    )).resolves.toBe(RESPONSE)

    expect(fixture.productMedia.findFirst).toHaveBeenCalledWith({
      where: {
        id: PRODUCT_MEDIA_ID,
        productId: PRODUCT_ID,
        kind: 'IMAGE',
        isPrimary: true,
        detachedAt: null,
        mediaAsset: { is: { status: 'READY' } },
        product: {
          is: {
            status: 'ACTIVE',
            purchaseCostAmount: { not: null },
            purchaseCostCurrency: 'CNY',
          },
        },
      },
      select: { id: true },
    })
    expect(fixture.resolve).toHaveBeenCalledWith(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      '"known"',
      'bytes=0-0',
      'HEAD',
      undefined,
    )
  })

  it('uses one non-enumerating purchase-order error for every ineligible image', async () => {
    const fixture = createFixture(null)

    await expect(fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
      undefined,
      'GET',
      'thumb',
    )).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_PRODUCT_IMAGE_NOT_FOUND',
      publicMessage: '产品主图不存在或当前不可用',
      status: HttpStatus.NOT_FOUND,
    })
    expect(fixture.resolve).not.toHaveBeenCalled()
  })

  it('revalidates a CONFIRMED sales source line before serving its current main image', async () => {
    const fixture = createFixture()

    await expect(fixture.service.resolveSourceLinePreview(
      SALES_ORDER_ID,
      SALES_ORDER_LINE_ID,
      PRODUCT_MEDIA_ID,
      '"known"',
      'bytes=0-0',
      'HEAD',
      undefined,
    )).resolves.toBe(RESPONSE)

    expect(fixture.salesOrderLine.findFirst).toHaveBeenCalledWith({
      where: {
        id: SALES_ORDER_LINE_ID,
        salesOrderId: SALES_ORDER_ID,
        removedAt: null,
        lineType: 'CATALOG',
        productId: { not: null },
        salesOrder: { is: { orderStatus: 'CONFIRMED' } },
        product: {
          is: {
            media: {
              some: {
                id: PRODUCT_MEDIA_ID,
                kind: 'IMAGE',
                isPrimary: true,
                detachedAt: null,
                mediaAsset: { is: { status: 'READY' } },
              },
            },
          },
        },
      },
      select: { productId: true },
    })
    expect(fixture.resolve).toHaveBeenCalledWith(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      '"known"',
      'bytes=0-0',
      'HEAD',
      undefined,
    )
  })

  it('scopes a saved purchase-order preview to its exact catalog line without creation eligibility', async () => {
    const fixture = createFixture()

    await expect(fixture.service.resolveListPreview(
      PURCHASE_ORDER_ID,
      PURCHASE_ORDER_LINE_ID,
      PRODUCT_MEDIA_ID,
      undefined,
      undefined,
      'GET',
      'thumb',
    )).resolves.toBe(RESPONSE)

    expect(fixture.purchaseOrderLine.findFirst).toHaveBeenCalledWith({
      where: {
        id: PURCHASE_ORDER_LINE_ID,
        purchaseOrderId: PURCHASE_ORDER_ID,
        lineType: 'CATALOG',
        productId: { not: null },
        product: {
          is: {
            media: {
              some: {
                id: PRODUCT_MEDIA_ID,
                kind: 'IMAGE',
                isPrimary: true,
                detachedAt: null,
                mediaAsset: { is: { status: 'READY' } },
              },
            },
          },
        },
      },
      select: { productId: true },
    })
    expect(fixture.resolve).toHaveBeenCalledWith(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
      undefined,
      'GET',
      'thumb',
    )
  })

  it('uses the stable purchase image error when a saved list preview is ineligible', async () => {
    const fixture = createFixture({ id: PRODUCT_MEDIA_ID }, null)

    await expect(fixture.service.resolveListPreview(
      PURCHASE_ORDER_ID,
      PURCHASE_ORDER_LINE_ID,
      PRODUCT_MEDIA_ID,
      undefined,
      undefined,
      'HEAD',
      undefined,
    )).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_PRODUCT_IMAGE_NOT_FOUND',
      publicMessage: '产品主图不存在或当前不可用',
      status: HttpStatus.NOT_FOUND,
    })
    expect(fixture.resolve).not.toHaveBeenCalled()
  })
})
