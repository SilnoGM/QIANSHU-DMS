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
import { PurchaseOrderImageDraftController } from './purchase-order-image-draft.controller'
import { PurchaseOrderImageDraftService } from './purchase-order-image-draft.service'

const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const draftId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const origin = 'http://localhost:9000'
const path = `/api/purchase-orders/${orderId}`
const service = {
  generate: jest.fn().mockResolvedValue({ id: draftId }),
  getDraft: jest.fn().mockResolvedValue({ draft: null }),
  resolveContent: jest.fn().mockResolvedValue({ status: 200, headers: { 'Content-Type': 'image/png' } }),
}
@Module({ controllers: [PurchaseOrderImageDraftController], providers: [{ provide: PurchaseOrderImageDraftService, useValue: service }] })
class DraftContractModule {}

describe('purchase order image HTTP contract', () => {
  let app: INestApplication
  let authenticated = true
  let permissions = ['purchase-orders:review']
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [DraftContractModule] }).compile()
    app = module.createNestApplication()
    configureApplication(app, { nodeEnvironment: 'test' })
    app.use((req: object, _res: object, next: () => void) => {
      if (authenticated) attachRequestAuthContext(req, { id: actorId, userId: actorId, username: 'reviewer', displayName: '采购审核人', mustChangePassword: false, createdAt: new Date(), lastActivityAt: new Date(), idleExpiresAt: new Date(Date.now() + 60000), absoluteExpiresAt: new Date(Date.now() + 60000) })
      next()
    })
    const access = { getPermissionCodes: () => Promise.resolve(permissions), hasAll: (actual: readonly string[], required: readonly string[]) => required.every(value => actual.includes(value)) } as unknown as AccessControlService
    app.useGlobalGuards(new CsrfProtectionGuard(new ConfigService({ auth: { appOrigin: origin } })), new PermissionGuard(new Reflector(), access))
    app.useGlobalInterceptors(new PrivateNoStoreInterceptor())
    await app.init()
  })
  beforeEach(() => { authenticated = true; permissions = ['purchase-orders:review']; jest.clearAllMocks() })
  afterAll(async () => { await app.close() })
  const post = () => request(app.getHttpServer()).post(`${path}/order-image-drafts`).set('Origin', origin).set('X-Qianshu-CSRF', '1')

  it('requires authenticated review permission for metadata, generation and image delivery', async () => {
    authenticated = false
    await post().send({ expectedVersion: 2 }).expect(401)
    authenticated = true; permissions = ['purchase-orders:read']
    await post().send({ expectedVersion: 2 }).expect(403)
    await request(app.getHttpServer()).get(`${path}/order-image-draft`).expect(403)
    await request(app.getHttpServer()).get(`${path}/order-image-drafts/${draftId}/content`).expect(403)
    await request(app.getHttpServer()).head(`${path}/order-image-drafts/${draftId}/content`).expect(403)
    expect(service.generate).not.toHaveBeenCalled()
    expect(service.resolveContent).not.toHaveBeenCalled()
  })

  it('rejects CSRF and foreign origins before rendering', async () => {
    await request(app.getHttpServer()).post(`${path}/order-image-drafts`).set('Origin', origin).send({ expectedVersion: 2 }).expect(403)
    await post().set('Origin', 'https://foreign.example').send({ expectedVersion: 2 }).expect(403)
    expect(service.generate).not.toHaveBeenCalled()
  })

  it.each([{ expectedVersion: 0 }, { expectedVersion: '2' }, { expectedVersion: 2, regenerate: null }, { expectedVersion: 2, snapshot: {} }, { expectedVersion: 2, mediaAssetId: draftId }])('rejects malformed or injected generation fields: %p', async body => {
    await post().send(body).expect(422)
    expect(service.generate).not.toHaveBeenCalled()
  })

  it('passes only authenticated actor plus request ID and returns private metadata', async () => {
    const response = await post().send({ expectedVersion: 2, regenerate: true }).expect(200)
    expect(service.generate).toHaveBeenCalledWith({ actorUserId: actorId, requestId: expect.any(String) as unknown }, orderId, { expectedVersion: 2, regenerate: true })
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-request-id']).toEqual(expect.any(String))
    const metadata = await request(app.getHttpServer()).get(`${path}/order-image-draft`).expect(200)
    expect(metadata.body as unknown).toEqual({ draft: null })
    expect(metadata.headers['cache-control']).toContain('no-store')
  })

  it('advertises nullable draft metadata and protected PNG content in OpenAPI', async () => {
    const document = await createOpenApiDocument(DraftContractModule)
    expect(document.components?.schemas?.PurchaseOrderImageDraftResponseDto).toMatchObject({ properties: { draft: { nullable: true } } })
    expect(document.paths['/api/purchase-orders/{purchaseOrderId}/order-image-drafts']?.post).toMatchObject({ operationId: 'purchase_orders_generate_image_draft', 'x-qianshu-contract': { csrf: true, authorization: true, privateNoStore: true } })
    expect(document.paths['/api/purchase-orders/{purchaseOrderId}/order-image-drafts/{draftId}/content']?.get).toMatchObject({ operationId: 'purchase_orders_get_image_draft_content', responses: { 200: { content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } } } })
  })
})
