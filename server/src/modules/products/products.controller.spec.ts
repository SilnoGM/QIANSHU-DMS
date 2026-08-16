import { HttpStatus, Module } from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { attachRequestAuthContext } from '../auth/auth-context'
import {
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from '../auth/decorators/auth.decorators'
import {
  ProductCommandService,
  type ProductCommandContext,
} from './product-command.service'
import { ProductMediaContentService } from './media/product-media-content.service'
import { ProductMediaHttpService } from './media/product-media-http.service'
import { ProductQueryService } from './product-query.service'
import {
  type ProductUpdateContext,
  ProductUpdateService,
} from './product-update.service'
import { ProductsController } from './products.controller'

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR_ID,
    username: 'product_operator',
    displayName: '产品管理员',
    mustChangePassword: false,
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    lastActivityAt: new Date('2026-08-12T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-08-13T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-09-12T00:00:00.000Z'),
  })
  return request
}

function createController(): {
  readonly controller: ProductsController
  readonly list: jest.Mock
  readonly getById: jest.Mock<Promise<{ id: string }>, [string]>
  readonly create: jest.Mock<
    Promise<{ productNo: string }>,
    [ProductCommandContext, unknown]
  >
  readonly update: jest.Mock<
    Promise<{ id: string; version: number }>,
    [ProductUpdateContext, string, unknown]
  >
} {
  const list = jest.fn().mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  })
  const create = jest.fn<
    Promise<{ productNo: string }>,
    [ProductCommandContext, unknown]
  >().mockResolvedValue({ productNo: 'P0001' })
  const getById = jest.fn<Promise<{ id: string }>, [string]>()
    .mockResolvedValue({ id: '44444444-4444-4444-8444-444444444444' })
  const update = jest.fn<
    Promise<{ id: string; version: number }>,
    [ProductUpdateContext, string, unknown]
  >().mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    version: 2,
  })
  return {
    controller: new ProductsController(
      { list, getById } as unknown as ProductQueryService,
      { create } as unknown as ProductCommandService,
      { update } as unknown as ProductUpdateService,
      {
        upload: jest.fn(),
        updateLayout: jest.fn(),
        detach: jest.fn(),
      } as unknown as ProductMediaHttpService,
      { resolve: jest.fn() } as unknown as ProductMediaContentService,
    ),
    list,
    getById,
    create,
    update,
  }
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
class ProductsControllerContractModule {}

describe('ProductsController', () => {
  it('delegates all confirmed operations with trusted context', async () => {
    const fixture = createController()
    const query = {
      keyword: 'Product-001',
      page: 2,
      pageSize: 50,
      supplierValue: 'SUPPLIER_A',
    }

    await fixture.controller.list(query)
    const dto = {
      name: 'Product',
      status: 'DRAFT' as const,
      supplierValue: null,
      twdSalePrice: { amount: null, currency: 'TWD' as const },
      myrSalePrice: { amount: null, currency: 'MYR' as const },
      purchaseCost: { amount: null, currency: 'CNY' },
      attributes: [],
    }
    const request = createRequest()
    await fixture.controller.create(dto, request, IDEMPOTENCY_KEY)
    const productId = '44444444-4444-4444-8444-444444444444'
    await fixture.controller.getById({ productId })
    const updateDto = { name: '新产品', expectedVersion: 1 }
    await fixture.controller.update({ productId }, updateDto, request)

    expect(fixture.list).toHaveBeenCalledWith(query)
    const createContext = fixture.create.mock.calls[0]?.[0]
    expect(createContext).toMatchObject({
      actorUserId: ACTOR_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    })
    expect(typeof createContext?.requestId).toBe('string')
    expect(fixture.create.mock.calls[0]?.[1]).toBe(dto)
    expect(fixture.getById).toHaveBeenCalledWith(productId)
    const updateContext = fixture.update.mock.calls[0]?.[0]
    expect(updateContext).toMatchObject({ actorUserId: ACTOR_ID })
    expect(typeof updateContext?.requestId).toBe('string')
    expect(fixture.update).toHaveBeenCalledWith(
      updateContext,
      productId,
      updateDto,
    )
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      ProductsController.prototype.list,
    )).toEqual(['products:read'])
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      ProductsController.prototype.create,
    )).toEqual(['products:create'])
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      ProductsController.prototype.getById,
    )).toEqual(['products:read'])
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      ProductsController.prototype.update,
    )).toEqual(['products:update'])
    expect(reflector.get(
      REQUIRE_AUTHENTICATED_SESSION_METADATA,
      ProductsController,
    )).toBeUndefined()
    expect(Reflect.getMetadata(
      HTTP_CODE_METADATA,
      ProductsController.prototype.create,
    )).toBe(HttpStatus.CREATED)
    expect(Object.getOwnPropertyNames(ProductsController.prototype).sort())
      .toEqual([
        'constructor',
        'create',
        'detachMedia',
        'getById',
        'getMediaContent',
        'headMediaContent',
        'list',
        'update',
        'updateMediaLayout',
        'uploadMedia',
      ])
  })

  it.each([
    undefined,
    '',
    '33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-33333333333A',
    '33333333-3333-3333-8333-333333333333',
  ])('rejects invalid Idempotency-Key before command delegation: %s', (key) => {
    const fixture = createController()
    expect(() => fixture.controller.create({} as never, createRequest(), key))
      .toThrow(expect.objectContaining({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'VALIDATION_FAILED',
      }))
    expect(fixture.create).not.toHaveBeenCalled()
  })
})

describe('ProductsController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(ProductsControllerContractModule)
  })

  it('publishes the list, create, detail and update operations only', () => {
    expect(Object.keys(document.paths).filter(path =>
      path.startsWith('/api/products')).sort()).toEqual([
      '/api/products',
      '/api/products/{productId}',
      '/api/products/{productId}/media',
      '/api/products/{productId}/media/layout',
      '/api/products/{productId}/media/{productMediaId}',
      '/api/products/{productId}/media/{productMediaId}/content',
    ].sort())
    const path = document.paths['/api/products']
    const operation: ContractOperation | undefined = path?.get
    expect(operation?.operationId).toBe('products_list')
    expect(Object.keys(path ?? {}).sort()).toEqual(['get', 'post'])
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '422',
      '500',
    ])
    expect(operation?.security).toEqual([{ sessionCookie: [] }])
    const keywordParameter = operation?.parameters?.find(parameter =>
      'name' in parameter && parameter.name === 'keyword')
    expect(keywordParameter).toEqual({
      description: '产品名称或产品编号，不区分大小写的包含匹配',
      in: 'query',
      name: 'keyword',
      required: false,
      schema: {
        maxLength: 128,
        minLength: 1,
        type: 'string',
      },
    })
    const statusParameter = operation?.parameters?.find(parameter =>
      'name' in parameter && parameter.name === 'status')
    expect(statusParameter).toEqual({
      description: '产品状态精确匹配',
      in: 'query',
      name: 'status',
      required: false,
      schema: {
        enum: ['DRAFT', 'ACTIVE', 'INACTIVE'],
        type: 'string',
      },
    })
    expect(operation?.['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: true,
      authorization: true,
      resourceLocator: false,
      conflict: false,
      validation: true,
      session: 'required',
      privateNoStore: true,
      errors: [
        { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
        { status: 422, codes: ['VALIDATION_FAILED'] },
      ],
    })
    expect(operation?.responses?.[String(HttpStatus.OK)]).toBeDefined()

    const createOperation: ContractOperation | undefined = path?.post
    expect(createOperation?.operationId).toBe('products_create')
    expect(Object.keys(createOperation?.responses ?? {}).sort()).toEqual([
      '201',
      '400',
      '401',
      '403',
      '409',
      '422',
      '500',
    ])
    expect(createOperation?.security).toEqual([{ sessionCookie: [] }])
    expect(createOperation?.parameters).toEqual(expect.arrayContaining([
      {
        in: 'header',
        name: 'Idempotency-Key',
        required: true,
        schema: {
          format: 'uuid',
          pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
      },
      {
        in: 'header',
        name: 'X-Qianshu-CSRF',
        required: true,
        schema: { type: 'string', enum: ['1'] },
      },
    ]))
    expect(createOperation?.['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: true,
      authorization: true,
      resourceLocator: false,
      conflict: true,
      validation: true,
      session: 'required',
      csrf: true,
      privateNoStore: true,
      errors: [
        {
          status: 403,
          codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
        },
        {
          status: 409,
          codes: [
            'PRODUCT_CREATE_IDEMPOTENCY_CONFLICT',
            'PRODUCT_NUMBERING_UNAVAILABLE',
            'PRODUCT_NUMBER_CONFLICT',
            'PRODUCT_STATE_CHANGED',
          ],
        },
        {
          status: 422,
          codes: [
            'PRODUCT_CURRENCY_UNAVAILABLE',
            'PRODUCT_SUPPLIER_REQUIRED',
            'PRODUCT_SUPPLIER_UNAVAILABLE',
            'VALIDATION_FAILED',
          ],
        },
      ],
    })
    expect(createOperation?.requestBody).toBeDefined()
    expect(createOperation?.responses?.[String(HttpStatus.CREATED)])
      .toBeDefined()
    expect(createOperation?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateProductRequestDto' },
        },
      },
    })
    const createSchema = document.components?.schemas
      ?.CreateProductRequestDto
    if (createSchema === undefined || '$ref' in createSchema) {
      throw new Error('Missing inline CreateProductRequestDto schema')
    }
    expect(createSchema).toMatchObject({
      type: 'object',
      required: [
        'name',
        'status',
        'supplierValue',
        'twdSalePrice',
        'myrSalePrice',
        'purchaseCost',
        'attributes',
      ],
    })
    expect(Object.keys(createSchema.properties ?? {})).toEqual([
      'name',
      'status',
      'supplierValue',
      'twdSalePrice',
      'myrSalePrice',
      'purchaseCost',
      'attributes',
    ])
    for (const response of Object.values(createOperation?.responses ?? {})) {
      if (response && !('$ref' in response)) {
        expect(response.headers).toMatchObject({
          'Cache-Control': {
            schema: { enum: ['private, no-store'] },
          },
          'X-Request-Id': {
            schema: { type: 'string' },
          },
        })
      }
    }

    const resourcePath = document.paths['/api/products/{productId}']
    expect(Object.keys(resourcePath ?? {}).sort()).toEqual(['get', 'patch'])
    const detailOperation = resourcePath?.get
    expect(detailOperation?.operationId).toBe('products_get_by_id')
    expect(Object.keys(detailOperation?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '422',
      '500',
    ])
    expect(detailOperation?.parameters).toContainEqual({
      in: 'path',
      name: 'productId',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    })
    expect(Reflect.get(
      detailOperation ?? {},
      'x-qianshu-contract',
    )).toEqual({
      kind: 'application',
      authentication: true,
      authorization: true,
      resourceLocator: true,
      conflict: false,
      validation: true,
      session: 'required',
      privateNoStore: true,
      errors: [
        { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
        { status: 404, codes: ['PRODUCT_NOT_FOUND'] },
        { status: 422, codes: ['VALIDATION_FAILED'] },
      ],
    })

    const updateOperation = resourcePath?.patch
    expect(updateOperation?.operationId).toBe('products_update')
    expect(Object.keys(updateOperation?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '422',
      '500',
    ])
    expect(Reflect.get(
      updateOperation ?? {},
      'x-qianshu-contract',
    )).toEqual({
      kind: 'application',
      authentication: true,
      authorization: true,
      resourceLocator: true,
      conflict: true,
      validation: true,
      session: 'required',
      csrf: true,
      privateNoStore: true,
      errors: [
        {
          status: 403,
          codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
        },
        { status: 404, codes: ['PRODUCT_NOT_FOUND'] },
        { status: 409, codes: ['PRODUCT_STATE_CHANGED'] },
        {
          status: 422,
          codes: [
            'PRODUCT_CURRENCY_UNAVAILABLE',
            'PRODUCT_SUPPLIER_REQUIRED',
            'PRODUCT_SUPPLIER_UNAVAILABLE',
            'VALIDATION_FAILED',
          ],
        },
      ],
    })
    expect(updateOperation?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateProductRequestDto' },
        },
      },
    })
    const updateSchema = document.components?.schemas
      ?.UpdateProductRequestDto
    if (updateSchema === undefined || '$ref' in updateSchema) {
      throw new Error('Missing inline UpdateProductRequestDto schema')
    }
    expect(updateSchema.required).toEqual(['expectedVersion'])
    expect(Object.keys(updateSchema.properties ?? {})).toEqual([
      'name',
      'status',
      'supplierValue',
      'twdSalePrice',
      'myrSalePrice',
      'purchaseCost',
      'attributes',
      'expectedVersion',
    ])

    const responseSchema = document.components?.schemas?.ProductListItemDto
    const mediaSchema = document.components?.schemas?.ProductMediaDto
    const mediaItemSchema = document.components?.schemas?.ProductMediaItemDto
    if (
      responseSchema === undefined
      || mediaSchema === undefined
      || mediaItemSchema === undefined
      || '$ref' in responseSchema
      || '$ref' in mediaSchema
      || '$ref' in mediaItemSchema
    ) {
      throw new Error('Missing structured Product media response schemas')
    }
    expect(Object.keys(responseSchema.properties ?? {})).not.toEqual(
      expect.arrayContaining(['mainImage', 'images', 'videos']),
    )
    expect(responseSchema.properties?.media).toEqual({
      $ref: '#/components/schemas/ProductMediaDto',
    })
    expect(mediaSchema).toMatchObject({
      type: 'object',
      required: ['mainImage', 'images', 'videos'],
      properties: {
        mainImage: {
          allOf: [{ $ref: '#/components/schemas/ProductMediaItemDto' }],
          nullable: true,
        },
        images: {
          type: 'array',
          items: { $ref: '#/components/schemas/ProductMediaItemDto' },
        },
        videos: {
          type: 'array',
          items: { $ref: '#/components/schemas/ProductMediaItemDto' },
        },
      },
    })
    expect(Object.keys(mediaItemSchema.properties ?? {})).toEqual([
      'id',
      'kind',
      'originalFilename',
      'mimeType',
      'sizeBytes',
      'width',
      'height',
      'durationMs',
      'sortOrder',
      'isPrimary',
      'contentUrl',
      'createdAt',
    ])
  })
})
