import { Readable } from 'node:stream'

import { HttpStatus, Module, StreamableFile } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import type { ProductMediaContentResponse } from '../products/media/product-media-content.service'
import { SalesOrderCommandService } from './sales-order-command.service'
import { SalesOrderDocumentService } from './documents/sales-order-document.service'
import { SalesOrderMutationService } from './sales-order-mutation.service'
import { SalesOrderProductImageService } from './products/sales-order-product-image.service'
import { SalesOrderQueryService } from './sales-order-query.service'
import { SalesOrdersController } from './sales-orders.controller'

type ContractOperation = NonNullable<OpenAPIObject['paths'][string]['get']> & {
  'x-qianshu-contract'?: unknown
}

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_MEDIA_ID = '22222222-2222-4222-8222-222222222222'

function createController(result: ProductMediaContentResponse) {
  const productOptions = jest.fn().mockResolvedValue({
    items: [], page: 1, pageSize: 20, total: 0,
  })
  const resolve = jest.fn().mockResolvedValue(result)
  const controller = new SalesOrdersController(
    { productOptions } as unknown as SalesOrderQueryService,
    {} as SalesOrderCommandService,
    {} as SalesOrderMutationService,
    {} as SalesOrderDocumentService,
    { resolve } as unknown as SalesOrderProductImageService,
  )
  const response = { status: jest.fn(), setHeader: jest.fn() }
  return { controller, productOptions, resolve, response }
}

@Module({
  controllers: [SalesOrdersController],
  providers: [{
    provide: SalesOrderQueryService,
    useValue: { list: jest.fn(), productOptions: jest.fn(), getById: jest.fn() },
  }, {
    provide: SalesOrderCommandService,
    useValue: { create: jest.fn() },
  }, {
    provide: SalesOrderMutationService,
    useValue: {},
  }, {
    provide: SalesOrderDocumentService,
    useValue: {},
  }, {
    provide: SalesOrderProductImageService,
    useValue: { resolve: jest.fn() },
  }],
})
class SalesOrderProductOptionsContractModule {}

describe('SalesOrdersController product options', () => {
  it('passes the normalized page query as one object', async () => {
    const fixture = createController({
      status: HttpStatus.OK,
      headers: {
        'Accept-Ranges': 'bytes', ETag: '"safe"', 'X-Content-Type-Options': 'nosniff',
      },
    })
    const query = {
      currencyCode: 'TWD' as const,
      keyword: '旅行',
      supplierValue: 'SUPPLIER_TW_01',
      page: 2,
      pageSize: 20,
    }

    await fixture.controller.productOptions(query)

    expect(fixture.productOptions).toHaveBeenCalledWith(query)
  })

  it('protects and delegates GET/HEAD main image content without duplicating delivery', async () => {
    const stream = Readable.from(Buffer.from('image'))
    const fixture = createController({
      status: HttpStatus.OK,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'image/webp',
        ETag: '"safe"',
        'X-Content-Type-Options': 'nosniff',
      },
      stream,
    })
    const params = { productId: PRODUCT_ID, productMediaId: PRODUCT_MEDIA_ID }
    const query = { currencyCode: 'MYR' as const }

    await fixture.controller.headProductOptionMainImage(
      params, query, '"known"', 'bytes=0-0', fixture.response,
    )
    const body = await fixture.controller.getProductOptionMainImage(
      params, query, undefined, undefined, fixture.response,
    )

    expect(fixture.resolve).toHaveBeenNthCalledWith(
      1, PRODUCT_ID, PRODUCT_MEDIA_ID, 'MYR', '"known"', 'bytes=0-0', 'HEAD',
    )
    expect(fixture.resolve).toHaveBeenNthCalledWith(
      2, PRODUCT_ID, PRODUCT_MEDIA_ID, 'MYR', undefined, undefined, 'GET',
    )
    expect(body).toBeInstanceOf(StreamableFile)
    expect((body as StreamableFile).getStream()).toBe(stream)

    const reflector = new Reflector()
    for (const method of [
      'headProductOptionMainImage', 'getProductOptionMainImage',
    ] as const) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        SalesOrdersController.prototype[method],
      )).toEqual(['sales-orders:create'])
    }
  })
})

describe('SalesOrdersController product options OpenAPI', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(SalesOrderProductOptionsContractModule)
  })

  it('publishes paged selector query and independent protected main image operations', () => {
    const options = document.paths['/api/sales-orders/product-options']?.get
    expect(options?.operationId).toBe('sales_orders_product_options')
    expect(options?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: 'query', name: 'supplierValue' }),
      expect.objectContaining({ in: 'query', name: 'page' }),
      expect.objectContaining({ in: 'query', name: 'pageSize' }),
    ]))

    const imagePath = document.paths[
      '/api/sales-orders/product-options/{productId}/main-image/{productMediaId}/content'
    ]
    const get: ContractOperation | undefined = imagePath?.get
    const head: ContractOperation | undefined = imagePath?.head
    expect(get?.operationId).toBe('sales_orders_get_product_option_main_image')
    expect(head?.operationId).toBe('sales_orders_head_product_option_main_image')
    for (const operation of [get, head]) {
      expect(operation?.security).toEqual([{ sessionCookie: [] }])
      const contract = operation?.['x-qianshu-contract']
      expect(contract).toMatchObject({
        authorization: true,
        resourceLocator: true,
        privateNoStore: true,
      })
      if (typeof contract !== 'object' || contract === null || !('errors' in contract)) {
        throw new Error('OpenAPI contract must expose an errors array')
      }
      const errors: unknown = contract.errors
      if (!Array.isArray(errors)) {
        throw new Error('OpenAPI contract errors must be an array')
      }
      expect(errors).toContainEqual({
        status: 404,
        codes: ['SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND'],
      })
    }
  })
})
