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
import { PurchaseOrderWarehouseReceiptController } from './purchase-order-warehouse-receipt.controller'
import { PurchaseOrderWarehouseReceiptService } from './purchase-order-warehouse-receipt.service'

const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const partId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const origin = 'http://localhost:9000'
const path = `/api/purchase-orders/${orderId}/warehouse-receipts`
const body = { expectedVersion: 3, partIds: [partId] }
const service = { receive: jest.fn().mockResolvedValue({ id: orderId }) }

@Module({
  controllers: [PurchaseOrderWarehouseReceiptController],
  providers: [{ provide: PurchaseOrderWarehouseReceiptService, useValue: service }],
})
class WarehouseReceiptContractModule {}

describe('purchase warehouse receipt HTTP contract', () => {
  let app: INestApplication
  let authenticated = true
  let permissions: string[] = ['purchase-orders:update']

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [WarehouseReceiptContractModule] }).compile()
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

  beforeEach(() => { authenticated = true; permissions = ['purchase-orders:update']; service.receive.mockClear() })
  afterAll(async () => { await app.close() })
  const post = () => request(app.getHttpServer()).post(path).set('Origin', origin).set('X-Qianshu-CSRF', '1')

  it('requires a logged-in session and explicit purchase update permission', async () => {
    authenticated = false
    await post().send(body).expect(401)
    authenticated = true; permissions = ['purchase-orders:read']
    await post().send(body).expect(403)
    expect(service.receive).not.toHaveBeenCalled()
  })

  it('rejects missing CSRF marker and foreign origins before invoking any mutation', async () => {
    await request(app.getHttpServer()).post(path).set('Origin', origin).send(body).expect(403)
    await post().set('Origin', 'https://foreign.example').send(body).expect(403)
    expect(service.receive).not.toHaveBeenCalled()
  })

  it.each([
    { ...body, expectedVersion: 0 },
    { ...body, expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...body, partIds: [] },
    { ...body, partIds: [partId, partId] },
    { ...body, partIds: ['invalid'] },
    { ...body, receivedAt: null },
    { ...body, receivedAt: '2026-09-15T10:00:00' },
    { ...body, receivedAt: '2026-02-30T10:00:00Z' },
    { ...body, remark: '文'.repeat(501) },
    { ...body, warehouseReceivedById: actorId },
  ])('rejects malformed or client-supplied trusted fields (case %#)', async invalid => {
    await post().send(invalid).expect(422)
    expect(service.receive).not.toHaveBeenCalled()
  })

  it('returns 200 and delegates the selected parts with authenticated actor and request ID', async () => {
    const response = await post().send({ ...body, receivedAt: '2026-09-15T02:00:00.000Z', remark: '外箱完好' }).expect(200)
    expect(service.receive).toHaveBeenCalledWith({ actorUserId: actorId, requestId: expect.any(String) as unknown }, orderId, {
      ...body, receivedAt: '2026-09-15T02:00:00.000Z', remark: '外箱完好',
    })
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-request-id']).toEqual(expect.any(String))
    expect(response.body as unknown).toEqual({ id: orderId })
  })

  it('publishes the write protections, error matrix and receipt response fields in OpenAPI', async () => {
    const document = await createOpenApiDocument(WarehouseReceiptContractModule)
    expect(document.paths['/api/purchase-orders/{purchaseOrderId}/warehouse-receipts']?.post).toMatchObject({
      operationId: 'purchase_orders_warehouse_receipt', security: [{ sessionCookie: [] }],
      'x-qianshu-contract': { session: 'required', authorization: true, csrf: true, conflict: true, validation: true, privateNoStore: true,
        errors: expect.arrayContaining([{ status: 409, codes: ['PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED'] }]) as unknown },
      responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/PurchaseOrderDetailDto' } } } } },
    })
    expect(document.components?.schemas?.PurchaseOrderWarehouseReceiptRequestDto).toMatchObject({
      required: ['expectedVersion', 'partIds'], properties: {
        expectedVersion: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        partIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 1000, uniqueItems: true },
        receivedAt: { type: 'string', format: 'date-time' }, remark: { nullable: true, maxLength: 500 },
      },
    })
  })
})
