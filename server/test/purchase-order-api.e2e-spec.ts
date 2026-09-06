import { type INestApplication, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Response } from 'supertest'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { attachRequestAuthContext } from '../src/modules/auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../src/modules/auth/decorators/auth.decorators'
import { PurchaseOrderDocumentService } from '../src/modules/purchase-orders/documents/purchase-order-document.service'
import { PurchaseOrderCommandService } from '../src/modules/purchase-orders/purchase-order-command.service'
import { PurchaseOrderMutationService } from '../src/modules/purchase-orders/purchase-order-mutation.service'
import { PurchaseOrderProductImageService } from '../src/modules/purchase-orders/products/purchase-order-product-image.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderSourceQueryService } from '../src/modules/purchase-orders/purchase-order-source-query.service'
import { PurchaseOrdersController } from '../src/modules/purchase-orders/purchase-orders.controller'

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333'
const SALES_ORDER_ID = '44444444-4444-4444-8444-444444444444'
const SALES_ORDER_LINE_ID = '66666666-6666-4666-8666-666666666666'
const PRODUCT_MEDIA_ID = '77777777-7777-4777-8777-777777777777'

const list = jest.fn().mockResolvedValue({ items: [], page: 2, pageSize: 10, total: 0 })
const getById = jest.fn().mockResolvedValue({ id: ORDER_ID })
const create = jest.fn<Promise<string>, [unknown, unknown]>()
  .mockResolvedValue(ORDER_ID)
const attach = jest.fn<Promise<unknown>, [unknown, unknown, unknown]>()
  .mockResolvedValue({ id: ORDER_ID, amountRevisions: [] })
const salesOrderLines = jest.fn().mockResolvedValue({
  salesOrder: { id: SALES_ORDER_ID, orderNo: 'SO-E2E', customerName: '测试客户' },
  items: [],
})
const resolveSourceLinePreview = jest.fn().mockResolvedValue({
  status: 200,
  headers: {
    'Content-Type': 'image/png',
    'X-Content-Type-Options': 'nosniff',
  },
})

@Module({
  controllers: [PurchaseOrdersController],
  providers: [{
    provide: PurchaseOrderQueryService,
    useValue: { getById, list },
  }, {
    provide: PurchaseOrderSourceQueryService,
    useValue: {
      productOptions: jest.fn(),
      salesOrders: jest.fn(),
      salesOrderLines,
    },
  }, {
    provide: PurchaseOrderCommandService,
    useValue: { create },
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
      uploadTemporary: jest.fn(),
      attach,
      detach: jest.fn(),
      resolveContent: jest.fn(),
    },
  }, {
    provide: PurchaseOrderProductImageService,
    useValue: { resolve: jest.fn(), resolveSourceLinePreview },
  }],
})
class PurchaseOrderApiE2eModule {}

function attachTestAuth(
  requestObject: object,
  _response: object,
  next: () => void,
): void {
  attachRequestAuthContext(requestObject, {
    id: '55555555-5555-4555-8555-555555555555',
    userId: ACTOR_ID,
    username: 'purchase_api_e2e',
    displayName: '采购 API E2E',
    mustChangePassword: false,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    lastActivityAt: new Date('2026-08-27T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-08-28T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-09-27T00:00:00.000Z'),
  })
  next()
}

function responseBody(response: Response): unknown {
  return response.body as unknown
}

describe('PurchaseOrder HTTP API contract', () => {
  let application: INestApplication | undefined

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PurchaseOrderApiE2eModule],
    }).compile()
    application = moduleRef.createNestApplication()
    application.use(attachTestAuth)
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
  })

  afterAll(async () => {
    await application?.close()
    application = undefined
  })

  function requireApplication(): INestApplication {
    if (!application) throw new Error('Purchase order test app is unavailable')
    return application
  }

  it('transforms the explicit list view and pagination query', async () => {
    const response = await request(requireApplication().getHttpServer())
      .get('/api/purchase-orders?view=pending&page=2&pageSize=10')
      .expect(200)
    expect(responseBody(response)).toEqual({
      items: [], page: 2, pageSize: 10, total: 0,
    })
    expect(list).toHaveBeenLastCalledWith({
      view: 'pending', page: 2, pageSize: 10,
    })
  })

  it('rejects a missing list view and unknown create fields before services', async () => {
    const missingView = await request(requireApplication().getHttpServer())
      .get('/api/purchase-orders')
      .expect(422)
    expect(responseBody(missingView)).toMatchObject({ code: 'VALIDATION_FAILED' })

    const unknownField = await request(requireApplication().getHttpServer())
      .post('/api/purchase-orders')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ purchaseType: 'STOCK', currencyCode: 'USD' })
      .expect(422)
    expect(responseBody(unknownField)).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(create).not.toHaveBeenCalled()
  })

  it('keeps static sales-source routing independent from the order locator', async () => {
    const response = await request(requireApplication().getHttpServer())
      .get(`/api/purchase-orders/source-sales-orders/${SALES_ORDER_ID}/lines?productMode=CUSTOM`)
      .expect(200)
    expect(responseBody(response)).toMatchObject({
      salesOrder: { id: SALES_ORDER_ID }, items: [],
    })
    expect(salesOrderLines).toHaveBeenCalledWith(SALES_ORDER_ID, { productMode: 'CUSTOM' })
    expect(getById).not.toHaveBeenCalled()
  })

  it('serves sales-source preview images without entering the order locator', async () => {
    await request(requireApplication().getHttpServer())
      .get(
        `/api/purchase-orders/source-sales-orders/${SALES_ORDER_ID}/lines/${SALES_ORDER_LINE_ID}/main-image/${PRODUCT_MEDIA_ID}/content`,
      )
      .expect(200)

    expect(resolveSourceLinePreview).toHaveBeenCalledWith(
      SALES_ORDER_ID,
      SALES_ORDER_LINE_ID,
      PRODUCT_MEDIA_ID,
      undefined,
      undefined,
      'GET',
    )
    expect(getById).not.toHaveBeenCalled()
  })

  it('accepts a canonical idempotency key and returns persisted detail with 201', async () => {
    const payload = {
      purchaseType: 'STOCK',
      productMode: 'CUSTOM',
      customSupplierName: 'Records Supplier',
      orderDate: '2026-08-27',
      lines: [{
        lineType: 'CUSTOM',
        name: '临时产品',
        referencePurchaseUnitPriceAmount: '10',
        actualPurchaseUnitPriceAmount: '10.00',
        quantity: 1,
      }],
      purchaseTotalAmount: '10',
      depositDueAmount: '0',
      balanceDueAmount: '10',
    }
    const response = await request(requireApplication().getHttpServer())
      .post('/api/purchase-orders')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(payload)
      .expect(201)
    expect(responseBody(response)).toEqual({ id: ORDER_ID })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      expect.objectContaining({ purchaseType: 'STOCK' }),
    )
    expect(getById).toHaveBeenCalledWith(ORDER_ID)
  })

  it('archives standalone documents with 201 and rejects payment fields before services', async () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_METADATA, PurchaseOrdersController.prototype.attachDocument)).toEqual(['purchase-orders:document'])
    const body = { documentType: 'DELIVERY_RECEIPT', mediaAssetId: PRODUCT_MEDIA_ID, remark: '归档' }
    const response = await request(requireApplication().getHttpServer())
      .post(`/api/purchase-orders/${ORDER_ID}/documents`).send(body).expect(201)
    expect(responseBody(response)).toEqual({ id: ORDER_ID, amountRevisions: [] })
    expect(attach).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: ACTOR_ID }), ORDER_ID, body)
    attach.mockClear()
    for (const invalid of [
      { ...body, documentType: 'PAYMENT_VOUCHER' },
      { ...body, paymentId: PRODUCT_MEDIA_ID },
      { ...body, fulfillmentStatus: 'SIGNED' },
      { ...body, remark: 'x'.repeat(501) },
    ]) {
      await request(requireApplication().getHttpServer())
        .post(`/api/purchase-orders/${ORDER_ID}/documents`).send(invalid).expect(422)
    }
    expect(attach).not.toHaveBeenCalled()
  })
})
