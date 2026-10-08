import { Readable } from 'node:stream'

import { HttpStatus, Module, StreamableFile } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { attachRequestAuthContext } from '../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import type { ProductMediaContentResponse } from '../products/media/product-media-content.service'
import { PurchaseShippingMarkResolverService } from '../purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import { PurchaseOrderDocumentService } from './documents/purchase-order-document.service'
import { PurchaseOrderCommandService } from './purchase-order-command.service'
import { PurchaseOrderMutationService } from './purchase-order-mutation.service'
import { PurchaseOrderProductImageService } from './products/purchase-order-product-image.service'
import { PurchaseOrderQueryService } from './purchase-order-query.service'
import { PurchaseOrderReviewContextController } from './purchase-order-review-context.controller'
import { PurchaseOrderReviewContextService } from './purchase-order-review-context.service'
import { PurchaseOrderSourceQueryService } from './purchase-order-source-query.service'
import { PurchaseOrdersController } from './purchase-orders.controller'

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
type ContractOperation = NonNullable<OpenAPIObject['paths'][string]['get']> & {
  'x-qianshu-contract'?: unknown
}

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: '44444444-4444-4444-8444-444444444444',
    userId: ACTOR_ID,
    username: 'purchase_operator',
    displayName: '采购操作员',
    mustChangePassword: false,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    lastActivityAt: new Date('2026-08-27T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-08-28T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-09-27T00:00:00.000Z'),
  })
  return request
}

const providers = [{
  provide: PurchaseOrderReviewContextService,
  useValue: { read: jest.fn() },
}, {
  provide: PurchaseShippingMarkResolverService,
  useValue: { read: jest.fn() },
}, {
  provide: PurchaseOrderQueryService,
  useValue: { getById: jest.fn(), list: jest.fn(), statusCounts: jest.fn() },
}, {
  provide: PurchaseOrderSourceQueryService,
  useValue: {
    productOptions: jest.fn(), salesOrders: jest.fn(), salesOrderLines: jest.fn(),
  },
}, {
  provide: PurchaseOrderCommandService,
  useValue: { create: jest.fn() },
}, {
  provide: PurchaseOrderMutationService,
  useValue: {
    review: jest.fn(),
    updateOrderStatus: jest.fn(),
    updateFulfillmentStatus: jest.fn(),
    recordPayment: jest.fn(),
    voidPayment: jest.fn(),
  },
}, {
  provide: PurchaseOrderDocumentService,
  useValue: {
    uploadTemporary: jest.fn(), detach: jest.fn(), resolveContent: jest.fn(),
  },
}, {
  provide: PurchaseOrderProductImageService,
  useValue: {
    resolve: jest.fn(), resolveListPreview: jest.fn(), resolveSourceLinePreview: jest.fn(),
  },
}]

@Module({ controllers: [PurchaseOrdersController, PurchaseOrderReviewContextController], providers })
class PurchaseOrdersContractModule {}

describe('PurchaseOrdersController', () => {
  it('reserves purchase cancellation for reviewers and accepts an omitted reason', async () => {
    const updateOrderStatus = jest.fn().mockResolvedValue({ id: ORDER_ID, orderStatus: 'CANCELLED' })
    const controller = new PurchaseOrdersController(
      {} as PurchaseOrderQueryService,
      {} as PurchaseOrderSourceQueryService,
      {} as PurchaseOrderCommandService,
      { updateOrderStatus } as unknown as PurchaseOrderMutationService,
      {} as PurchaseOrderDocumentService,
      {} as PurchaseOrderProductImageService,
      {} as PurchaseShippingMarkResolverService,
    )
    const input = { toStatus: 'CANCELLED' as const }

    await expect(controller.updateOrderStatus({ purchaseOrderId: ORDER_ID }, input, createRequest()))
      .resolves.toEqual({ id: ORDER_ID, orderStatus: 'CANCELLED' })
    expect(updateOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: ACTOR_ID }), ORDER_ID, input)
    expect(new Reflector().get(REQUIRED_PERMISSIONS_METADATA, PurchaseOrdersController.prototype.updateOrderStatus))
      .toEqual(['purchase-orders:review'])
  })

  it('requires review permission for the read-only eligibility check', async () => {
    const read = jest.fn().mockResolvedValue({ available: true, message: null })
    const controller = new PurchaseOrderReviewContextController({ read } as unknown as PurchaseOrderReviewContextService)
    await expect(controller.read({ purchaseOrderId: ORDER_ID })).resolves.toEqual({ available: true, message: null })
    expect(read).toHaveBeenCalledWith(ORDER_ID)
    expect(new Reflector().get(REQUIRED_PERMISSIONS_METADATA, PurchaseOrderReviewContextController.prototype.read))
      .toEqual(['purchase-orders:review'])
  })
  it('requires the independent review permission and delegates the versioned approval', async () => {
    const review = jest.fn().mockResolvedValue({ id: ORDER_ID })
    const controller = new PurchaseOrdersController(
      {} as PurchaseOrderQueryService,
      {} as PurchaseOrderSourceQueryService,
      {} as PurchaseOrderCommandService,
      { review } as unknown as PurchaseOrderMutationService,
      {} as PurchaseOrderDocumentService,
      {} as PurchaseOrderProductImageService,
      {} as PurchaseShippingMarkResolverService,
    )
    const input = { expectedVersion: 2, imageDraftId: ORDER_ID, reason: '审核通过' }
    await expect(controller.review({ purchaseOrderId: ORDER_ID }, input, createRequest()))
      .resolves.toEqual({ id: ORDER_ID })
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: ACTOR_ID }), ORDER_ID, input)
    expect(new Reflector().get(REQUIRED_PERMISSIONS_METADATA, PurchaseOrdersController.prototype.review))
      .toEqual(['purchase-orders:review'])
  })
  it('allows creation operators to resolve only their scene without binding-management permissions', async () => {
    const shippingMarks = { read: jest.fn().mockResolvedValue({ availability: 'AVAILABLE' }) }
    const controller = new PurchaseOrdersController(
      {} as PurchaseOrderQueryService,
      {} as PurchaseOrderSourceQueryService,
      {} as PurchaseOrderCommandService,
      {} as PurchaseOrderMutationService,
      {} as PurchaseOrderDocumentService,
      {} as PurchaseOrderProductImageService,
      shippingMarks as unknown as PurchaseShippingMarkResolverService,
    )
    const query = { productMode: 'CUSTOM' as const }
    expect(await controller.shippingMarkResolution(query)).toEqual({ availability: 'AVAILABLE' })
    expect(shippingMarks.read).toHaveBeenCalledWith(query)
    expect(new Reflector().get(
      REQUIRED_PERMISSIONS_METADATA,
      PurchaseOrdersController.prototype.shippingMarkResolution,
    )).toEqual(['purchase-orders:create'])
  })

  it('keeps base create permission separate from system-only stock authorization', () => {
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      PurchaseOrdersController.prototype.create,
    )).toEqual(['purchase-orders:create'])
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      PurchaseOrdersController.prototype.recordPayment,
    )).toEqual(['purchase-orders:payment'])
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      PurchaseOrdersController.prototype.uploadTemporaryDocument,
    )).toEqual(['purchase-orders:document'])
  })

  it('returns the persisted detail after idempotent creation', async () => {
    const commands = { create: jest.fn().mockResolvedValue(ORDER_ID) }
    const queries = {
      getById: jest.fn().mockResolvedValue({ id: ORDER_ID }),
      list: jest.fn(),
    }
    const controller = new PurchaseOrdersController(
      queries as unknown as PurchaseOrderQueryService,
      {} as PurchaseOrderSourceQueryService,
      commands as unknown as PurchaseOrderCommandService,
      {} as PurchaseOrderMutationService,
      {} as PurchaseOrderDocumentService,
      {} as PurchaseOrderProductImageService,
      {} as PurchaseShippingMarkResolverService,
    )
    const request = createRequest()
    const input = { purchaseType: 'STOCK' }

    await expect(controller.create(
      input as never,
      request,
      '33333333-3333-4333-8333-333333333333',
    )).resolves.toEqual({ id: ORDER_ID })
    expect(commands.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
      }),
      input,
    )
    expect(queries.getById).toHaveBeenCalledWith(ORDER_ID)
  })

  it('reads status counts with purchase-order read permission', async () => {
    const statusCounts = jest.fn().mockResolvedValue({ view: 'pending', items: [] })
    const controller = new PurchaseOrdersController(
      { statusCounts } as unknown as PurchaseOrderQueryService,
      {} as PurchaseOrderSourceQueryService,
      {} as PurchaseOrderCommandService,
      {} as PurchaseOrderMutationService,
      {} as PurchaseOrderDocumentService,
      {} as PurchaseOrderProductImageService,
      {} as PurchaseShippingMarkResolverService,
    )
    const query = { view: 'pending' as const, supplierValue: 'SUPPLIER_A' }

    await expect(controller.statusCounts(query)).resolves.toEqual({
      view: 'pending',
      items: [],
    })
    expect(statusCounts).toHaveBeenCalledWith(query)
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      PurchaseOrdersController.prototype.statusCounts,
    )).toEqual(['purchase-orders:read'])
  })

  it('keeps the trusted sales-source selector inside purchase creation permission', async () => {
    const salesOrders = jest.fn().mockResolvedValue({
      view: 'UNPURCHASED',
      counts: [],
      items: [],
    })
    const controller = new PurchaseOrdersController(
      {} as PurchaseOrderQueryService,
      { salesOrders } as unknown as PurchaseOrderSourceQueryService,
      {} as PurchaseOrderCommandService,
      {} as PurchaseOrderMutationService,
      {} as PurchaseOrderDocumentService,
      {} as PurchaseOrderProductImageService,
      {} as PurchaseShippingMarkResolverService,
    )
    const query = {
      view: 'UNPURCHASED' as const,
      productMode: 'CATALOG' as const,
      supplierValue: 'SUPPLIER_A',
    }

    await expect(controller.sourceSalesOrders(query)).resolves.toMatchObject({
      view: 'UNPURCHASED',
    })
    expect(salesOrders).toHaveBeenCalledWith(query)
    expect(new Reflector().get(
      REQUIRED_PERMISSIONS_METADATA,
      PurchaseOrdersController.prototype.sourceSalesOrders,
    )).toEqual(['purchase-orders:create'])
  })

  it('protects and delegates GET/HEAD product main image content', async () => {
    const stream = Readable.from(Buffer.from('image'))
    const result: ProductMediaContentResponse = {
      status: HttpStatus.OK,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'image/png',
        ETag: '"safe"',
        'X-Content-Type-Options': 'nosniff',
      },
      stream,
    }
    const resolve = jest.fn().mockResolvedValue(result)
    const controller = new PurchaseOrdersController(
      {} as PurchaseOrderQueryService,
      {} as PurchaseOrderSourceQueryService,
      {} as PurchaseOrderCommandService,
      {} as PurchaseOrderMutationService,
      {} as PurchaseOrderDocumentService,
      { resolve } as unknown as PurchaseOrderProductImageService,
      {} as PurchaseShippingMarkResolverService,
    )
    const params = {
      productId: '33333333-3333-4333-8333-333333333333',
      productMediaId: '44444444-4444-4444-8444-444444444444',
    }
    const response = { status: jest.fn(), setHeader: jest.fn() }

    await controller.headProductOptionMainImage(
      params, '"known"', 'bytes=0-0', undefined, response,
    )
    const body = await controller.getProductOptionMainImage(
      params, undefined, undefined, 'thumb', response,
    )

    expect(resolve).toHaveBeenNthCalledWith(
      1, params.productId, params.productMediaId, '"known"', 'bytes=0-0', 'HEAD', undefined,
    )
    expect(resolve).toHaveBeenNthCalledWith(
      2, params.productId, params.productMediaId, undefined, undefined, 'GET', 'thumb',
    )
    expect(body).toBeInstanceOf(StreamableFile)
    expect((body as StreamableFile).getStream()).toBe(stream)
    const reflector = new Reflector()
    for (const method of [
      'headProductOptionMainImage', 'getProductOptionMainImage',
    ] as const) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        PurchaseOrdersController.prototype[method],
      )).toEqual(['purchase-orders:create'])
    }
  })

  it('protects and delegates GET/HEAD sales source line main image content', async () => {
    const stream = Readable.from(Buffer.from('image'))
    const result: ProductMediaContentResponse = {
      status: HttpStatus.OK,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'image/png',
        ETag: '"safe"',
        'X-Content-Type-Options': 'nosniff',
      },
      stream,
    }
    const resolveSourceLinePreview = jest.fn().mockResolvedValue(result)
    const controller = new PurchaseOrdersController(
      {} as PurchaseOrderQueryService,
      {} as PurchaseOrderSourceQueryService,
      {} as PurchaseOrderCommandService,
      {} as PurchaseOrderMutationService,
      {} as PurchaseOrderDocumentService,
      { resolveSourceLinePreview } as unknown as PurchaseOrderProductImageService,
      {} as PurchaseShippingMarkResolverService,
    )
    const params = {
      salesOrderId: '33333333-3333-4333-8333-333333333333',
      lineId: '44444444-4444-4444-8444-444444444444',
      productMediaId: '55555555-5555-4555-8555-555555555555',
    }
    const response = { status: jest.fn(), setHeader: jest.fn() }

    await controller.headSourceSalesOrderLineMainImage(
      params, '"known"', 'bytes=0-0', undefined, response,
    )
    const body = await controller.getSourceSalesOrderLineMainImage(
      params, undefined, undefined, 'thumb', response,
    )

    expect(resolveSourceLinePreview).toHaveBeenNthCalledWith(
      1,
      params.salesOrderId,
      params.lineId,
      params.productMediaId,
      '"known"',
      'bytes=0-0',
      'HEAD',
      undefined,
    )
    expect(resolveSourceLinePreview).toHaveBeenNthCalledWith(
      2,
      params.salesOrderId,
      params.lineId,
      params.productMediaId,
      undefined,
      undefined,
      'GET',
      'thumb',
    )
    expect(body).toBeInstanceOf(StreamableFile)
    expect((body as StreamableFile).getStream()).toBe(stream)
    const reflector = new Reflector()
    for (const method of [
      'headSourceSalesOrderLineMainImage',
      'getSourceSalesOrderLineMainImage',
    ] as const) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        PurchaseOrdersController.prototype[method],
      )).toEqual(['purchase-orders:create'])
    }
  })

  it('serves purchase list preview images through an independent read-authorized route', async () => {
    const stream = Readable.from(Buffer.from('image'))
    const result: ProductMediaContentResponse = {
      status: HttpStatus.OK,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'image/webp',
        ETag: '"safe"',
        'X-Content-Type-Options': 'nosniff',
      },
      stream,
    }
    const resolveListPreview = jest.fn().mockResolvedValue(result)
    const controller = new PurchaseOrdersController(
      {} as PurchaseOrderQueryService,
      {} as PurchaseOrderSourceQueryService,
      {} as PurchaseOrderCommandService,
      {} as PurchaseOrderMutationService,
      {} as PurchaseOrderDocumentService,
      { resolveListPreview } as unknown as PurchaseOrderProductImageService,
      {} as PurchaseShippingMarkResolverService,
    )
    const params = {
      purchaseOrderId: ORDER_ID,
      lineId: '33333333-3333-4333-8333-333333333333',
      productMediaId: '44444444-4444-4444-8444-444444444444',
    }
    const response = { status: jest.fn(), setHeader: jest.fn() }

    await controller.headProductPreviewMainImage(
      params, '"known"', 'bytes=0-0', undefined, response,
    )
    const body = await controller.getProductPreviewMainImage(
      params, undefined, undefined, 'thumb', response,
    )

    expect(resolveListPreview).toHaveBeenNthCalledWith(
      1,
      params.purchaseOrderId,
      params.lineId,
      params.productMediaId,
      '"known"',
      'bytes=0-0',
      'HEAD',
      undefined,
    )
    expect(resolveListPreview).toHaveBeenNthCalledWith(
      2,
      params.purchaseOrderId,
      params.lineId,
      params.productMediaId,
      undefined,
      undefined,
      'GET',
      'thumb',
    )
    expect(body).toBeInstanceOf(StreamableFile)

    const reflector = new Reflector()
    for (const method of [
      'headProductPreviewMainImage', 'getProductPreviewMainImage',
    ] as const) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        PurchaseOrdersController.prototype[method],
      )).toEqual(['purchase-orders:read'])
    }
  })
})

describe('PurchaseOrdersController OpenAPI', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(PurchaseOrdersContractModule)
  })

  it('publishes a private read-only review precheck and nullable historical review summary', () => {
    const operation: ContractOperation | undefined = document.paths['/api/purchase-orders/{purchaseOrderId}/review-context']?.get
    expect(operation).toMatchObject({
      operationId: 'purchase_orders_review_context',
      security: [{ sessionCookie: [] }],
      'x-qianshu-contract': { authorization: true, validation: true, privateNoStore: true },
      responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/PurchaseOrderReviewContextDto' } } } } },
    })
    expect(operation?.['x-qianshu-contract']).not.toMatchObject({ csrf: true })
    expect(document.components?.schemas?.PurchaseOrderReviewContextDto).toMatchObject({
      required: ['available', 'message'],
      properties: { available: { type: 'boolean' }, message: { type: 'string', nullable: true } },
    })
    for (const name of ['PurchaseOrderDetailDto', 'PurchaseOrderListItemDto']) {
      expect(document.components?.schemas?.[name]).toMatchObject({
        properties: { reviewSummary: { nullable: true } },
      })
    }
  })

  it('publishes the review route with version, detail response, CSRF and state-conflict contract', () => {
    const review: ContractOperation | undefined = document.paths[
      '/api/purchase-orders/{purchaseOrderId}/review'
    ]?.post
    expect(review).toMatchObject({
      operationId: 'purchase_orders_review',
      security: [{ sessionCookie: [] }],
      'x-qianshu-contract': {
        authorization: true, csrf: true, validation: true, privateNoStore: true,
        errors: expect.arrayContaining([
          { status: 409, codes: ['PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE', 'PURCHASE_ORDER_STATE_CHANGED'] },
        ]) as unknown,
      },
      responses: { 200: { content: { 'application/json': {
        schema: { $ref: '#/components/schemas/PurchaseOrderDetailDto' },
      } }, headers: { 'X-Request-Id': expect.any(Object) as unknown } } },
    })
    expect(document.components?.schemas?.PurchaseOrderReviewRequestDto).toMatchObject({
      required: ['imageDraftId', 'expectedVersion'],
      properties: {
        imageDraftId: { type: 'string', format: 'uuid' },
        expectedVersion: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        reason: { type: 'string', minLength: 1, maxLength: 500 },
      },
    })
    expect(document.components?.schemas?.PurchaseOrderPartDto).toMatchObject({
      required: expect.arrayContaining(['shipmentNo', 'warehouseReceivedAt', 'warehouseReceivedById', 'warehouseRecordedAt', 'warehouseRemark', 'warehouseReceivedBy']) as unknown,
      properties: { shipmentNo: { type: 'string', nullable: true, maxLength: 64 }, shippingMarkText: { type: 'string', nullable: true, maxLength: 72 } },
    })
  })

  it('publishes warehouse receipt conflicts on the legacy fulfillment signing endpoint', () => {
    expect(document.paths['/api/purchase-orders/{purchaseOrderId}/fulfillment-status']?.patch).toMatchObject({
      'x-qianshu-contract': { conflict: true, errors: expect.arrayContaining([
        { status: 409, codes: ['PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED'] },
        expect.objectContaining({ status: 422, codes: expect.arrayContaining([
          'PURCHASE_WAREHOUSE_RECEIPT_NOT_ALLOWED', 'PURCHASE_WAREHOUSE_RECEIPT_TARGET_INVALID', 'PURCHASE_WAREHOUSE_RECEIPT_TIME_INVALID',
        ]) as unknown }),
      ]) as unknown },
    })
  })

  it('publishes the scene resolution and automatic shipping mark create contract', () => {
    const resolution: ContractOperation | undefined = document.paths[
      '/api/purchase-orders/shipping-mark-resolution'
    ]?.get
    expect(resolution).toMatchObject({
      operationId: 'purchase_orders_shipping_mark_resolution',
      security: [{ sessionCookie: [] }],
      'x-qianshu-contract': { authorization: true, validation: true, privateNoStore: true },
      responses: { 200: { headers: { 'X-Request-Id': expect.any(Object) as unknown } } },
    })
    expect(resolution?.parameters).toHaveLength(2)
    expect(resolution?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: 'query', name: 'productMode', required: true }),
      expect.objectContaining({ in: 'query', name: 'supplierValue', required: false }),
    ]))
    expect(document.components?.schemas?.PurchaseOrderShippingMarkResolutionDto).toMatchObject({
      required: ['productMode', 'matchSource', 'ruleId', 'ruleCode', 'name', 'activeRevision', 'activeConfig', 'availability', 'message', 'resolutionToken'],
      properties: {
        matchSource: { enum: ['SUPPLIER_BINDING', 'CUSTOM_RULE'] },
        ruleId: { nullable: true, type: 'string', format: 'uuid' },
        activeConfig: { nullable: true, allOf: [{ $ref: '#/components/schemas/NumberingRuleConfigResponseDto' }] },
        resolutionToken: { nullable: true, type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
    })
    const create: ContractOperation | undefined = document.paths['/api/purchase-orders']?.post
    expect(create?.['x-qianshu-contract']).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ status: 409, codes: expect.arrayContaining([
          'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED',
          'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE',
        ]) as unknown }),
      ]) as unknown,
    })
    expect(document.components?.schemas?.CreatePurchaseOrderRequestDto).toMatchObject({
      required: expect.arrayContaining(['expectedShippingMarkResolution']) as unknown,
      properties: { expectedShippingMarkResolution: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
    })
    const schema = document.components?.schemas?.CreatePurchaseOrderRequestDto
    expect(schema && 'properties' in schema && schema.properties).not.toHaveProperty('shippingMarkText')
  })

  it('publishes effective purchased-line snapshots for sales-source reconciliation', () => {
    expect(document.components?.schemas).toMatchObject({
      PurchaseOrderSourceSalesOrderViewCountItemDto: {
        properties: {
          value: {
            enum: [
              'UNPURCHASED',
              'PARTIALLY_PURCHASED',
            ],
            type: 'string',
          },
          count: { minimum: 0, type: 'integer' },
        },
      },
      PurchaseOrderSourcePurchasedLineDto: {
        properties: {
          id: { format: 'uuid', type: 'string' },
          referencePurchaseUnitPriceAmount: { type: 'string' },
          actualPurchaseUnitPriceAmount: { type: 'string' },
          quantity: { minimum: 1, type: 'integer' },
          lineTotalAmount: { type: 'string' },
          description: { nullable: true, type: 'string' },
        },
      },
      PurchaseOrderSourceSalesOrderLineDto: {
        properties: {
          purchasedLines: {
            items: { $ref: '#/components/schemas/PurchaseOrderSourcePurchasedLineDto' },
            type: 'array',
          },
        },
      },
    })
  })

  it('publishes the fixed purchase API paths and stable operation ids', () => {
    expect(document.paths['/api/purchase-orders']?.get)
      .toMatchObject({ operationId: 'purchase_orders_list' })
    expect(document.paths['/api/purchase-orders']?.post)
      .toMatchObject({ operationId: 'purchase_orders_create' })
    const statusCounts: ContractOperation | undefined = document.paths[
      '/api/purchase-orders/status-counts'
    ]?.get
    expect(statusCounts).toMatchObject({ operationId: 'purchase_orders_status_counts' })
    expect(statusCounts?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: 'query', name: 'view', required: true }),
      expect.objectContaining({ in: 'query', name: 'supplierValue' }),
      expect.objectContaining({ in: 'query', name: 'purchaseType' }),
    ]))
    expect(statusCounts?.['x-qianshu-contract']).toMatchObject({
      authorization: true,
      privateNoStore: true,
      validation: true,
    })
    expect(document.paths['/api/purchase-orders/product-options']?.get)
      .toMatchObject({ operationId: 'purchase_orders_product_options' })
    const sourceSalesOrders: ContractOperation | undefined = document.paths[
      '/api/purchase-orders/source-sales-orders'
    ]?.get
    expect(sourceSalesOrders)
      .toMatchObject({ operationId: 'purchase_orders_source_sales_orders' })
    const viewParameter = sourceSalesOrders?.parameters?.find(parameter => (
      'name' in parameter && parameter.name === 'view'
    ))
    expect(viewParameter).toMatchObject({
      in: 'query',
      name: 'view',
      required: true,
      schema: {
        enum: [
          'UNPURCHASED',
          'PARTIALLY_PURCHASED',
        ],
      },
    })
    expect(sourceSalesOrders?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: 'query', name: 'productMode', required: true }),
      expect.objectContaining({ in: 'query', name: 'supplierValue', required: false }),
      expect.objectContaining({ in: 'query', name: 'salesOrderId', required: false }),
    ]))
    expect(sourceSalesOrders?.security).toEqual([{ sessionCookie: [] }])
    expect(sourceSalesOrders?.['x-qianshu-contract']).toMatchObject({
      authorization: true,
      privateNoStore: true,
      validation: true,
    })
    const sourceContract = sourceSalesOrders?.['x-qianshu-contract']
    if (
      typeof sourceContract !== 'object'
      || sourceContract === null
      || !('errors' in sourceContract)
      || !Array.isArray(sourceContract.errors)
    ) {
      throw new Error('Sales-source OpenAPI contract must expose an errors array')
    }
    expect(sourceContract.errors).toContainEqual({
      status: 422,
      codes: [
        'PURCHASE_ORDER_PRODUCT_MODE_INVALID',
        'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID',
        'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE',
        'VALIDATION_FAILED',
      ],
    })
    const sourceSalesOrderLines: ContractOperation | undefined = document.paths[
      '/api/purchase-orders/source-sales-orders/{salesOrderId}/lines'
    ]?.get
    expect(sourceSalesOrderLines)
      .toMatchObject({ operationId: 'purchase_orders_source_sales_order_lines' })
    expect(sourceSalesOrderLines?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: 'query', name: 'productMode', required: true }),
      expect.objectContaining({ in: 'query', name: 'supplierValue', required: false }),
    ]))
    expect(document.paths[
      '/api/purchase-orders/{purchaseOrderId}/payments'
    ]?.post).toMatchObject({ operationId: 'purchase_orders_record_payment' })
    expect(document.paths[
      '/api/purchase-orders/{purchaseOrderId}/documents/{documentId}/content'
    ]?.head).toMatchObject({ operationId: 'purchase_orders_head_document_content' })
    expect(document.components?.schemas?.PurchaseOrderSupplierDto).toMatchObject({
      properties: {
        source: { enum: ['DICTIONARY', 'CUSTOM_TEXT'] },
        value: { nullable: true, type: 'string' },
        label: { type: 'string' },
        tone: { nullable: true, type: 'string' },
        known: { nullable: true, type: 'boolean' },
        effectiveEnabled: { nullable: true, type: 'boolean' },
      },
    })
    expect(document.components?.schemas?.PurchaseOrderListItemDto).toMatchObject({
      properties: {
        productMode: { enum: ['CATALOG', 'CUSTOM', 'MIXED'] },
        paymentRecordSummary: { $ref: '#/components/schemas/PurchaseOrderPaymentRecordSummaryDto' },
        documentSummary: { $ref: '#/components/schemas/PurchaseOrderDocumentSummaryDto' },
        changeSummary: { $ref: '#/components/schemas/PurchaseOrderChangeSummaryDto' },
      },
    })
    expect(document.components?.schemas?.PurchaseOrderPaymentTypeSummaryDto).toMatchObject({
      properties: { paymentType: { enum: ['DEPOSIT', 'BALANCE', 'OTHER'] }, amount: { type: 'string' } },
    })
    expect(document.components?.schemas?.PurchaseOrderPaymentRecordSummaryDto).toMatchObject({
      required: expect.arrayContaining(['totalCount', 'count', 'byType']) as unknown,
      properties: { totalCount: { type: 'integer', minimum: 0 } },
    })
    expect(document.components?.schemas?.PurchaseOrderChangeSummaryDto).toMatchObject({
      properties: { latest: { nullable: true } },
    })

    const imagePath = document.paths[
      '/api/purchase-orders/product-options/{productId}/main-image/{productMediaId}/content'
    ]
    const get: ContractOperation | undefined = imagePath?.get
    const head: ContractOperation | undefined = imagePath?.head
    expect(get?.operationId).toBe('purchase_orders_get_product_option_main_image')
    expect(head?.operationId).toBe('purchase_orders_head_product_option_main_image')
    for (const operation of [get, head]) {
      expect(operation?.security).toEqual([{ sessionCookie: [] }])
      const contract = operation?.['x-qianshu-contract']
      expect(contract).toMatchObject({
        authorization: true,
        resourceLocator: true,
      })
      expect(contract).not.toMatchObject({ privateNoStore: true })
      expect(operation?.parameters).toContainEqual(expect.objectContaining({
        in: 'query',
        name: 'variant',
        required: false,
      }))
      if (typeof contract !== 'object' || contract === null || !('errors' in contract)) {
        throw new Error('OpenAPI contract must expose an errors array')
      }
      const errors: unknown = contract.errors
      if (!Array.isArray(errors)) {
        throw new Error('OpenAPI contract errors must be an array')
      }
      expect(errors).toContainEqual({
        status: 404,
        codes: ['PURCHASE_ORDER_PRODUCT_IMAGE_NOT_FOUND'],
      })
    }

    const sourceImagePath = document.paths[
      '/api/purchase-orders/source-sales-orders/{salesOrderId}/lines/{lineId}/main-image/{productMediaId}/content'
    ]
    expect(sourceImagePath?.get?.operationId)
      .toBe('purchase_orders_get_source_sales_order_line_main_image')
    expect(sourceImagePath?.head?.operationId)
      .toBe('purchase_orders_head_source_sales_order_line_main_image')

    const previewImagePath = document.paths[
      '/api/purchase-orders/{purchaseOrderId}/lines/{lineId}/main-image/{productMediaId}/content'
    ]
    const previewGet: ContractOperation | undefined = previewImagePath?.get
    const previewHead: ContractOperation | undefined = previewImagePath?.head
    expect(previewGet?.operationId)
      .toBe('purchase_orders_get_product_preview_main_image')
    expect(previewHead?.operationId)
      .toBe('purchase_orders_head_product_preview_main_image')
    for (const operation of [previewGet, previewHead]) {
      expect(operation?.security).toEqual([{ sessionCookie: [] }])
      const contract = operation?.['x-qianshu-contract']
      expect(contract).toMatchObject({
        authorization: true,
        resourceLocator: true,
      })
      expect(contract).not.toMatchObject({ privateNoStore: true })
      expect(operation?.parameters).toContainEqual(expect.objectContaining({
        in: 'query',
        name: 'variant',
        required: false,
      }))
      if (typeof contract !== 'object' || contract === null || !('errors' in contract)) {
        throw new Error('OpenAPI contract must expose an errors array')
      }
      const errors: unknown = contract.errors
      if (!Array.isArray(errors)) {
        throw new TypeError('OpenAPI contract errors must be an array')
      }
      expect(errors).toContainEqual({
        status: 404,
        codes: ['PURCHASE_ORDER_PRODUCT_IMAGE_NOT_FOUND'],
      })
    }
  })

  it('requires explicit list view and documents CNY as the only currency', () => {
    const list = document.paths['/api/purchase-orders']?.get
    const view = list?.parameters?.find(parameter => (
      'name' in parameter && parameter.name === 'view'
    ))
    const keyword = list?.parameters?.find(parameter => (
      'name' in parameter && parameter.name === 'keyword'
    ))
    expect(view).toMatchObject({
      in: 'query', name: 'view', required: true,
      schema: { enum: ['all', 'pending'] },
    })
    expect(keyword).toMatchObject({
      description: '按采购单号、销售单号、客户名或采购唛头模糊搜索',
      in: 'query',
      name: 'keyword',
    })
    const listItemSchema = document.components?.schemas?.PurchaseOrderListItemDto
    if (listItemSchema === undefined || '$ref' in listItemSchema) {
      throw new Error('PurchaseOrderListItemDto must be an inline OpenAPI schema')
    }
    expect(listItemSchema.required).toEqual(expect.arrayContaining([
      'createdBy',
      'shippingMarkText',
    ]))
    expect(listItemSchema.properties?.createdBy).toEqual({
      $ref: '#/components/schemas/PurchaseOrderActorDto',
    })
    expect(listItemSchema.properties?.shippingMarkText).toEqual({
      nullable: true,
      type: 'string',
    })
    const response = document.paths['/api/purchase-orders/product-options']
      ?.get?.responses?.[HttpStatus.OK]
    expect(JSON.stringify(response)).toContain('PurchaseOrderProductOptionsDto')
  })
})
