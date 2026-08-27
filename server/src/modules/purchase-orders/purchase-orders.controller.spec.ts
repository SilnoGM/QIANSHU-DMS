import { HttpStatus, Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { attachRequestAuthContext } from '../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { PurchaseOrderDocumentService } from './documents/purchase-order-document.service'
import { PurchaseOrderCommandService } from './purchase-order-command.service'
import { PurchaseOrderMutationService } from './purchase-order-mutation.service'
import { PurchaseOrderQueryService } from './purchase-order-query.service'
import { PurchaseOrderSourceQueryService } from './purchase-order-source-query.service'
import { PurchaseOrdersController } from './purchase-orders.controller'

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'

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
  provide: PurchaseOrderQueryService,
  useValue: { getById: jest.fn(), list: jest.fn() },
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
}]

@Module({ controllers: [PurchaseOrdersController], providers })
class PurchaseOrdersContractModule {}

describe('PurchaseOrdersController', () => {
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
})

describe('PurchaseOrdersController OpenAPI', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(PurchaseOrdersContractModule)
  })

  it('publishes the fixed purchase API paths and stable operation ids', () => {
    expect(document.paths['/api/purchase-orders']?.get)
      .toMatchObject({ operationId: 'purchase_orders_list' })
    expect(document.paths['/api/purchase-orders']?.post)
      .toMatchObject({ operationId: 'purchase_orders_create' })
    expect(document.paths['/api/purchase-orders/product-options']?.get)
      .toMatchObject({ operationId: 'purchase_orders_product_options' })
    expect(document.paths['/api/purchase-orders/source-sales-orders']?.get)
      .toMatchObject({ operationId: 'purchase_orders_source_sales_orders' })
    expect(document.paths[
      '/api/purchase-orders/source-sales-orders/{salesOrderId}/lines'
    ]?.get).toMatchObject({ operationId: 'purchase_orders_source_sales_order_lines' })
    expect(document.paths[
      '/api/purchase-orders/{purchaseOrderId}/payments'
    ]?.post).toMatchObject({ operationId: 'purchase_orders_record_payment' })
    expect(document.paths[
      '/api/purchase-orders/{purchaseOrderId}/documents/{documentId}/content'
    ]?.head).toMatchObject({ operationId: 'purchase_orders_head_document_content' })
  })

  it('requires explicit list view and documents CNY as the only currency', () => {
    const list = document.paths['/api/purchase-orders']?.get
    const view = list?.parameters?.find(parameter => (
      'name' in parameter && parameter.name === 'view'
    ))
    expect(view).toMatchObject({
      in: 'query', name: 'view', required: true,
      schema: { enum: ['all', 'pending'] },
    })
    const response = document.paths['/api/purchase-orders/product-options']
      ?.get?.responses?.[HttpStatus.OK]
    expect(JSON.stringify(response)).toContain('PurchaseOrderProductOptionsDto')
  })
})
