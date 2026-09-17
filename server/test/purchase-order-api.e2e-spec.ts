import { paymentRecipientBankAccounts } from './fixtures/payment-recipient.fixture'
import { randomUUID } from 'node:crypto'

import { type INestApplication, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { Response } from 'supertest'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { PrivateNoStoreInterceptor } from '../src/infrastructure/http/private-no-store.interceptor'
import { ApiException } from '../src/infrastructure/http/api.exception'
import type { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AccessControlService } from '../src/modules/access-control/access-control.service'
import { attachRequestAuthContext } from '../src/modules/auth/auth-context'
import type { AuthSessionService } from '../src/modules/auth/auth-session.service'
import { REQUIRED_PERMISSIONS_METADATA } from '../src/modules/auth/decorators/auth.decorators'
import { AuthenticationGuard } from '../src/modules/auth/guards/authentication.guard'
import { CsrfProtectionGuard } from '../src/modules/auth/guards/csrf-protection.guard'
import { PasswordChangeRequiredGuard } from '../src/modules/auth/guards/password-change-required.guard'
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard'
import { SessionCookieProvider } from '../src/modules/auth/providers/session-cookie.provider'
import type { NumberingRuleConfigResponseDto } from '../src/modules/numbering/dto/numbering-response.dto'
import { PurchaseOrderDocumentService } from '../src/modules/purchase-orders/documents/purchase-order-document.service'
import { PurchaseOrderCommandService } from '../src/modules/purchase-orders/purchase-order-command.service'
import { PurchaseOrderMutationService } from '../src/modules/purchase-orders/purchase-order-mutation.service'
import { PurchaseOrderProductImageService } from '../src/modules/purchase-orders/products/purchase-order-product-image.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderSourceQueryService } from '../src/modules/purchase-orders/purchase-order-source-query.service'
import { PurchaseOrdersController } from '../src/modules/purchase-orders/purchase-orders.controller'
import { PurchaseShippingMarkResolverService } from '../src/modules/purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import type { PurchaseOrderShippingMarkResolutionDto } from '../src/modules/purchase-shipping-marks/purchase-shipping-mark-resolution.dto'
import { PurchaseShippingMarksController } from '../src/modules/purchase-shipping-marks/purchase-shipping-marks.controller'
import { PurchaseShippingMarksService } from '../src/modules/purchase-shipping-marks/purchase-shipping-marks.service'

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333'
const SALES_ORDER_ID = '44444444-4444-4444-8444-444444444444'
const SALES_ORDER_LINE_ID = '66666666-6666-4666-8666-666666666666'
const PRODUCT_MEDIA_ID = '77777777-7777-4777-8777-777777777777'
const RESOLUTION_TOKEN = 'a'.repeat(64)
const ACTIVE_CONFIG: NumberingRuleConfigResponseDto = {
  resetPolicy: 'NEVER', timezone: 'Asia/Shanghai', maxOutputLength: 22,
  segments: [{ type: 'FIXED', value: 'CUSTOM' }, { type: 'SEQUENCE', width: 16, startValue: '9007199254740993', step: '7' }],
}

const list = jest.fn().mockResolvedValue({ items: [], page: 2, pageSize: 10, total: 0 })
const getById = jest.fn().mockResolvedValue({ id: ORDER_ID })
const create = jest.fn<Promise<string>, [unknown, unknown]>()
  .mockResolvedValue(ORDER_ID)
const review = jest.fn<Promise<unknown>, [unknown, unknown, unknown]>()
  .mockResolvedValue({ id: ORDER_ID, orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING', version: 2 })
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
const resolutionResponse: PurchaseOrderShippingMarkResolutionDto = {
  productMode: 'CUSTOM', matchSource: 'CUSTOM_RULE',
  ruleId: PRODUCT_MEDIA_ID, ruleCode: 'CUSTOM_MARK', name: '自定义采购唛头',
  activeRevision: 1, activeConfig: ACTIVE_CONFIG, availability: 'AVAILABLE',
  message: '正式提交后自动派发', resolutionToken: RESOLUTION_TOKEN,
}
const readShippingMarkResolution = jest.fn().mockResolvedValue(resolutionResponse)

@Module({
  controllers: [PurchaseOrdersController],
  providers: [{
    provide: PurchaseShippingMarkResolverService,
    useValue: { read: readShippingMarkResolution },
  }, {
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
      review,
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

@Module({
  imports: [PurchaseOrderApiE2eModule],
  controllers: [PurchaseShippingMarksController],
  providers: [{ provide: PurchaseShippingMarksService, useValue: { list: jest.fn().mockResolvedValue({ items: [] }), save: jest.fn() } }],
})
class PurchaseOrderPermissionsE2eModule {}

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
  let requestApplication: unknown
  let primaryApplication: unknown

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PurchaseOrderApiE2eModule],
    }).compile()
    application = moduleRef.createNestApplication()
    application.useGlobalInterceptors(new PrivateNoStoreInterceptor())
    application.use(attachTestAuth)
    configureApplication(application, { nodeEnvironment: 'test' })
    primaryApplication = application.getHttpAdapter().getInstance()
    application.use((incoming: { app: unknown }, _response: unknown, next: () => void) => {
      requestApplication = incoming.app
      next()
    })
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

  it('reviews using the explicit version and returns persisted detail with 200', async () => {
    review.mockClear()
    const response = await request(requireApplication().getHttpServer())
      .post(`/api/purchase-orders/${ORDER_ID}/review`)
      .send({ expectedVersion: 1, imageDraftId: PRODUCT_MEDIA_ID, reason: '核对通过' }).expect(200)
    expect(responseBody(response)).toEqual({
      id: ORDER_ID, orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING', version: 2,
    })
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-request-id']).toBeTruthy()
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: ACTOR_ID }),
      ORDER_ID, { expectedVersion: 1, imageDraftId: PRODUCT_MEDIA_ID, reason: '核对通过' })
  })

  it.each([
    {}, { expectedVersion: 0 }, { expectedVersion: 1.2 }, { expectedVersion: '1' },
    { expectedVersion: null }, { expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { expectedVersion: 1, reason: null }, { expectedVersion: 1, reason: '' },
    { expectedVersion: 1, reason: 'x'.repeat(501) },
    { expectedVersion: 1, toStatus: 'CONFIRMED' },
  ].map(body => ({ imageDraftId: PRODUCT_MEDIA_ID, ...body })))('rejects invalid review input %j before invoking the service', async body => {
    review.mockClear()
    const response = await request(requireApplication().getHttpServer())
      .post(`/api/purchase-orders/${ORDER_ID}/review`).send(body).expect(422)
    expect(responseBody(response)).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(review).not.toHaveBeenCalled()
  })

  it.each([{ expectedVersion: 1 }, { expectedVersion: 1, imageDraftId: 'not-a-uuid' }])('requires a valid generated image id before approval: %j', async body => {
    review.mockClear()
    await request(requireApplication().getHttpServer()).post(`/api/purchase-orders/${ORDER_ID}/review`).send(body).expect(422)
    expect(review).not.toHaveBeenCalled()
  })

  it('maps review state conflicts to 409 and accepts an omitted reason', async () => {
    review.mockRejectedValueOnce(new ApiException(409, 'PURCHASE_ORDER_STATE_CHANGED', '采购订单已变化'))
    const response = await request(requireApplication().getHttpServer())
      .post(`/api/purchase-orders/${ORDER_ID}/review`).send({ expectedVersion: 1, imageDraftId: PRODUCT_MEDIA_ID }).expect(409)
    expect(responseBody(response)).toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(review).toHaveBeenLastCalledWith(expect.objectContaining({ actorUserId: ACTOR_ID }), ORDER_ID, { expectedVersion: 1, imageDraftId: PRODUCT_MEDIA_ID })
  })

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

  it('resolves a creation scene over GET without a purchase locator or create call', async () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_METADATA, PurchaseOrdersController.prototype.shippingMarkResolution)).toEqual(['purchase-orders:create'])
    const callsBefore = create.mock.calls.length
    const detailCallsBefore = getById.mock.calls.length
    const response = await request(requireApplication().getHttpServer())
      .get('/api/purchase-orders/shipping-mark-resolution?productMode=CUSTOM').expect(200)
    expect(responseBody(response)).toMatchObject({ availability: 'AVAILABLE', ruleCode: 'CUSTOM_MARK', activeConfig: ACTIVE_CONFIG, resolutionToken: RESOLUTION_TOKEN })
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-request-id']).toBeTruthy()
    expect(readShippingMarkResolution).toHaveBeenLastCalledWith({ productMode: 'CUSTOM' })
    await request(requireApplication().getHttpServer())
      .get('/api/purchase-orders/shipping-mark-resolution').query({ productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' }).expect(200)
    expect(readShippingMarkResolution).toHaveBeenLastCalledWith({ productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' })
    expect(create).toHaveBeenCalledTimes(callsBefore)
    expect(getById).toHaveBeenCalledTimes(detailCallsBefore)
  })

  it('preserves an explicit null active config in unavailable HTTP responses', async () => {
    readShippingMarkResolution.mockResolvedValueOnce({ ...resolutionResponse, activeRevision: null, activeConfig: null, availability: 'NO_ACTIVE_VERSION', resolutionToken: null })
    const response = await request(requireApplication().getHttpServer())
      .get('/api/purchase-orders/shipping-mark-resolution?productMode=CUSTOM').expect(200)
    expect(responseBody(response)).toMatchObject({ availability: 'NO_ACTIVE_VERSION', activeRevision: null, activeConfig: null, resolutionToken: null })
  })

  it('rejects missing scene suppliers and arbitrary rule selectors before resolution', async () => {
    readShippingMarkResolution.mockClear()
    for (const query of [
      { productMode: 'CATALOG' },
      { productMode: 'MIXED' },
      { productMode: 'CUSTOM', supplierValue: 'SUPPLIER_A' },
      { productMode: 'CUSTOM', customSupplierName: 'Caller Supplier' },
      { productMode: 'CUSTOM', ruleCode: 'CALLER_RULE' },
      { productMode: 'CUSTOM', ruleId: PRODUCT_MEDIA_ID },
    ]) {
      const response = await request(requireApplication().getHttpServer())
        .get('/api/purchase-orders/shipping-mark-resolution').query(query).expect(422)
      expect(responseBody(response)).toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    expect(readShippingMarkResolution).not.toHaveBeenCalled()
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
      customSupplierName: 'Records Supplier', paymentAccounts: paymentRecipientBankAccounts(),
      expectedShippingMarkResolution: RESOLUTION_TOKEN,
      orderDate: '2026-08-27',
      lines: [{
        lineType: 'CUSTOM',
        name: '临时产品',
        referencePurchaseUnitPriceAmount: '10',
        actualPurchaseUnitPriceAmount: '10.00',
        quantity: 1,
      }],
      parts: [{ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] }],
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
    const callsBefore = create.mock.calls.length
    for (const invalid of [
      { ...payload, expectedShippingMarkResolution: undefined },
      { ...payload, expectedShippingMarkResolution: 'invalid' },
      { ...payload, shippingMarkText: '' },
      { ...payload, shippingMarkText: 'CALLER-001' },
    ]) {
      await request(requireApplication().getHttpServer())
        .post('/api/purchase-orders').set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send(invalid).expect(422)
    }
    expect(create).toHaveBeenCalledTimes(callsBefore)
  })

  it('accepts 1000 two-item parts over 100 KiB only on purchase creation and keeps a fixed 1 MiB boundary', async () => {
    const line = { lineType: 'CUSTOM', name: 'Item', referencePurchaseUnitPriceAmount: '1', actualPurchaseUnitPriceAmount: '1', quantity: 1000 }
    const payload = { purchaseType: 'STOCK', productMode: 'CUSTOM', customSupplierName: 'Capacity supplier', paymentAccounts: paymentRecipientBankAccounts(),
      expectedShippingMarkResolution: RESOLUTION_TOKEN, orderDate: '2026-08-27',
      lines: [line, line], parts: Array.from({ length: 1000 }, () => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }, { lineNumber: 2, quantity: 1 }] })),
      purchaseTotalAmount: '2000', depositDueAmount: '0', balanceDueAmount: '2000',
    }
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(102400)
    await request(requireApplication().getHttpServer()).post('/api/purchase-orders')
      .set('Idempotency-Key', IDEMPOTENCY_KEY).send(payload).expect(201)
    expect(requestApplication).toBe(primaryApplication)
    const oversized = await request(requireApplication().getHttpServer()).post('/api/purchase-orders')
      .set('Idempotency-Key', IDEMPOTENCY_KEY).send({ padding: 'x'.repeat(1_048_576) }).expect(413)
    expect(responseBody(oversized)).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    await request(requireApplication().getHttpServer()).post(`/api/purchase-orders/${ORDER_ID}/review`)
      // 其他端点仍由原默认 parser 拒绝，既有异常映射也保持不变。
      .send({ reason: 'x'.repeat(110_000) }).expect(500)
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

describe('PurchaseOrder shipping mark HTTP authorization with production guards', () => {
  let application: INestApplication
  let grantedPermissions: string[]
  let mustChangePassword = false
  const roleRows = jest.fn(() => Promise.resolve([{
    role: { permissions: grantedPermissions.map(code => ({ permission: { code } })) },
  }]))
  const session = jest.fn((token: string) => Promise.resolve(token === 'purchase-permission-session' ? {
    id: IDEMPOTENCY_KEY, userId: ACTOR_ID, username: 'purchase_operator', displayName: '采购权限测试',
    mustChangePassword, createdAt: new Date(), lastActivityAt: new Date(),
    idleExpiresAt: new Date(), absoluteExpiresAt: new Date(),
  } : null))
  const cookie = 'qianshu_session_dev=purchase-permission-session'
  const mutationHeaders = { Origin: 'http://127.0.0.1:9000', 'X-Qianshu-CSRF': '1', 'Sec-Fetch-Site': 'same-origin' }
  const payload = {
    purchaseType: 'SALES_LINKED', productMode: 'CUSTOM', salesOrderId: SALES_ORDER_ID,
    customSupplierName: 'Permission Supplier', paymentAccounts: paymentRecipientBankAccounts(), orderDate: '2026-08-27',
    expectedShippingMarkResolution: RESOLUTION_TOKEN,
    lines: [{ lineType: 'CUSTOM', sourceSalesOrderLineId: SALES_ORDER_LINE_ID, referencePurchaseUnitPriceAmount: '10', actualPurchaseUnitPriceAmount: '10', quantity: 1 }],
    purchaseTotalAmount: '10', depositDueAmount: '0', balanceDueAmount: '10',
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PurchaseOrderPermissionsE2eModule] }).compile()
    application = moduleRef.createNestApplication()
    const reflector = new Reflector()
    const config = new ConfigService({ app: { nodeEnv: 'test' }, auth: { appOrigin: mutationHeaders.Origin } })
    const accessControl = new AccessControlService({ userRole: { findMany: roleRows } } as unknown as PrismaService)
    // 仅替换 Session/角色持久化数据；Cookie 解析、四层 Guard、ACL 集合判断全部使用生产实现。
    application.useGlobalGuards(
      new CsrfProtectionGuard(config),
      new AuthenticationGuard(reflector, new SessionCookieProvider(config), { authenticate: session } as unknown as AuthSessionService),
      new PasswordChangeRequiredGuard(reflector),
      new PermissionGuard(reflector, accessControl),
    )
    application.useGlobalInterceptors(new PrivateNoStoreInterceptor())
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
  })

  beforeEach(() => {
    grantedPermissions = ['purchase-orders:create']
    mustChangePassword = false
    roleRows.mockClear()
    session.mockClear()
    create.mockClear()
    review.mockClear()
    readShippingMarkResolution.mockClear()
  })

  afterAll(async () => { await application?.close() })

  it('requires the independent review permission even when all other purchase capabilities are granted', async () => {
    grantedPermissions = ['purchase-orders:read', 'purchase-orders:create', 'purchase-orders:create-stock',
      'purchase-orders:update', 'purchase-orders:payment', 'purchase-orders:document']
    const response = await request(application.getHttpServer())
      .post(`/api/purchase-orders/${ORDER_ID}/review`).set(mutationHeaders).set('Cookie', cookie)
      .send({ expectedVersion: 1, imageDraftId: PRODUCT_MEDIA_ID }).expect(403)
    expect(responseBody(response)).toMatchObject({ code: 'FORBIDDEN' })
    expect(review).not.toHaveBeenCalled()
  })

  it('permits an explicitly configured reviewer and applies revocation on the next request', async () => {
    grantedPermissions = ['purchase-orders:review']
    const submit = () => request(application.getHttpServer())
      .post(`/api/purchase-orders/${ORDER_ID}/review`).set(mutationHeaders).set('Cookie', cookie)
      .send({ expectedVersion: 1, imageDraftId: PRODUCT_MEDIA_ID })
    await submit().expect(200)
    grantedPermissions = ['purchase-orders:update']
    await submit().expect(403)
    expect(review).toHaveBeenCalledTimes(1)
    expect(roleRows).toHaveBeenCalledTimes(2)
  })

  it('enforces session and CSRF before review', async () => {
    grantedPermissions = ['purchase-orders:review']
    await request(application.getHttpServer()).post(`/api/purchase-orders/${ORDER_ID}/review`)
      .set(mutationHeaders).send({ expectedVersion: 1, imageDraftId: PRODUCT_MEDIA_ID }).expect(401)
    await request(application.getHttpServer()).post(`/api/purchase-orders/${ORDER_ID}/review`)
      .set('Cookie', cookie).send({ expectedVersion: 1, imageDraftId: PRODUCT_MEDIA_ID }).expect(403)
    expect(review).not.toHaveBeenCalled()
  })

  it('allows an ordinary creation operator to resolve and reach sales-linked creation without management grants', async () => {
    const response = await request(application.getHttpServer()).get('/api/purchase-orders/shipping-mark-resolution')
      .set('Cookie', cookie).query({ productMode: 'CUSTOM' }).expect(200)
    expect(responseBody(response)).toMatchObject({ activeConfig: ACTIVE_CONFIG })
    await request(application.getHttpServer()).post('/api/purchase-orders')
      .set(mutationHeaders).set('Cookie', cookie).set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(payload).expect(201)
    expect(readShippingMarkResolution).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: ACTOR_ID }), expect.objectContaining({ purchaseType: 'SALES_LINKED' }))
    expect(roleRows).toHaveBeenCalledTimes(2)
    expect(roleRows).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: ACTOR_ID } }))
    await request(application.getHttpServer()).get('/api/purchase-shipping-mark-bindings')
      .set('Cookie', cookie).expect(403)
    await request(application.getHttpServer()).put('/api/purchase-shipping-mark-bindings/SUPPLIER_A')
      .set(mutationHeaders).set('Cookie', cookie).send({ ruleId: PRODUCT_MEDIA_ID, expectedVersion: 0 }).expect(403)
  })

  it.each([
    ['binding manager', ['purchase-shipping-marks:read', 'purchase-shipping-marks:update']],
    ['numbering manager', ['numbering-rules:read', 'numbering-rules:create', 'numbering-rules:publish']],
    ['stock grant only', ['purchase-orders:create-stock']],
    ['no grants', []],
  ])('rejects %s without purchase creation permission before either service runs', async (_label, permissions) => {
    grantedPermissions = permissions
    const resolution = await request(application.getHttpServer()).get('/api/purchase-orders/shipping-mark-resolution')
      .set('Cookie', cookie).query({ productMode: 'CUSTOM' }).expect(403)
    expect(responseBody(resolution)).toMatchObject({ code: 'FORBIDDEN' })
    const creation = await request(application.getHttpServer()).post('/api/purchase-orders')
      .set(mutationHeaders).set('Cookie', cookie).set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(payload).expect(403)
    expect(responseBody(creation)).toMatchObject({ code: 'FORBIDDEN' })
    expect(readShippingMarkResolution).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it.each([undefined, 'qianshu_session_dev=unknown-session'])('requires a valid session for cookie %s', async invalidCookie => {
    const read = request(application.getHttpServer()).get('/api/purchase-orders/shipping-mark-resolution').query({ productMode: 'CUSTOM' })
    if (invalidCookie !== undefined) read.set('Cookie', invalidCookie)
    expect(responseBody(await read.expect(401))).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
    const write = request(application.getHttpServer()).post('/api/purchase-orders')
      .set(mutationHeaders).set('Idempotency-Key', IDEMPOTENCY_KEY).send(payload)
    if (invalidCookie !== undefined) write.set('Cookie', invalidCookie)
    expect(responseBody(await write.expect(401))).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
    expect(roleRows).not.toHaveBeenCalled()
    expect(readShippingMarkResolution).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('honors live permission revocation on the next resolution request', async () => {
    const resolve = () => request(application.getHttpServer()).get('/api/purchase-orders/shipping-mark-resolution')
      .set('Cookie', cookie).query({ productMode: 'CUSTOM' })
    await resolve().expect(200)
    grantedPermissions = ['purchase-shipping-marks:read']
    await resolve().expect(403)
    expect(roleRows).toHaveBeenCalledTimes(2)
    expect(readShippingMarkResolution).toHaveBeenCalledTimes(1)
  })

  it('preserves required password changes and CSRF checks around creation', async () => {
    mustChangePassword = true
    const changeRequired = await request(application.getHttpServer()).get('/api/purchase-orders/shipping-mark-resolution')
      .set('Cookie', cookie).query({ productMode: 'CUSTOM' }).expect(403)
    expect(responseBody(changeRequired)).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
    mustChangePassword = false
    const csrf = await request(application.getHttpServer()).post('/api/purchase-orders')
      .set('Cookie', cookie).set('Idempotency-Key', IDEMPOTENCY_KEY).send(payload).expect(403)
    expect(responseBody(csrf)).toMatchObject({ code: 'CSRF_REJECTED' })
    expect(readShippingMarkResolution).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
