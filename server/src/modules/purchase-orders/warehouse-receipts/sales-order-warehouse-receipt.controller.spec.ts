import { Module, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../../../app.setup'
import { PrivateNoStoreInterceptor } from '../../../infrastructure/http/private-no-store.interceptor'
import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import type { AccessControlService } from '../../access-control/access-control.service'
import { attachRequestAuthContext } from '../../auth/auth-context'
import { CsrfProtectionGuard } from '../../auth/guards/csrf-protection.guard'
import { PermissionGuard } from '../../auth/guards/permission.guard'
import { SalesOrderWarehouseReceiptController } from './sales-order-warehouse-receipt.controller'
import { SalesOrderWarehouseReceiptQueryService } from './sales-order-warehouse-receipt-query.service'
import { SalesOrderWarehouseReceiptService } from './sales-order-warehouse-receipt.service'

const salesOrderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const firstOrderId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const secondOrderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const firstPartId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const secondPartId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const actorId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const origin = 'http://localhost:9000'
const contextPath = `/api/sales-orders/${salesOrderId}/warehouse-receipt-context`
const receiptPath = `/api/sales-orders/${salesOrderId}/warehouse-receipts`
const body = {
  targets: [{ purchaseOrderId: firstOrderId, expectedVersion: 3, partIds: [firstPartId] }],
}
const queryService = {
  getContext: jest.fn().mockResolvedValue({ salesOrder: { id: salesOrderId }, purchaseOrders: [], pendingReceiptPartCount: 0 }),
}
const receiptService = {
  receive: jest.fn().mockResolvedValue({ receivedPartCount: 1, purchaseOrders: [] }),
}

@Module({
  controllers: [SalesOrderWarehouseReceiptController],
  providers: [
    { provide: SalesOrderWarehouseReceiptQueryService, useValue: queryService },
    { provide: SalesOrderWarehouseReceiptService, useValue: receiptService },
  ],
})
class SalesOrderWarehouseReceiptContractModule {}

describe('sales order warehouse receipt HTTP contract', () => {
  let app: INestApplication
  let authenticated = true
  let permissions: string[] = ['sales-orders:read', 'purchase-orders:read', 'sales-orders:update', 'purchase-orders:update']

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [SalesOrderWarehouseReceiptContractModule] }).compile()
    app = module.createNestApplication()
    configureApplication(app, { nodeEnvironment: 'test' })
    app.use((req: object, _res: object, next: () => void) => {
      if (authenticated) attachRequestAuthContext(req, {
        id: actorId, userId: actorId, username: 'receiver', displayName: '仓库确认人', mustChangePassword: false,
        createdAt: new Date(), lastActivityAt: new Date(), idleExpiresAt: new Date(Date.now() + 60000), absoluteExpiresAt: new Date(Date.now() + 60000),
      })
      next()
    })
    const access = {
      getPermissionCodes: () => Promise.resolve(permissions),
      hasAll: (actual: readonly string[], required: readonly string[]) => required.every(value => actual.includes(value)),
    } as unknown as AccessControlService
    app.useGlobalGuards(new CsrfProtectionGuard(new ConfigService({ auth: { appOrigin: origin } })), new PermissionGuard(new Reflector(), access))
    app.useGlobalInterceptors(new PrivateNoStoreInterceptor(new Reflector()))
    await app.init()
  })

  beforeEach(() => {
    authenticated = true
    permissions = ['sales-orders:read', 'purchase-orders:read', 'sales-orders:update', 'purchase-orders:update']
    queryService.getContext.mockClear()
    receiptService.receive.mockClear()
  })
  afterAll(async () => { await app.close() })
  const getContext = () => request(app.getHttpServer()).get(contextPath).set('Origin', origin)
  const postReceipt = () => request(app.getHttpServer()).post(receiptPath).set('Origin', origin).set('X-Qianshu-CSRF', '1')

  it('requires a session and both sales and purchase read permissions for the context', async () => {
    authenticated = false
    await getContext().expect(401)
    authenticated = true
    permissions = ['sales-orders:read']
    await getContext().expect(403)
    expect(queryService.getContext).not.toHaveBeenCalled()
  })

  it('requires both sales and purchase update permissions for the receipt', async () => {
    permissions = ['sales-orders:update']
    await postReceipt().send(body).expect(403)
    permissions = ['purchase-orders:update']
    await postReceipt().send(body).expect(403)
    expect(receiptService.receive).not.toHaveBeenCalled()
  })

  it('rejects missing CSRF marker and foreign origins before invoking any mutation', async () => {
    await request(app.getHttpServer()).post(receiptPath).set('Origin', origin).send(body).expect(403)
    await postReceipt().set('Origin', 'https://foreign.example').send(body).expect(403)
    expect(receiptService.receive).not.toHaveBeenCalled()
  })

  it.each([
    { targets: [] },
    { targets: [{ ...body.targets[0], expectedVersion: 0 }] },
    { targets: [{ ...body.targets[0], partIds: [] }] },
    { targets: [{ ...body.targets[0], partIds: ['invalid'] }] },
    { targets: [{ ...body.targets[0], unexpected: true }] },
    { ...body, receivedAt: null },
    { ...body, receivedAt: '2026-09-15T10:00:00' },
    { ...body, receivedAt: '2026-02-30T10:00:00Z' },
    { ...body, remark: '文'.repeat(501) },
    { ...body, actorUserId: actorId },
  ])('rejects malformed or client-supplied trusted fields (case %#)', async invalid => {
    await postReceipt().send(invalid).expect(422)
    expect(receiptService.receive).not.toHaveBeenCalled()
  })

  it('returns the context with authenticated actor and no-store headers', async () => {
    const response = await getContext().expect(200)
    expect(queryService.getContext).toHaveBeenCalledWith(salesOrderId, actorId)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-request-id']).toEqual(expect.any(String))
    expect(response.body).toMatchObject({ pendingReceiptPartCount: 0 })
  })

  it('delegates selected purchase orders and parts with authenticated actor and request ID', async () => {
    const payload = {
      targets: [
        { purchaseOrderId: firstOrderId, expectedVersion: 3, partIds: [firstPartId] },
        { purchaseOrderId: secondOrderId, expectedVersion: 2, partIds: [secondPartId] },
      ],
      receivedAt: '2026-09-15T02:00:00.000Z',
      remark: '外箱完好',
    }
    const response = await postReceipt().send(payload).expect(200)
    expect(receiptService.receive).toHaveBeenCalledWith(
      { actorUserId: actorId, requestId: expect.any(String) as unknown },
      salesOrderId,
      payload,
    )
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.body as unknown).toEqual({ receivedPartCount: 1, purchaseOrders: [] })
  })

  it('publishes both operations, error matrices and response schemas in OpenAPI', async () => {
    const document = await createOpenApiDocument(SalesOrderWarehouseReceiptContractModule)
    expect(document.paths['/api/sales-orders/{salesOrderId}/warehouse-receipt-context']?.get).toMatchObject({
      operationId: 'sales_orders_warehouse_receipt_context', security: [{ sessionCookie: [] }],
      'x-qianshu-contract': { session: 'required', authorization: true, validation: true, privateNoStore: true,
        errors: expect.arrayContaining([
          { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
          { status: 422, codes: expect.arrayContaining(['SALES_WAREHOUSE_RECEIPT_NOT_ALLOWED']) as unknown },
        ]) as unknown },
      responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/SalesOrderWarehouseReceiptContextDto' } } } } },
    })
    expect(document.paths['/api/sales-orders/{salesOrderId}/warehouse-receipts']?.post).toMatchObject({
      operationId: 'sales_orders_warehouse_receipt', security: [{ sessionCookie: [] }],
      'x-qianshu-contract': { session: 'required', authorization: true, csrf: true, conflict: true, validation: true, privateNoStore: true,
        errors: expect.arrayContaining([
          { status: 409, codes: ['SALES_WAREHOUSE_RECEIPT_STATE_CHANGED'] },
          { status: 422, codes: expect.arrayContaining(['SALES_WAREHOUSE_RECEIPT_TARGET_INVALID']) as unknown },
        ]) as unknown },
      responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/SalesOrderWarehouseReceiptResultDto' } } } } },
    })
    expect(document.components?.schemas?.SalesOrderWarehouseReceiptRequestDto).toMatchObject({
      required: ['targets'], properties: {
        targets: { type: 'array', minItems: 1, maxItems: 100 },
        receivedAt: { type: 'string', format: 'date-time' },
        remark: { nullable: true, maxLength: 500 },
      },
    })
    expect(document.components?.schemas?.SalesOrderWarehouseReceiptContextDto).toMatchObject({
      required: ['salesOrder', 'purchaseOrders', 'pendingReceiptPartCount'],
    })
  })
})
