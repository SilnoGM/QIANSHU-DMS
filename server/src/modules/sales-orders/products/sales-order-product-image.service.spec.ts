import { HttpStatus } from '@nestjs/common'

import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type {
  ProductMediaContentService,
  ProductMediaContentResponse,
} from '../../products/media/product-media-content.service'
import { SalesOrderProductImageService } from './sales-order-product-image.service'
import type { SalesOrderAddOnQueryService } from '../sales-order-add-on-query.service'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_MEDIA_ID = '22222222-2222-4222-8222-222222222222'
const SALES_ORDER_ID = '33333333-3333-4333-8333-333333333333'
const SALES_ORDER_LINE_ID = '44444444-4444-4444-8444-444444444444'
const RESPONSE: ProductMediaContentResponse = {
  status: HttpStatus.OK,
  headers: {
    'Accept-Ranges': 'bytes',
    ETag: '"safe"',
    'X-Content-Type-Options': 'nosniff',
  },
}

function createFixture(found: object | null = { id: PRODUCT_MEDIA_ID }) {
  const productMedia = { findFirst: jest.fn().mockResolvedValue(found) }
  const salesOrderLine = {
    findFirst: jest.fn().mockResolvedValue({ productId: PRODUCT_ID }),
  }
  const resolve = jest.fn().mockResolvedValue(RESPONSE)
  const addOnQueries = {
    context: jest.fn().mockResolvedValue({ salesOrder: { id: SALES_ORDER_ID } }),
    assertEffectiveSupplier: jest.fn().mockResolvedValue('SUPPLIER_TW_01'),
  }
  return {
    addOnQueries,
    productMedia,
    salesOrderLine,
    resolve,
    service: new SalesOrderProductImageService(
      { productMedia, salesOrderLine } as unknown as PrismaService,
      { resolve } as unknown as ProductMediaContentService,
      addOnQueries as unknown as SalesOrderAddOnQueryService,
    ),
  }
}

describe('SalesOrderProductImageService', () => {
  it('revalidates active product and primary READY image without requiring a currency price', async () => {
    const fixture = createFixture()

    await expect(fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      'TWD',
      '"known"',
      'bytes=0-0',
      'HEAD',
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
    )
  })

  it('scopes a saved-order preview image to its exact catalog line', async () => {
    const fixture = createFixture()

    await expect(fixture.service.resolveListPreview(
      SALES_ORDER_ID,
      SALES_ORDER_LINE_ID,
      PRODUCT_MEDIA_ID,
      undefined,
      undefined,
      'GET',
    )).resolves.toBe(RESPONSE)

    expect(fixture.salesOrderLine.findFirst).toHaveBeenCalledWith({
      where: {
        id: SALES_ORDER_LINE_ID,
        salesOrderId: SALES_ORDER_ID,
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
    )
  })

  it('uses one non-enumerating sales-order error for every ineligible image', async () => {
    const fixture = createFixture(null)

    await expect(fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      'MYR',
      undefined,
      undefined,
      'GET',
    )).rejects.toMatchObject({
      code: 'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
      publicMessage: '产品主图不存在或当前不可用',
      status: HttpStatus.NOT_FOUND,
    })
    expect(fixture.resolve).not.toHaveBeenCalled()
  })

  it('revalidates add-on order, supplier and exact current main image relation', async () => {
    const fixture = createFixture()

    await expect(fixture.service.resolveAddOnProductOption(
      SALES_ORDER_ID,
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      'supplier_tw_01',
      '"known"',
      'bytes=0-0',
      'HEAD',
    )).resolves.toBe(RESPONSE)

    expect(fixture.addOnQueries.context).toHaveBeenCalledWith(SALES_ORDER_ID)
    expect(fixture.addOnQueries.assertEffectiveSupplier)
      .toHaveBeenCalledWith('supplier_tw_01')
    expect(fixture.productMedia.findFirst).toHaveBeenLastCalledWith({
      where: {
        id: PRODUCT_MEDIA_ID,
        productId: PRODUCT_ID,
        kind: 'IMAGE',
        isPrimary: true,
        detachedAt: null,
        mediaAsset: { is: { status: 'READY' } },
        product: { is: { status: 'ACTIVE', supplierValue: 'SUPPLIER_TW_01' } },
      },
      select: { id: true },
    })
  })

  it('does not enumerate product media when the add-on order is no longer eligible', async () => {
    const fixture = createFixture()
    fixture.addOnQueries.context.mockRejectedValue(
      new Error('add-on context is no longer eligible'),
    )

    await expect(fixture.service.resolveAddOnProductOption(
      SALES_ORDER_ID,
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      'SUPPLIER_TW_01',
      undefined,
      undefined,
      'GET',
    )).rejects.toThrow('add-on context is no longer eligible')
    expect(fixture.productMedia.findFirst).not.toHaveBeenCalled()
  })

  it('uses the existing non-enumerating image error when an add-on relation is stale', async () => {
    const fixture = createFixture(null)

    await expect(fixture.service.resolveAddOnProductOption(
      SALES_ORDER_ID,
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      'SUPPLIER_TW_01',
      undefined,
      undefined,
      'GET',
    )).rejects.toMatchObject({
      code: 'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    })
    expect(fixture.resolve).not.toHaveBeenCalled()
  })
})
