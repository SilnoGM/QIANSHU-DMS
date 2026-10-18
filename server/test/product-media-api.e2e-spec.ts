import type { Readable } from 'node:stream'

import type { INestApplication } from '@nestjs/common'
import { HttpStatus, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { PrivateNoStoreInterceptor } from '../src/infrastructure/http/private-no-store.interceptor'
import { AccessControlService } from '../src/modules/access-control/access-control.service'
import { AuthSessionService } from '../src/modules/auth/auth-session.service'
import { AuthenticationGuard } from '../src/modules/auth/guards/authentication.guard'
import { CsrfProtectionGuard } from '../src/modules/auth/guards/csrf-protection.guard'
import { PasswordChangeRequiredGuard } from '../src/modules/auth/guards/password-change-required.guard'
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard'
import { SessionCookieProvider } from '../src/modules/auth/providers/session-cookie.provider'
import { ProductMediaContentService } from '../src/modules/products/media/product-media-content.service'
import { ProductMediaHttpService } from '../src/modules/products/media/product-media-http.service'
import { ProductMediaMultipartParser } from '../src/modules/products/media/product-media-multipart.parser'
import { ProductMediaService } from '../src/modules/products/media/product-media.service'
import { ProductCommandService } from '../src/modules/products/product-command.service'
import { ProductQueryService } from '../src/modules/products/product-query.service'
import { ProductUpdateService } from '../src/modules/products/product-update.service'
import { ProductsController } from '../src/modules/products/products.controller'

const APP_ORIGIN = 'https://dms.example.com'
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const MEDIA_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'

function productFixture() {
  const media = {
    id: MEDIA_ID,
    kind: 'IMAGE' as const,
    originalFilename: 'front.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: '3',
    width: 1,
    height: 1,
    durationMs: null,
    sortOrder: 0,
    isPrimary: false,
    contentUrl: `/api/products/${PRODUCT_ID}/media/${MEDIA_ID}/content`,
    createdAt: '2026-08-14T00:00:00.000Z',
  }
  return {
    id: PRODUCT_ID,
    name: '媒体 API 产品',
    categoryName: null,
    productHeadName: null,
    productNo: 'P-MEDIA-API',
    status: 'DRAFT' as const,
    media: { mainImage: null, images: [media], videos: [] },
    twdSalePrice: { amount: null, currency: 'TWD' },
    myrSalePrice: { amount: null, currency: 'MYR' },
    purchaseCost: { amount: null, currency: 'CNY' },
    attributes: [],
    createdBy: null,
    updatedBy: null,
    version: 2,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  }
}

describe('Product media mutation API security and parsing', () => {
  let application: INestApplication
  let permissions: string[]
  let mustChangePassword: boolean
  let uploadCommitted: boolean
  let upload: jest.Mock
  let updateLayout: jest.Mock
  let detach: jest.Mock

  beforeAll(async () => {
    permissions = ['products:update']
    mustChangePassword = false
    uploadCommitted = false
    const product = productFixture()

    upload = jest.fn(async (
      _context: unknown,
      _productId: unknown,
      input: { readonly stream: Readable },
    ) => {
      for await (const chunk of input.stream) void chunk
      uploadCommitted = true
      return {
        affectedProductMediaId: MEDIA_ID,
        changed: true,
        items: [],
        productId: PRODUCT_ID,
        version: 2,
      }
    })
    updateLayout = jest.fn().mockResolvedValue({
      affectedProductMediaId: null,
      changed: false,
      items: [],
      productId: PRODUCT_ID,
      version: 2,
    })
    detach = jest.fn().mockResolvedValue({
      affectedProductMediaId: MEDIA_ID,
      changed: true,
      items: [],
      productId: PRODUCT_ID,
      version: 2,
    })

    @Module({
      controllers: [ProductsController],
      providers: [{
        provide: ConfigService,
        useValue: {
          getOrThrow: (key: string) => {
            if (key === 'auth.appOrigin') return APP_ORIGIN
            throw new Error('Unexpected test configuration key')
          },
        },
      }, {
        provide: SessionCookieProvider,
        useValue: {
          readValue: (cookie: unknown) =>
            cookie === 'qs_session=valid' ? 'valid-session-token' : null,
        },
      }, {
        provide: AuthSessionService,
        useValue: {
          authenticate: () => Promise.resolve({
            id: '44444444-4444-4444-8444-444444444444',
            userId: ACTOR_ID,
            username: 'media_operator',
            displayName: '媒体管理员',
            mustChangePassword,
            createdAt: new Date('2026-08-14T00:00:00.000Z'),
            lastActivityAt: new Date('2026-08-14T00:00:00.000Z'),
            idleExpiresAt: new Date('2026-08-15T00:00:00.000Z'),
            absoluteExpiresAt: new Date('2026-09-14T00:00:00.000Z'),
          }),
        },
      }, {
        provide: AccessControlService,
        useValue: {
          getPermissionCodes: () => Promise.resolve([...permissions]),
          hasAll: (granted: readonly string[], required: readonly string[]) =>
            required.every(code => granted.includes(code)),
        },
      }, {
        provide: ProductQueryService,
        useValue: { list: jest.fn(), getById: jest.fn().mockResolvedValue(product) },
      }, {
        provide: ProductCommandService,
        useValue: { create: jest.fn() },
      }, {
        provide: ProductUpdateService,
        useValue: { update: jest.fn() },
      }, {
        provide: ProductMediaService,
        useValue: { upload, updateLayout, detach },
      }, {
        provide: ProductMediaContentService,
        useValue: { resolve: jest.fn() },
      }, {
        provide: ProductMediaMultipartParser,
        useFactory: () => new ProductMediaMultipartParser({ maximumFileBytes: 3 }),
      }, ProductMediaHttpService, {
        provide: APP_GUARD,
        useClass: CsrfProtectionGuard,
      }, {
        provide: APP_GUARD,
        useClass: AuthenticationGuard,
      }, {
        provide: APP_GUARD,
        useClass: PasswordChangeRequiredGuard,
      }, {
        provide: APP_GUARD,
        useClass: PermissionGuard,
      }, {
        provide: APP_INTERCEPTOR,
        useClass: PrivateNoStoreInterceptor,
      }],
    })
    class ProductMediaApiTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [ProductMediaApiTestModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
  })

  afterAll(async () => {
    await application.close()
  })

  beforeEach(() => {
    permissions = ['products:update']
    mustChangePassword = false
    uploadCommitted = false
    jest.clearAllMocks()
  })

  function uploadRequest() {
    return request(application.getHttpServer())
      .post(`/api/products/${PRODUCT_ID}/media`)
      .set('Cookie', 'qs_session=valid')
      .set('Origin', APP_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('X-Qianshu-CSRF', '1')
  }

  it('accepts one authorized streamed upload and returns private no-store data', async () => {
    const response = await uploadRequest()
      .field('kind', 'IMAGE')
      .field('expectedVersion', '1')
      .attach('file', Buffer.from('img'), {
        filename: 'front.jpg',
        contentType: 'image/jpeg',
      })
      .expect(HttpStatus.CREATED)

    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.body).toMatchObject({
      product: { id: PRODUCT_ID, version: 2 },
      media: { id: MEDIA_ID, kind: 'IMAGE' },
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /objectKey|checksum|storageDriver|mediaAssetId/u,
    )
    expect(uploadCommitted).toBe(true)
  })

  it.each([
    ['anonymous', 401, () => permissions, false, false],
    ['missing permission', 403, () => [], false, true],
    ['password change required', 403, () => permissions, true, true],
  ] as const)('rejects %s before domain mutation', async (
    _case,
    status,
    permissionFactory,
    passwordRequired,
    includeCookie,
  ) => {
    permissions = [...permissionFactory()]
    mustChangePassword = passwordRequired
    let operation = uploadRequest()
    if (!includeCookie) {
      operation = request(application.getHttpServer())
        .post(`/api/products/${PRODUCT_ID}/media`)
        .set('Origin', APP_ORIGIN)
        .set('Sec-Fetch-Site', 'same-origin')
        .set('X-Qianshu-CSRF', '1')
    }
    await operation
      .field('kind', 'IMAGE')
      .field('expectedVersion', '1')
      .attach('file', Buffer.from('img'), 'front.jpg')
      .expect(status)
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects missing CSRF before domain mutation', async () => {
    await request(application.getHttpServer())
      .post(`/api/products/${PRODUCT_ID}/media`)
      .set('Cookie', 'qs_session=valid')
      .set('Origin', APP_ORIGIN)
      .field('kind', 'IMAGE')
      .field('expectedVersion', '1')
      .attach('file', Buffer.from('img'), 'front.jpg')
      .expect(HttpStatus.FORBIDDEN)
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects trailing unknown fields without allowing a domain commit', async () => {
    const response = await uploadRequest()
      .field('kind', 'IMAGE')
      .field('expectedVersion', '1')
      .attach('file', Buffer.from('img'), 'front.jpg')
      .field('objectKey', 'secret/internal/path')
      .expect(HttpStatus.BAD_REQUEST)

    expect(response.body).toMatchObject({ code: 'MEDIA_MULTIPART_INVALID' })
    expect(JSON.stringify(response.body)).not.toContain('secret/internal/path')
    expect(uploadCommitted).toBe(false)
  })

  it('rejects Product Document and parser size overflow with stable codes', async () => {
    const documentResponse = await uploadRequest()
      .field('kind', 'DOCUMENT')
      .field('expectedVersion', '1')
      .attach('file', Buffer.from('pdf'), 'manual.pdf')
      .expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
    expect(documentResponse.body).toMatchObject({
      code: 'MEDIA_TYPE_UNSUPPORTED',
    })

    const largeResponse = await uploadRequest()
      .field('kind', 'IMAGE')
      .field('expectedVersion', '1')
      .attach('file', Buffer.from('four'), 'front.jpg')
      .expect(HttpStatus.PAYLOAD_TOO_LARGE)
    expect(largeResponse.body).toMatchObject({
      code: 'MEDIA_FILE_TOO_LARGE',
    })
    expect(uploadCommitted).toBe(false)
  })

  it('validates strict layout and detach JSON bodies before delegation', async () => {
    const headers = {
      Cookie: 'qs_session=valid',
      Origin: APP_ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      'X-Qianshu-CSRF': '1',
    }
    await request(application.getHttpServer())
      .put(`/api/products/${PRODUCT_ID}/media/layout`)
      .set(headers)
      .send({
        expectedVersion: 1,
        imageIds: [MEDIA_ID],
        videoIds: [],
        primaryImageId: MEDIA_ID,
      })
      .expect(HttpStatus.OK)
    expect(updateLayout).toHaveBeenCalledTimes(1)

    await request(application.getHttpServer())
      .delete(`/api/products/${PRODUCT_ID}/media/${MEDIA_ID}`)
      .set(headers)
      .send({ expectedVersion: 1, unknown: true })
      .expect(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(detach).not.toHaveBeenCalled()
  })
})
