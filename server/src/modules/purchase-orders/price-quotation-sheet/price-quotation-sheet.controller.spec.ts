import { Module, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../../../app.setup'
import { PrivateNoStoreInterceptor } from '../../../infrastructure/http/private-no-store.interceptor'
import type { AccessControlService } from '../../access-control/access-control.service'
import { attachRequestAuthContext } from '../../auth/auth-context'
import { CsrfProtectionGuard } from '../../auth/guards/csrf-protection.guard'
import { PermissionGuard } from '../../auth/guards/permission.guard'
import { PriceQuotationSheetController } from './price-quotation-sheet.controller'
import { PriceQuotationSheetService } from './price-quotation-sheet.service'

const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const productId = '11111111-1111-4111-8111-111111111111'
const origin = 'http://localhost:9000'
const path = '/api/purchase-orders/price-quotation-sheet'
const service = {
  generate: jest.fn().mockResolvedValue({
    buffer: Buffer.from('png'),
    filename: 'price-quotation-sheet-20261122.png',
  }),
}

@Module({
  controllers: [PriceQuotationSheetController],
  providers: [{ provide: PriceQuotationSheetService, useValue: service }],
})
class PriceQuotationSheetContractModule {}

function line(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lineType: 'CATALOG',
    productId,
    expectedReferencePurchaseUnitPriceAmount: '9300',
    actualPurchaseUnitPriceAmount: '9300',
    quantity: 2,
    description: '请附带说明书',
    ...overrides,
  }
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productMode: 'CATALOG',
    supplierValue: 'SUPPLIER-A',
    orderDate: '2026-11-21',
    lines: [line()],
    ...overrides,
  }
}

describe('price quotation sheet HTTP contract', () => {
  let app: INestApplication
  let authenticated = true
  let permissions = ['purchase-orders:create']

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PriceQuotationSheetContractModule] }).compile()
    app = module.createNestApplication()
    configureApplication(app, { nodeEnvironment: 'test' })
    app.use((req: object, _res: object, next: () => void) => {
      if (authenticated) {
        attachRequestAuthContext(req, {
          id: actorId,
          userId: actorId,
          username: 'buyer',
          displayName: '采购员',
          mustChangePassword: false,
          createdAt: new Date(),
          lastActivityAt: new Date(),
          idleExpiresAt: new Date(Date.now() + 60_000),
          absoluteExpiresAt: new Date(Date.now() + 60_000),
        })
      }
      next()
    })
    const access = {
      getPermissionCodes: () => Promise.resolve(permissions),
      hasAll: (actual: readonly string[], required: readonly string[]) => required.every(value => actual.includes(value)),
    } as unknown as AccessControlService
    app.useGlobalGuards(
      new CsrfProtectionGuard(new ConfigService({ auth: { appOrigin: origin } })),
      new PermissionGuard(new Reflector(), access),
    )
    app.useGlobalInterceptors(new PrivateNoStoreInterceptor(new Reflector()))
    await app.init()
  })

  beforeEach(() => {
    authenticated = true
    permissions = ['purchase-orders:create']
    jest.clearAllMocks()
  })

  afterAll(async () => { await app.close() })

  const post = () => request(app.getHttpServer()).post(path).set('Origin', origin).set('X-Qianshu-CSRF', '1')

  it('requires authentication, create permission and CSRF before rendering', async () => {
    authenticated = false
    await post().send(validBody()).expect(401)
    authenticated = true
    permissions = ['purchase-orders:read']
    await post().send(validBody()).expect(403)
    await request(app.getHttpServer()).post(path).set('Origin', origin).send(validBody()).expect(403)
    await post().set('Origin', 'https://foreign.example').send(validBody()).expect(403)
    expect(service.generate).not.toHaveBeenCalled()
  })

  it.each([
    { body: validBody({ productMode: 'MIXED' }) },
    { body: validBody({ supplierValue: undefined }) },
    { body: validBody({ lines: [] }) },
    { body: validBody({ lines: Array.from({ length: 101 }, () => line()) }) },
    { body: validBody({ lines: [line({ quantity: 0 })] }) },
    { body: validBody({ lines: [line({ actualPurchaseUnitPriceAmount: '1.234' })] }) },
    { body: validBody({ lines: [line({ description: '备'.repeat(81) })] }) },
    { body: validBody({ mediaAssetId: productId }) },
  ])('rejects malformed, injected or out-of-range fields: %#', async ({ body }) => {
    await post().send(body).expect(422)
    expect(service.generate).not.toHaveBeenCalled()
  })

  it('returns the generated PNG with private no-store headers', async () => {
    const response = await post().send(validBody()).expect(200)
    expect(service.generate).toHaveBeenCalledWith(expect.objectContaining({
      productMode: 'CATALOG',
      supplierValue: 'SUPPLIER-A',
      orderDate: '2026-11-21',
      lines: [expect.objectContaining({ productId, quantity: 2 })],
    }))
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.headers['content-disposition']).toContain('price-quotation-sheet-20261122.png')
    expect(response.headers['content-length']).toBe('3')
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.body).toEqual(Buffer.from('png'))
  })
})
