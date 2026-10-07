import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { HttpStatus, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { MediaAssetStatus } from '../src/generated/prisma/enums'
import { PrivateNoStoreInterceptor } from '../src/infrastructure/http/private-no-store.interceptor'
import { AccessControlService } from '../src/modules/access-control/access-control.service'
import { AuthSessionService } from '../src/modules/auth/auth-session.service'
import { AuthenticationGuard } from '../src/modules/auth/guards/authentication.guard'
import { CsrfProtectionGuard } from '../src/modules/auth/guards/csrf-protection.guard'
import { PasswordChangeRequiredGuard } from '../src/modules/auth/guards/password-change-required.guard'
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard'
import { SessionCookieProvider } from '../src/modules/auth/providers/session-cookie.provider'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { trashKeyFor } from '../src/modules/media/media-retention.service'
import { ProductMediaContentService } from '../src/modules/products/media/product-media-content.service'
import { ProductMediaHttpService } from '../src/modules/products/media/product-media-http.service'
import { ProductMediaMultipartParser } from '../src/modules/products/media/product-media-multipart.parser'
import { ProductCommandService } from '../src/modules/products/product-command.service'
import { ProductQueryService } from '../src/modules/products/product-query.service'
import { ProductUpdateService } from '../src/modules/products/product-update.service'
import { ProductsController } from '../src/modules/products/products.controller'
import {
  createE2eImageBuffer,
  ProductMediaE2eHarness,
} from './product-media-e2e-harness'

const APP_ORIGIN = 'https://dms.example.com'

interface ApiErrorBody {
  readonly code: string
  readonly message: string
}

function readResponseBody<T>(response: { readonly body: unknown }): T {
  return response.body as T
}

// ProductMedia 历史行禁止 DELETE；本文件只能由专属 runner 在一次性数据库中开启。
const describeExclusive = process.env.PRODUCT_MEDIA_E2E_EXCLUSIVE === '1'
  ? describe
  : describe.skip

describeExclusive('Product media runtime HTTP with isolated PostgreSQL and local storage', () => {
  jest.setTimeout(60_000)

  let application: INestApplication
  let runtime: ProductMediaE2eHarness
  let permissions: string[]
  let mustChangePassword: boolean
  let observedRange: string | undefined

  beforeAll(async () => {
    runtime = await ProductMediaE2eHarness.create()
    permissions = ['products:update']
    mustChangePassword = false
    const products = new ProductQueryService(
      runtime.prisma,
      new DictionaryLookupService(runtime.prisma),
    )
    const productMedia = new ProductMediaHttpService(
      runtime.productMedia,
      new ProductMediaMultipartParser(),
      products,
    )

    @Module({
      controllers: [ProductsController],
      providers: [{
        provide: ConfigService,
        useValue: {
          getOrThrow: (key: string) => {
            if (key === 'auth.appOrigin') return APP_ORIGIN
            throw new Error('Unexpected E2E configuration key')
          },
        },
      }, {
        provide: SessionCookieProvider,
        useValue: {
          readValue: (cookie: unknown) => (
            cookie === 'qs_session=valid' ? 'valid-session-token' : null
          ),
        },
      }, {
        provide: AuthSessionService,
        useValue: {
          authenticate: () => Promise.resolve({
            absoluteExpiresAt: new Date('2026-09-14T00:00:00.000Z'),
            createdAt: new Date('2026-08-14T00:00:00.000Z'),
            displayName: '媒体 E2E 管理员',
            id: '44444444-4444-4444-8444-444444444444',
            idleExpiresAt: new Date('2026-08-15T00:00:00.000Z'),
            lastActivityAt: new Date('2026-08-14T00:00:00.000Z'),
            mustChangePassword,
            userId: runtime.actorId,
            username: 'product_media_e2e',
          }),
        },
      }, {
        provide: AccessControlService,
        useValue: {
          getPermissionCodes: () => Promise.resolve([...permissions]),
          hasAll: (granted: readonly string[], required: readonly string[]) => (
            required.every(code => granted.includes(code))
          ),
        },
      }, {
        provide: ProductQueryService,
        useValue: products,
      }, {
        provide: ProductCommandService,
        useValue: { create: jest.fn() },
      }, {
        provide: ProductUpdateService,
        useValue: { update: jest.fn() },
      }, {
        provide: ProductMediaHttpService,
        useValue: productMedia,
      }, {
        provide: ProductMediaContentService,
        useValue: runtime.content,
      }, {
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
    class ProductMediaRuntimeApiTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [ProductMediaRuntimeApiTestModule],
    })
      .compile()
    application = moduleRef.createNestApplication()
    application.use((
      incoming: { headers: { range?: string } },
      _response: unknown,
      next: () => void,
    ) => {
      observedRange = incoming.headers.range
      next()
    })
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
  })

  afterAll(async () => {
    await application?.close()
    await runtime?.close()
  })

  beforeEach(() => {
    permissions = ['products:update']
    mustChangePassword = false
    observedRange = undefined
  })

  function authenticatedMutation(path: string, method: 'delete' | 'post' | 'put') {
    const agent = request(application.getHttpServer())
    return agent[method](path)
      .set('Cookie', 'qs_session=valid')
      .set('Origin', APP_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('X-Qianshu-CSRF', '1')
  }

  function contentRequest(productId: string, mediaId: string, method: 'get' | 'head' = 'get') {
    const agent = request(application.getHttpServer())
    const path = `/api/products/${productId}/media/${mediaId}/content`
    return agent[method](path).set('Cookie', 'qs_session=valid')
  }

  async function storedObjectCount(): Promise<number> {
    const pages = await Promise.all(['assets', 'staging', 'trash'].map(namespace => (
      runtime.storage.inventory({
        limit: 100,
        namespace: namespace as 'assets' | 'staging' | 'trash',
      })
    )))
    return pages.reduce((total, page) => total + page.objects.length, 0)
  }

  it('streams one authorized IMAGE through the real domain and returns a private public snapshot', async () => {
    const productId = await runtime.createProduct('HTTP-UPLOAD')
    const contents = await createE2eImageBuffer()
    const response = await authenticatedMutation(
      `/api/products/${productId}/media`,
      'post',
    )
      .field('kind', 'IMAGE')
      .field('expectedVersion', '1')
      .attach('file', contents, {
        contentType: 'image/webp',
        filename: 'http-front.webp',
      })
      .expect(HttpStatus.CREATED)

    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.body).toMatchObject({
      media: {
        height: 3,
        kind: 'IMAGE',
        mimeType: 'image/webp',
        originalFilename: 'http-front.webp',
        width: 5,
      },
      product: { id: productId, version: 2 },
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /objectKey|checksum|storageDriver|mediaAssetId/u,
    )
    const association = await runtime.prisma.productMedia.findFirstOrThrow({
      where: { productId, detachedAt: null },
      select: { mediaAsset: { select: { objectKey: true, status: true } } },
    })
    expect(association.mediaAsset.status).toBe(MediaAssetStatus.READY)
    if (association.mediaAsset.objectKey === null) {
      throw new Error('HTTP upload object key invariant failed')
    }
    await expect(runtime.storage.stat(association.mediaAsset.objectKey))
      .resolves.not.toBeNull()
  })

  it('rejects DOCUMENT, missing CSRF, missing permission and password-change sessions before DB or files', async () => {
    const productId = await runtime.createProduct('HTTP-REJECTIONS')
    const mediaCount = await runtime.prisma.mediaAsset.count()
    const objectCount = await storedObjectCount()

    const document = await authenticatedMutation(
      `/api/products/${productId}/media`,
      'post',
    )
      .field('kind', 'DOCUMENT')
      .field('expectedVersion', '1')
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), {
        contentType: 'application/pdf',
        filename: 'manual.pdf',
      })
      .expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
    expect(readResponseBody<ApiErrorBody>(document).code).toBe('MEDIA_TYPE_UNSUPPORTED')

    const image = await createE2eImageBuffer()
    const missingCsrf = await request(application.getHttpServer())
      .post(`/api/products/${productId}/media`)
      .set('Cookie', 'qs_session=valid')
      .set('Origin', APP_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .field('kind', 'IMAGE')
      .field('expectedVersion', '1')
      .attach('file', image, 'blocked.webp')
      .expect(HttpStatus.FORBIDDEN)
    expect(readResponseBody<ApiErrorBody>(missingCsrf).code).toBe('CSRF_REJECTED')

    permissions = []
    const forbidden = await authenticatedMutation(
      `/api/products/${productId}/media`,
      'post',
    )
      .field('kind', 'IMAGE')
      .field('expectedVersion', '1')
      .attach('file', image, 'blocked.webp')
      .expect(HttpStatus.FORBIDDEN)
    expect(readResponseBody<ApiErrorBody>(forbidden).code).toBe('FORBIDDEN')

    permissions = ['products:update']
    mustChangePassword = true
    const passwordRequired = await authenticatedMutation(
      `/api/products/${productId}/media`,
      'post',
    )
      .field('kind', 'IMAGE')
      .field('expectedVersion', '1')
      .attach('file', image, 'blocked.webp')
      .expect(HttpStatus.FORBIDDEN)
    expect(readResponseBody<ApiErrorBody>(passwordRequired).code)
      .toBe('PASSWORD_CHANGE_REQUIRED')

    await expect(runtime.prisma.mediaAsset.count()).resolves.toBe(mediaCount)
    await expect(storedObjectCount()).resolves.toBe(objectCount)
  })

  it('authorizes read-only GET/HEAD/Range, returns opaque 304, and hides missing or detached media behind one 404', async () => {
    const productId = await runtime.createProduct('HTTP-CONTENT')
    const upload = await runtime.uploadImage(productId, 1, 'private-content')
    if (upload.affectedProductMediaId === null) {
      throw new Error('HTTP content association invariant failed')
    }
    const mediaId = upload.affectedProductMediaId
    const association = await runtime.prisma.productMedia.findUniqueOrThrow({
      where: { id: mediaId },
      select: { mediaAsset: { select: { id: true, objectKey: true } } },
    })
    if (association.mediaAsset.objectKey === null) {
      throw new Error('HTTP content object key invariant failed')
    }

    permissions = ['product-media:read']
    const response = await contentRequest(productId, mediaId).expect(HttpStatus.OK)
    expect(response.headers).toMatchObject({
      'accept-ranges': 'bytes',
      // 商品素材内容不可变，允许浏览器长期私有缓存；公共缓存会绕过会话鉴权。
      'cache-control': 'private, max-age=31536000, immutable',
      'content-type': 'image/webp',
      'x-content-type-options': 'nosniff',
    })
    expect(response.headers['content-length']).toEqual(expect.any(String))
    expect(response.headers['x-accel-redirect']).toBeUndefined()
    expect(response.body).toBeInstanceOf(Buffer)
    expect((response.body as Buffer).length).toBeGreaterThan(0)
    expect(response.headers.etag).toMatch(/^"sha256-[A-Za-z0-9_-]{43}"$/u)

    const conditional = await contentRequest(productId, mediaId)
      .set('If-None-Match', response.headers.etag)
      .expect(HttpStatus.NOT_MODIFIED)
    expect(conditional.text).toBe('')
    expect(conditional.headers['x-accel-redirect']).toBeUndefined()

    const head = await contentRequest(productId, mediaId, 'head')
      .set('Range', 'bytes=0-0')
      .expect(HttpStatus.PARTIAL_CONTENT)
    expect(observedRange).toBe('bytes=0-0')
    expect(head.text).toBeUndefined()
    expect(head.headers['content-length']).toBe('1')
    expect(head.headers['content-range']).toBe(
      `bytes 0-0/${String((response.body as Buffer).length)}`,
    )
    expect(head.headers['x-accel-redirect']).toBeUndefined()

    const partial = await contentRequest(productId, mediaId)
      .set('Range', 'bytes=0-0')
      .expect(HttpStatus.PARTIAL_CONTENT)
    expect(partial.body).toEqual((response.body as Buffer).subarray(0, 1))

    const missing = await contentRequest(productId, randomUUID())
      .expect(HttpStatus.NOT_FOUND)
    expect(readResponseBody<ApiErrorBody>(missing)).toMatchObject({
      code: 'PRODUCT_MEDIA_NOT_FOUND',
      message: '产品或媒体不存在',
    })

    permissions = ['products:update']
    await authenticatedMutation(
      `/api/products/${productId}/media/${mediaId}`,
      'delete',
    )
      .send({ expectedVersion: 2 })
      .expect(HttpStatus.OK)

    permissions = ['product-media:read']
    const detached = await contentRequest(productId, mediaId)
      .expect(HttpStatus.NOT_FOUND)
    expect(readResponseBody<ApiErrorBody>(detached)).toMatchObject({
      code: readResponseBody<ApiErrorBody>(missing).code,
      message: readResponseBody<ApiErrorBody>(missing).message,
    })
    expect(JSON.stringify(detached.body)).not.toMatch(
      /objectKey|checksum|storageDriver|detachedAt|TRASHED/u,
    )

    const asset = await runtime.prisma.mediaAsset.findUniqueOrThrow({
      where: { id: association.mediaAsset.id },
      select: { status: true },
    })
    expect(asset.status).toBe(MediaAssetStatus.TRASHED)
    await expect(runtime.storage.stat(association.mediaAsset.objectKey))
      .resolves.toBeNull()
    await expect(runtime.storage.stat(trashKeyFor(association.mediaAsset.objectKey)))
      .resolves.not.toBeNull()
  })
})
