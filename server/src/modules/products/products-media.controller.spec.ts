import { Readable } from 'node:stream'

import { HttpStatus, Module } from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { attachRequestAuthContext } from '../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { ProductCommandService } from './product-command.service'
import { ProductQueryService } from './product-query.service'
import { ProductTaxonomyService } from './product-taxonomy.service'
import { ProductUpdateService } from './product-update.service'
import {
  ProductMediaHttpService,
} from './media/product-media-http.service'
import { ProductMediaContentService } from './media/product-media-content.service'
import { ProductsController } from './products.controller'

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['post']
> & { 'x-qianshu-contract'?: unknown }

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const MEDIA_ID = '33333333-3333-4333-8333-333333333333'

function createRequest(): object {
  const request = Object.assign(Readable.from([]), { headers: {} })
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: '44444444-4444-4444-8444-444444444444',
    userId: ACTOR_ID,
    username: 'media_operator',
    displayName: '媒体管理员',
    mustChangePassword: false,
    createdAt: new Date('2026-08-14T00:00:00.000Z'),
    lastActivityAt: new Date('2026-08-14T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-08-15T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-09-14T00:00:00.000Z'),
  })
  return request
}

function createController() {
  const upload = jest.fn<
    ReturnType<ProductMediaHttpService['upload']>,
    Parameters<ProductMediaHttpService['upload']>
  >().mockResolvedValue({ product: {} as never, media: {} as never })
  const updateLayout = jest.fn<
    ReturnType<ProductMediaHttpService['updateLayout']>,
    Parameters<ProductMediaHttpService['updateLayout']>
  >().mockResolvedValue({ id: PRODUCT_ID } as never)
  const detach = jest.fn<
    ReturnType<ProductMediaHttpService['detach']>,
    Parameters<ProductMediaHttpService['detach']>
  >().mockResolvedValue({ id: PRODUCT_ID } as never)
  const controller = new ProductsController(
    { list: jest.fn(), getById: jest.fn() } as unknown as ProductQueryService,
    { options: jest.fn() } as unknown as ProductTaxonomyService,
    { create: jest.fn() } as unknown as ProductCommandService,
    { update: jest.fn() } as unknown as ProductUpdateService,
    { upload, updateLayout, detach } as unknown as ProductMediaHttpService,
    { resolve: jest.fn() } as unknown as ProductMediaContentService,
  )
  return { controller, detach, updateLayout, upload }
}

@Module({
  controllers: [ProductsController],
  providers: [{
    provide: ProductQueryService,
    useValue: { list: jest.fn(), getById: jest.fn() },
  }, {
    provide: ProductTaxonomyService,
    useValue: { options: jest.fn() },
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
class ProductsMediaControllerContractModule {}

describe('ProductsController media mutations', () => {
  it('delegates trusted context and exact public inputs', async () => {
    const fixture = createController()
    const request = createRequest()
    const layout = {
      expectedVersion: 1,
      imageIds: [MEDIA_ID],
      videoIds: [],
      primaryImageId: MEDIA_ID,
    }
    const detach = { expectedVersion: 2 }

    await fixture.controller.uploadMedia({ productId: PRODUCT_ID }, request as never)
    await fixture.controller.updateMediaLayout(
      { productId: PRODUCT_ID },
      layout,
      request,
    )
    await fixture.controller.detachMedia(
      { productId: PRODUCT_ID, productMediaId: MEDIA_ID },
      detach,
      request,
    )

    const context = fixture.upload.mock.calls[0]?.[0]
    expect(context?.actorUserId).toBe(ACTOR_ID)
    expect(typeof context?.requestId).toBe('string')
    expect(fixture.upload).toHaveBeenCalledWith(context, PRODUCT_ID, request)
    expect(fixture.updateLayout).toHaveBeenCalledWith(
      context,
      PRODUCT_ID,
      layout,
    )
    expect(fixture.detach).toHaveBeenCalledWith(
      context,
      PRODUCT_ID,
      MEDIA_ID,
      detach,
    )

    const reflector = new Reflector()
    for (const method of ['uploadMedia', 'updateMediaLayout', 'detachMedia'] as const) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        ProductsController.prototype[method],
      )).toEqual(['products:update'])
    }
    expect(Reflect.getMetadata(
      HTTP_CODE_METADATA,
      ProductsController.prototype.uploadMedia,
    )).toBe(HttpStatus.CREATED)
  })
})

describe('ProductsController media OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(ProductsMediaControllerContractModule)
  })

  it('publishes exact upload, layout and detach mutation contracts', () => {
    const upload: ContractOperation | undefined =
      document.paths['/api/products/{productId}/media']?.post
    const layout: ContractOperation | undefined =
      document.paths['/api/products/{productId}/media/layout']?.put
    const detach: ContractOperation | undefined = document.paths[
      '/api/products/{productId}/media/{productMediaId}'
    ]?.delete

    expect(upload?.operationId).toBe('products_upload_media')
    expect(layout?.operationId).toBe('products_update_media_layout')
    expect(detach?.operationId).toBe('products_detach_media')
    expect(upload?.requestBody).toEqual({
      required: true,
      content: {
        'multipart/form-data': {
          schema: { $ref: '#/components/schemas/ProductMediaUploadRequestDto' },
        },
      },
    })
    expect(document.components?.schemas?.ProductMediaUploadRequestDto).toMatchObject({
      properties: {
        kind: { description: '必须在 file part 之前发送' },
        expectedVersion: { description: '必须在 file part 之前发送' },
        file: { description: '必须在 kind 和 expectedVersion part 之后发送' },
      },
    })
    expect(layout?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ProductMediaLayoutRequestDto' },
        },
      },
    })
    expect(detach?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ProductMediaDetachRequestDto' },
        },
      },
    })
    expect(Object.keys(upload?.responses ?? {}).sort()).toEqual([
      '201', '400', '401', '403', '404', '409', '413', '415', '422', '500', '503',
    ])
    expect(Object.keys(layout?.responses ?? {}).sort()).toEqual([
      '200', '400', '401', '403', '404', '409', '422', '500',
    ])
    expect(Object.keys(detach?.responses ?? {}).sort()).toEqual([
      '200', '400', '401', '403', '404', '409', '422', '500', '503',
    ])

    for (const operation of [upload, layout, detach]) {
      expect(operation?.security).toEqual([{ sessionCookie: [] }])
      expect(operation?.parameters).toContainEqual({
        in: 'header',
        name: 'X-Qianshu-CSRF',
        required: true,
        schema: { type: 'string', enum: ['1'] },
      })
      expect(operation?.['x-qianshu-contract']).toMatchObject({
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator: true,
        conflict: true,
        validation: true,
        session: 'required',
        csrf: true,
        privateNoStore: true,
        retry: false,
      })
    }
    expect(upload?.['x-qianshu-contract']).toMatchObject({
      errors: [
        { status: 400, codes: ['MEDIA_MULTIPART_INVALID'] },
        {
          status: 403,
          codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
        },
        { status: 404, codes: ['PRODUCT_MEDIA_NOT_FOUND'] },
        { status: 409, codes: ['PRODUCT_STATE_CHANGED'] },
        { status: 413, codes: ['MEDIA_FILE_TOO_LARGE'] },
        { status: 415, codes: ['MEDIA_TYPE_UNSUPPORTED'] },
        {
          status: 422,
          codes: [
            'MEDIA_CONTENT_INVALID',
            'PRODUCT_MEDIA_LIMIT_EXCEEDED',
            'VALIDATION_FAILED',
          ],
        },
        { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
      ],
    })

    const uploadSchema = document.components?.schemas?.ProductMediaUploadRequestDto
    if (!uploadSchema || '$ref' in uploadSchema) {
      throw new Error('Missing ProductMedia upload request schema')
    }
    expect(uploadSchema.required).toEqual(['kind', 'expectedVersion', 'file'])
    expect(Object.keys(uploadSchema.properties ?? {})).toEqual([
      'kind', 'expectedVersion', 'file',
    ])
    expect(uploadSchema.properties?.kind).toEqual({
      type: 'string',
      enum: ['IMAGE', 'VIDEO'],
      description: '必须在 file part 之前发送',
    })
  })
})
