import { SalesReceiptService } from './receipts/sales-receipt.service'
import { Readable } from 'node:stream'

import { HttpStatus, Module, StreamableFile } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import {
  getRequestId,
  requestIdMiddleware,
} from '../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { attachRequestAuthContext } from '../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import type { ProductMediaContentResponse } from '../products/media/product-media-content.service'
import { SalesOrderCommandService } from './sales-order-command.service'
import { SalesOrderDocumentService } from './documents/sales-order-document.service'
import { SalesOrderMutationService } from './sales-order-mutation.service'
import { SalesOrderProductImageService } from './products/sales-order-product-image.service'
import { SalesOrderProductEditQueryService } from './sales-order-product-edit-query.service'
import { SalesOrderProductEditService } from './sales-order-product-edit.service'
import { SalesOrderQueryService } from './sales-order-query.service'
import { SalesOrdersController } from './sales-orders.controller'

type ContractOperation = NonNullable<OpenAPIObject['paths'][string]['get']> & {
  'x-qianshu-contract'?: unknown
}

function readOperationContract(operation: unknown): unknown {
  if (typeof operation !== 'object' || operation === null) return undefined
  return Object.prototype.hasOwnProperty.call(operation, 'x-qianshu-contract')
    ? (operation as Record<string, unknown>)['x-qianshu-contract']
    : undefined
}

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_MEDIA_ID = '22222222-2222-4222-8222-222222222222'
const SALES_ORDER_ID = '33333333-3333-4333-8333-333333333333'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'
const SESSION_ID = '55555555-5555-4555-8555-555555555555'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR_ID,
    username: 'purchase_operator',
    displayName: '采购经办人',
    mustChangePassword: false,
    createdAt: new Date('2026-09-02T01:00:00.000Z'),
    lastActivityAt: new Date('2026-09-02T01:00:00.000Z'),
    idleExpiresAt: new Date('2026-09-02T02:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-10-02T01:00:00.000Z'),
  })
  return request
}

function createController(result: ProductMediaContentResponse) {
  const issuerOptions = jest.fn().mockResolvedValue({ items: [] })
  const statusCounts = jest.fn().mockResolvedValue({ view: 'all', items: [] })
  const productOptions = jest.fn().mockResolvedValue({
    items: [], page: 1, pageSize: 20, total: 0,
  })
  const resolve = jest.fn().mockResolvedValue(result)
  const resolveListPreview = jest.fn().mockResolvedValue(result)
  const controller = new SalesOrdersController(
    { issuerOptions, productOptions, statusCounts } as unknown as SalesOrderQueryService,
    {} as SalesReceiptService,
    {} as SalesOrderCommandService,
    {} as SalesOrderMutationService,
    {} as SalesOrderDocumentService,
    { resolve, resolveListPreview } as unknown as SalesOrderProductImageService,
  )
  const response = { status: jest.fn(), setHeader: jest.fn() }
  return {
    controller,
    issuerOptions,
    productOptions,
    statusCounts,
    resolve,
    resolveListPreview,
    response,
  }
}

@Module({
  controllers: [SalesOrdersController],
  providers: [
    { provide: SalesReceiptService, useValue: {} },{
    provide: SalesOrderQueryService,
    useValue: {
      getById: jest.fn(),
      issuerOptions: jest.fn(),
      list: jest.fn(),
      productOptions: jest.fn(),
      statusCounts: jest.fn(),
    },
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
    useValue: {
      resolve: jest.fn(),
      resolveListPreview: jest.fn(),
      resolveProductEditOption: jest.fn(),
    },
  }, {
    provide: SalesOrderProductEditQueryService,
    useValue: { context: jest.fn(), productOptions: jest.fn() },
  }, {
    provide: SalesOrderProductEditService,
    useValue: { updateProducts: jest.fn() },
  }],
})
class SalesOrderProductOptionsContractModule {}

describe('SalesOrdersController product options', () => {
  it('requires all permissions for atomic create/payment writes and exposes receipt-only document write', () => {
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      SalesOrdersController.prototype.create,
    )).toEqual(['sales-orders:create', 'sales-orders:document'])
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      SalesOrdersController.prototype.recordPayment,
    )).toEqual(['sales-orders:payment', 'sales-orders:document'])
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      SalesOrdersController.prototype.submitDeliveryReceipt,
    )).toEqual(['sales-orders:document'])
    expect('attachDocument' in SalesOrdersController.prototype).toBe(false)
  })

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

  it('reads issuer options with sales-order read permission', async () => {
    const fixture = createController({
      status: HttpStatus.OK,
      headers: {
        'Accept-Ranges': 'bytes',
        ETag: '"safe"',
        'X-Content-Type-Options': 'nosniff',
      },
    })

    await expect(fixture.controller.issuerOptions()).resolves.toEqual({ items: [] })
    expect(fixture.issuerOptions).toHaveBeenCalledTimes(1)
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      SalesOrdersController.prototype.issuerOptions,
    )).toEqual(['sales-orders:read'])
  })

  it('reads status counts with sales-order read permission', async () => {
    const fixture = createController({
      status: HttpStatus.OK,
      headers: {
        'Accept-Ranges': 'bytes',
        ETag: '"safe"',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    const query = { view: 'pending' as const, currencyCode: 'TWD' as const }

    await expect(fixture.controller.statusCounts(query)).resolves.toEqual({
      view: 'all',
      items: [],
    })
    expect(fixture.statusCounts).toHaveBeenCalledWith(query, expect.any(String))
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      SalesOrdersController.prototype.statusCounts,
    )).toEqual(['sales-orders:read'])
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
    // 变体名随录单主图的查询 DTO 传入并被原样委派（取值白名单由 DTO 层校验）。
    const query = { currencyCode: 'MYR' as const, variant: 'thumb' }

    await fixture.controller.headProductOptionMainImage(
      params, query, '"known"', 'bytes=0-0', fixture.response,
    )
    const body = await fixture.controller.getProductOptionMainImage(
      params, query, undefined, undefined, fixture.response,
    )

    expect(fixture.resolve).toHaveBeenNthCalledWith(
      1, PRODUCT_ID, PRODUCT_MEDIA_ID, 'MYR', '"known"', 'bytes=0-0', 'HEAD', 'thumb',
    )
    expect(fixture.resolve).toHaveBeenNthCalledWith(
      2, PRODUCT_ID, PRODUCT_MEDIA_ID, 'MYR', undefined, undefined, 'GET', 'thumb',
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

  it('serves list preview images through an independent read-authorized route', async () => {
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
    const params = {
      salesOrderId: '33333333-3333-4333-8333-333333333333',
      lineId: '44444444-4444-4444-8444-444444444444',
      productMediaId: PRODUCT_MEDIA_ID,
    }

    await fixture.controller.headProductPreviewMainImage(
      params, undefined, '"known"', 'bytes=0-0', undefined, fixture.response,
    )
    const body = await fixture.controller.getProductPreviewMainImage(
      params, undefined, undefined, undefined, 'thumb', fixture.response,
    )

    expect(fixture.resolveListPreview).toHaveBeenNthCalledWith(
      1, params.salesOrderId, params.lineId, PRODUCT_MEDIA_ID,
      '"known"', 'bytes=0-0', 'HEAD', undefined, expect.any(String),
    )
    expect(fixture.resolveListPreview).toHaveBeenNthCalledWith(
      2, params.salesOrderId, params.lineId, PRODUCT_MEDIA_ID,
      undefined, undefined, 'GET', 'thumb', expect.any(String),
    )
    expect(body).toBeInstanceOf(StreamableFile)

    const reflector = new Reflector()
    for (const method of [
      'headProductPreviewMainImage', 'getProductPreviewMainImage',
    ] as const) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        SalesOrdersController.prototype[method],
      )).toEqual(['sales-orders:read'])
    }
  })

  it('requires sales-update for every product-edit read', async () => {
    const stream = Readable.from(Buffer.from('image'))
    const context = jest.fn().mockResolvedValue({ salesOrder: { id: 'order-id' } })
    const productOptions = jest.fn().mockResolvedValue({
      items: [], page: 1, pageSize: 20, total: 0,
    })
    const resolveProductEditOption = jest.fn().mockResolvedValue({
      status: HttpStatus.OK,
      headers: {
        'Accept-Ranges': 'bytes',
        ETag: '"safe"',
        'X-Content-Type-Options': 'nosniff',
      },
      stream,
    })
    const controller = new SalesOrdersController(
      {} as SalesOrderQueryService,
      {} as SalesReceiptService,
    {} as SalesOrderCommandService,
      {} as SalesOrderMutationService,
      {} as SalesOrderDocumentService,
      { resolveProductEditOption } as unknown as SalesOrderProductImageService,
      { context, productOptions } as unknown as SalesOrderProductEditQueryService,
    )
    const params = {
      salesOrderId: '33333333-3333-4333-8333-333333333333',
      productId: PRODUCT_ID,
      productMediaId: PRODUCT_MEDIA_ID,
    }
    const query = { keyword: '目录', supplierValue: 'SUPPLIER_TW_01' }
    const response = { status: jest.fn(), setHeader: jest.fn() }

    await expect(controller.productEditContext(params)).resolves.toMatchObject({
      salesOrder: { id: 'order-id' },
    })
    await expect(controller.productEditOptions(params, query)).resolves.toMatchObject({
      items: [],
    })
    await controller.headProductEditOptionMainImage(
      params, undefined, '"known"', 'bytes=0-0', undefined, response,
    )
    const body = await controller.getProductEditOptionMainImage(
      params, undefined, undefined, undefined, 'thumb', response,
    )
    expect(context).toHaveBeenCalledWith(params.salesOrderId, expect.any(String))
    expect(productOptions).toHaveBeenCalledWith(params.salesOrderId, query, expect.any(String))
    expect(resolveProductEditOption).toHaveBeenCalledTimes(2)
    expect(body).toBeInstanceOf(StreamableFile)

    const reflector = new Reflector()
    for (const method of [
      'productEditContext',
      'productEditOptions',
      'headProductEditOptionMainImage',
      'getProductEditOptionMainImage',
    ] as const) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        SalesOrdersController.prototype[method],
      )).toEqual(['sales-orders:update'])
    }
  })

  it('requires sales-update and forwards only trusted context for product writes', async () => {
    const request = createRequest()
    const requestId = getRequestId(request)
    const dto = {
      expectedVersion: 4,
      reason: '客户调整产品',
      confirmDepositReduction: false,
      existingLines: [{
        lineId: PRODUCT_ID,
        name: '销售产品快照',
        description: null,
        actualUnitPriceAmount: '120.00',
        desiredQuantity: 2,
      }],
      newLines: [],
    }
    const result = {
      salesOrderId: SALES_ORDER_ID,
      previousVersion: 4,
      version: 5,
      addedLineIds: ['66666666-6666-4666-8666-666666666666'],
      updatedLineIds: [],
      removedLineIds: [],
      amountDelta: '30.00',
      paymentStatus: 'PARTIALLY_PAID' as const,
      fulfillmentStatus: 'PENDING' as const,
      depositReduced: false,
      amounts: {
        lineSubtotalAmount: '330.00',
        agreedTotalAmount: '330.00',
        depositDueAmount: '100.00',
        balanceDueAmount: '230.00',
        paidAmount: '300.00',
        outstandingAmount: '30.00',
      },
    }
    const updateProducts = jest.fn().mockResolvedValue(result)
    const controller = new SalesOrdersController(
      {} as SalesOrderQueryService,
      {} as SalesReceiptService,
    {} as SalesOrderCommandService,
      {} as SalesOrderMutationService,
      {} as SalesOrderDocumentService,
      {} as SalesOrderProductImageService,
      {} as SalesOrderProductEditQueryService,
      { updateProducts } as unknown as SalesOrderProductEditService,
    )

    await expect(controller.updateProducts(
      { salesOrderId: SALES_ORDER_ID }, dto, request,
    )).resolves.toEqual(result)
    expect(updateProducts).toHaveBeenCalledWith(
      { actorUserId: ACTOR_ID, requestId },
      SALES_ORDER_ID,
      dto,
    )

    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      SalesOrdersController.prototype.updateProducts,
    )).toEqual(['sales-orders:update'])
  })
})

describe('SalesOrdersController product options OpenAPI', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(SalesOrderProductOptionsContractModule)
  })

  it('publishes paged selector query and independent protected main image operations', () => {
    const list = document.paths['/api/sales-orders']?.get
    expect(list?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: 'query', name: 'issuerUserId' }),
    ]))
    expect(document.paths['/api/sales-orders/issuer-options']?.get)
      .toMatchObject({ operationId: 'sales_orders_issuer_options' })
    const statusCounts: ContractOperation | undefined = document.paths[
      '/api/sales-orders/status-counts'
    ]?.get
    expect(statusCounts).toMatchObject({ operationId: 'sales_orders_status_counts' })
    expect(statusCounts?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: 'query', name: 'view', required: true }),
      expect.objectContaining({ in: 'query', name: 'currencyCode' }),
      expect.objectContaining({ in: 'query', name: 'issuerUserId' }),
    ]))
    expect(statusCounts?.['x-qianshu-contract']).toMatchObject({
      authorization: true,
      privateNoStore: true,
      validation: true,
    })

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
        codes: ['SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND'],
      })
    }
  })

  it('publishes product-edit context, options and protected image routes', () => {
    const context = document.paths[
      '/api/sales-orders/{salesOrderId}/product-edit-context'
    ]?.get
    expect(context).toMatchObject({ operationId: 'sales_orders_get_product_edit_context' })

    const options = document.paths[
      '/api/sales-orders/{salesOrderId}/product-edit-options'
    ]?.get
    expect(options).toMatchObject({
      operationId: 'sales_orders_get_product_edit_options',
    })
    expect(options?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        in: 'query',
        name: 'supplierValue',
        required: true,
      }),
    ]))

    const imagePath = document.paths[
      '/api/sales-orders/{salesOrderId}/product-edit-options/{productId}/main-image/{productMediaId}/content'
    ]
    expect(imagePath?.head?.operationId)
      .toBe('sales_orders_head_product_edit_option_main_image')
    expect(imagePath?.get?.operationId)
      .toBe('sales_orders_get_product_edit_option_main_image')
    for (const operation of [context, options] as readonly (ContractOperation | undefined)[]) {
      expect(operation?.security).toEqual([{ sessionCookie: [] }])
      expect(operation?.['x-qianshu-contract']).toMatchObject({
        authorization: true,
        privateNoStore: true,
      })
    }
    // 主图内容路由不设置 privateNoStore：缓存策略由响应头里的 Cache-Control 枚举如实声明。
    for (const operation of [
      imagePath?.head,
      imagePath?.get,
    ] as readonly (ContractOperation | undefined)[]) {
      expect(operation?.security).toEqual([{ sessionCookie: [] }])
      expect(operation?.['x-qianshu-contract']).toMatchObject({
        authorization: true,
      })
      expect(operation?.['x-qianshu-contract']).not.toMatchObject({ privateNoStore: true })
      expect(operation?.parameters).toContainEqual(expect.objectContaining({
        in: 'query',
        name: 'variant',
        required: false,
      }))
    }
  })

  it('publishes the non-retrying product-edit mutation security and stable errors', () => {
    const operation: ContractOperation | undefined = document.paths[
      '/api/sales-orders/{salesOrderId}/products'
    ]?.patch

    expect(operation).toMatchObject({ operationId: 'sales_orders_update_products' })
    expect(operation?.security).toEqual([{ sessionCookie: [] }])
    expect(operation?.responses).toHaveProperty('200')
    expect(operation?.requestBody).toBeDefined()
    expect(operation?.['x-qianshu-contract']).toMatchObject({
      authorization: true,
      csrf: true,
      conflict: true,
      privateNoStore: true,
      resourceLocator: true,
      validation: true,
      retry: false,
    })
    const contract = JSON.stringify(operation?.['x-qianshu-contract'])
    for (const code of [
      'CSRF_REJECTED',
      'SALES_ORDER_NOT_FOUND',
      'SALES_ORDER_PRODUCT_EDIT_VERSION_CONFLICT',
      'SALES_ORDER_PRODUCT_EDIT_STATE_CHANGED',
      'SALES_ORDER_PRODUCT_EDIT_NOT_ALLOWED',
      'SALES_ORDER_PRODUCT_DECREASE_PURCHASE_LOCKED',
      'SALES_ORDER_DEPOSIT_REDUCTION_CONFIRMATION_REQUIRED',
      'SALES_ORDER_TOTAL_BELOW_RECEIVED',
      'SALES_ORDER_LINE_LIMIT_EXCEEDED',
      'VALIDATION_FAILED',
    ]) {
      expect(contract).toContain(code)
    }
  })

  it('publishes the dedicated receipt operation and removes general document writes', () => {
    expect(document.paths['/api/sales-orders/{salesOrderId}/delivery-receipts']?.post)
      .toMatchObject({ operationId: 'sales_orders_submit_delivery_receipt' })
    expect(document.paths['/api/sales-orders/{salesOrderId}/documents']?.post)
      .toBeUndefined()
  })

  it('publishes only the confirmed six fulfillment states', () => {
    const contract = JSON.stringify(document)
    for (const status of [
      'PENDING',
      'PREPARING',
      'LAND_TRANSIT',
      'WAREHOUSE_ARRIVED',
      'SEA_TRANSIT',
      'SIGNED',
    ]) {
      expect(contract).toContain(`"${status}"`)
    }
    expect(contract).not.toContain('"SHIPPED"')
  })

  it('publishes five persisted order states and reconciliation transition errors', () => {
    const contract = JSON.stringify(document)
    for (const status of [
      'DRAFT',
      'CONFIRMED',
      'PENDING_RECONCILIATION',
      'COMPLETED',
      'CANCELLED',
    ]) {
      expect(contract).toContain(`"${status}"`)
    }

    const operation = document.paths[
      '/api/sales-orders/{salesOrderId}/order-status'
    ]?.patch
    const operationContract = JSON.stringify(readOperationContract(operation))
    expect(operationContract).toContain('SALES_ORDER_COMPLETION_IS_AUTOMATIC')
    expect(operationContract).toContain('SALES_ORDER_RECONCILIATION_CONDITIONS_NOT_MET')

    for (const mutationContract of [
      readOperationContract(document.paths[
        '/api/sales-orders/{salesOrderId}/fulfillment-status'
      ]?.patch),
      readOperationContract(document.paths[
        '/api/sales-orders/{salesOrderId}/payments'
      ]?.post),
      readOperationContract(document.paths[
        '/api/sales-orders/{salesOrderId}/payments/{paymentId}/void'
      ]?.post),
    ]) {
      expect(JSON.stringify(mutationContract)).toContain('SALES_ORDER_COMPLETED')
    }
  })

  it('publishes independent read-authorized list preview image operations', () => {
    const imagePath = document.paths[
      '/api/sales-orders/{salesOrderId}/lines/{lineId}/main-image/{productMediaId}/content'
    ]
    const get: ContractOperation | undefined = imagePath?.get
    const head: ContractOperation | undefined = imagePath?.head

    expect(get?.operationId).toBe('sales_orders_get_product_preview_main_image')
    expect(head?.operationId).toBe('sales_orders_head_product_preview_main_image')
    for (const operation of [get, head]) {
      expect(operation?.security).toEqual([{ sessionCookie: [] }])
      expect(operation?.['x-qianshu-contract']).toMatchObject({
        authorization: true,
        resourceLocator: true,
      })
      expect(operation?.['x-qianshu-contract']).not.toMatchObject({ privateNoStore: true })
      expect(operation?.parameters).toContainEqual(expect.objectContaining({
        in: 'query',
        name: 'variant',
        required: false,
      }))
    }
  })
})
