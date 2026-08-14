import { HttpStatus, Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { ProductCommandService } from './product-command.service'
import {
  ProductMediaContentService,
} from './media/product-media-content.service'
import { ProductMediaHttpService } from './media/product-media-http.service'
import { ProductQueryService } from './product-query.service'
import { ProductUpdateService } from './product-update.service'
import { ProductsController } from './products.controller'

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_MEDIA_ID = '22222222-2222-4222-8222-222222222222'

const READY_RESPONSE = {
  status: HttpStatus.OK,
  headers: {
    'Accept-Ranges': 'bytes',
    'Content-Disposition': 'inline; filename="front.webp"',
    'Content-Type': 'image/webp',
    ETag: '"sha256-opaque"',
    'X-Accel-Redirect':
      `/_qianshu_internal_media/assets/2026/08/${PRODUCT_MEDIA_ID}.webp`,
    'X-Content-Type-Options': 'nosniff',
  },
} as const

function createController() {
  const resolve = jest.fn().mockResolvedValue(READY_RESPONSE)
  const controller = new ProductsController(
    { list: jest.fn(), getById: jest.fn() } as unknown as ProductQueryService,
    { create: jest.fn() } as unknown as ProductCommandService,
    { update: jest.fn() } as unknown as ProductUpdateService,
    {
      upload: jest.fn(),
      updateLayout: jest.fn(),
      detach: jest.fn(),
    } as unknown as ProductMediaHttpService,
    { resolve } as unknown as ProductMediaContentService,
  )
  const response = {
    setHeader: jest.fn(),
    status: jest.fn(),
  }
  return { controller, resolve, response }
}

@Module({
  controllers: [ProductsController],
  providers: [{
    provide: ProductQueryService,
    useValue: { list: jest.fn(), getById: jest.fn() },
  }, {
    provide: ProductCommandService,
    useValue: { create: jest.fn() },
  }, {
    provide: ProductUpdateService,
    useValue: { update: jest.fn() },
  }, {
    provide: ProductMediaHttpService,
    useValue: { upload: jest.fn(), updateLayout: jest.fn(), detach: jest.fn() },
  }, {
    provide: ProductMediaContentService,
    useValue: { resolve: jest.fn() },
  }],
})
class ProductsMediaContentControllerContractModule {}

describe('ProductsController private media content', () => {
  it('applies the same safe descriptor to GET and HEAD without a Nest body', async () => {
    const fixture = createController()
    const params = { productId: PRODUCT_ID, productMediaId: PRODUCT_MEDIA_ID }

    await expect(fixture.controller.getMediaContent(
      params,
      undefined,
      fixture.response,
    )).resolves.toBeUndefined()
    await expect(fixture.controller.headMediaContent(
      params,
      '"known"',
      fixture.response,
    )).resolves.toBeUndefined()

    expect(fixture.resolve).toHaveBeenNthCalledWith(
      1,
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
    )
    expect(fixture.resolve).toHaveBeenNthCalledWith(
      2,
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      '"known"',
    )
    expect(fixture.response.status).toHaveBeenCalledWith(HttpStatus.OK)
    for (const [name, value] of Object.entries(READY_RESPONSE.headers)) {
      expect(fixture.response.setHeader).toHaveBeenCalledWith(name, value)
    }

    const reflector = new Reflector()
    for (const method of ['getMediaContent', 'headMediaContent'] as const) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        ProductsController.prototype[method],
      )).toEqual(['product-media:read'])
    }

    const registeredMethods = Object.getOwnPropertyNames(
      ProductsController.prototype,
    )
    expect(registeredMethods.indexOf('headMediaContent')).toBeLessThan(
      registeredMethods.indexOf('getMediaContent'),
    )
  })
})

describe('ProductsController private media content OpenAPI', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(
      ProductsMediaContentControllerContractModule,
    )
  })

  it('publishes independent GET/HEAD binary authorization and cache contracts', () => {
    const path = document.paths[
      '/api/products/{productId}/media/{productMediaId}/content'
    ]
    const get: ContractOperation | undefined = path?.get
    const head: ContractOperation | undefined = path?.head

    expect(get?.operationId).toBe('products_get_media_content')
    expect(head?.operationId).toBe('products_head_media_content')
    expect(Object.keys(get?.responses ?? {}).sort()).toEqual([
      '200', '304', '400', '401', '403', '404', '422', '500',
    ])
    expect(Object.keys(head?.responses ?? {}).sort()).toEqual([
      '200', '304', '400', '401', '403', '404', '422', '500',
    ])

    for (const operation of [get, head]) {
      expect(operation?.security).toEqual([{ sessionCookie: [] }])
      expect(operation?.parameters).toEqual(expect.arrayContaining([{
        in: 'header',
        name: 'If-None-Match',
        required: false,
        schema: { type: 'string' },
      }, {
        in: 'header',
        name: 'Range',
        required: false,
        schema: { type: 'string', pattern: '^bytes=' },
      }]))
      expect(operation?.parameters).not.toContainEqual(
        expect.objectContaining({ name: 'X-Qianshu-CSRF' }),
      )
      expect(operation?.['x-qianshu-contract']).toEqual({
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator: true,
        conflict: false,
        validation: true,
        session: 'required',
        privateNoStore: true,
        errors: [{
          status: 403,
          codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
        }, {
          status: 404,
          codes: ['PRODUCT_MEDIA_NOT_FOUND'],
        }, {
          status: 422,
          codes: ['VALIDATION_FAILED'],
        }],
      })
      expect(operation?.responses['304']).not.toHaveProperty('content')
    }

    const getOk = get?.responses['200']
    const headOk = head?.responses['200']
    if (!getOk || '$ref' in getOk || !headOk || '$ref' in headOk) {
      throw new Error('Missing product media content response contract')
    }
    expect(Object.keys(getOk.content ?? {}).sort()).toEqual([
      'image/jpeg', 'image/png', 'image/webp', 'video/mp4',
    ])
    expect(headOk).not.toHaveProperty('content')
    for (const response of [getOk, headOk]) {
      expect(Object.keys(response.headers ?? {}).sort()).toEqual([
        'Accept-Ranges',
        'Cache-Control',
        'Content-Disposition',
        'Content-Type',
        'ETag',
        'X-Accel-Redirect',
        'X-Content-Type-Options',
        'X-Request-Id',
      ].sort())
    }
  })
})
