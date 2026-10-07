import type { INestApplication } from '@nestjs/common'
import { HttpStatus, Module } from '@nestjs/common'
import { Readable } from 'node:stream'
import { ConfigService } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PrivateNoStoreInterceptor } from '../src/infrastructure/http/private-no-store.interceptor'
import { AccessControlService } from '../src/modules/access-control/access-control.service'
import { AuthSessionService } from '../src/modules/auth/auth-session.service'
import { AuthenticationGuard } from '../src/modules/auth/guards/authentication.guard'
import { CsrfProtectionGuard } from '../src/modules/auth/guards/csrf-protection.guard'
import { PasswordChangeRequiredGuard } from '../src/modules/auth/guards/password-change-required.guard'
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard'
import { SessionCookieProvider } from '../src/modules/auth/providers/session-cookie.provider'
import { MediaContentDeliveryService } from '../src/modules/media/media-content-delivery.service'
import type { MediaByteRange, MediaStorage } from '../src/modules/media/media-storage'
import { ProductMediaContentService } from '../src/modules/products/media/product-media-content.service'
import { ProductMediaHttpService } from '../src/modules/products/media/product-media-http.service'
import { ProductCommandService } from '../src/modules/products/product-command.service'
import { ProductQueryService } from '../src/modules/products/product-query.service'
import { ProductUpdateService } from '../src/modules/products/product-update.service'
import { ProductsController } from '../src/modules/products/products.controller'

const APP_ORIGIN = 'https://dms.example.com'
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const MEDIA_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'
const OBJECT_KEY = `assets/2026/08/${MEDIA_ID}.webp`
const PRIVATE_CONTENT = Buffer.from('private-image')

interface ApiErrorBody {
  readonly code: string
  readonly message: string
}

function readResponseBody<T>(response: { readonly body: unknown }): T {
  return response.body as T
}

function readyContentRow() {
  return {
    kind: ProductMediaKind.IMAGE,
    mediaAsset: {
      checksumSha256: 'a'.repeat(64),
      mediaType: MediaType.IMAGE,
      mimeType: 'image/webp',
      objectKey: OBJECT_KEY,
      originalFilename: 'front.webp',
      status: MediaAssetStatus.READY,
    },
  }
}

function readyVideoContentRow(
  mimeType: string,
  extension: string,
  originalFilename: string,
) {
  return {
    kind: ProductMediaKind.VIDEO,
    mediaAsset: {
      checksumSha256: 'b'.repeat(64),
      mediaType: MediaType.VIDEO,
      mimeType,
      objectKey: `assets/2026/08/${MEDIA_ID}${extension}`,
      originalFilename,
      status: MediaAssetStatus.READY,
    },
  }
}

describe('Product media private content API', () => {
  let application: INestApplication
  let permissions: string[]
  let mustChangePassword: boolean
  let observedRange: string | undefined
  let findFirst: jest.Mock
  let openObject: jest.Mock
  let statObject: jest.Mock

  beforeAll(async () => {
    permissions = ['product-media:read']
    mustChangePassword = false
    findFirst = jest.fn().mockResolvedValue(readyContentRow())
    statObject = jest.fn().mockResolvedValue({
      modifiedAt: new Date('2026-08-16T00:00:00.000Z'),
      sizeBytes: BigInt(PRIVATE_CONTENT.length),
    })
    openObject = jest.fn().mockImplementation(
      (_objectKey: string, range?: MediaByteRange) => {
        const content = range === undefined
          ? PRIVATE_CONTENT
          : PRIVATE_CONTENT.subarray(range.start, range.end + 1)
        return Promise.resolve({
          contentLength: BigInt(content.length),
          modifiedAt: new Date('2026-08-16T00:00:00.000Z'),
          sizeBytes: BigInt(PRIVATE_CONTENT.length),
          stream: Readable.from(content),
        })
      },
    )
    const delivery = new MediaContentDeliveryService({
      open: openObject,
      stat: statObject,
    } as unknown as MediaStorage, 'application')

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
            username: 'media_reader',
            displayName: '媒体读取员',
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
        provide: PrismaService,
        useValue: { productMedia: { findFirst } },
      }, {
        provide: MediaContentDeliveryService,
        useValue: delivery,
      }, ProductMediaContentService, {
        provide: ProductQueryService,
        useValue: { list: jest.fn(), getById: jest.fn() },
      }, {
        provide: ProductCommandService,
        useValue: { create: jest.fn() },
      }, {
        provide: ProductUpdateService,
        useValue: { update: jest.fn() },
      }, {
        provide: ProductMediaHttpService,
        useValue: { upload: jest.fn(), updateLayout: jest.fn(), detach: jest.fn() },
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
    class ProductMediaContentApiTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [ProductMediaContentApiTestModule],
    }).compile()
    application = moduleRef.createNestApplication()
    application.use((incoming: { headers: { range?: string } }, _response: unknown, next: () => void) => {
      // 仅记录原始 Header，区间规范化结果通过 storage.open 的结构化参数另行断言。
      observedRange = incoming.headers.range
      next()
    })
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
  })

  afterAll(async () => {
    await application.close()
  })

  beforeEach(() => {
    permissions = ['product-media:read']
    mustChangePassword = false
    observedRange = undefined
    findFirst.mockReset().mockResolvedValue(readyContentRow())
    statObject.mockClear()
    openObject.mockClear()
  })

  function contentRequest(method: 'get' | 'head' = 'get') {
    const agent = request(application.getHttpServer())
    const path = `/api/products/${PRODUCT_ID}/media/${MEDIA_ID}/content`
    const pendingRequest = method === 'get' ? agent.get(path) : agent.head(path)
    return pendingRequest.set('Cookie', 'qs_session=valid')
  }

  it('allows product-media:read without products:read and streams only safe application content', async () => {
    const response = await contentRequest().expect(HttpStatus.OK)

    expect(response.headers).toMatchObject({
      'accept-ranges': 'bytes',
      // 商品素材是内容不可变的低敏媒体：允许浏览器长期私有缓存，但不得进入公共缓存。
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': 'inline; filename="front.webp"',
      'content-length': String(PRIVATE_CONTENT.length),
      'content-type': 'image/webp',
      'x-content-type-options': 'nosniff',
    })
    expect(response.headers['x-accel-redirect']).toBeUndefined()
    expect(response.body).toEqual(PRIVATE_CONTENT)
    expect(response.headers.etag).toMatch(/^"sha256-[A-Za-z0-9_-]{43}"$/u)
    expect(response.headers['x-request-id']).toEqual(expect.any(String))
    expect(findFirst).toHaveBeenCalledTimes(1)
  })

  it('rejects anonymous, products:read-only and password-change-required sessions before lookup', async () => {
    const anonymous = await request(application.getHttpServer())
      .get(`/api/products/${PRODUCT_ID}/media/${MEDIA_ID}/content`)
      .expect(HttpStatus.UNAUTHORIZED)
    expect(readResponseBody<ApiErrorBody>(anonymous).code)
      .toBe('AUTHENTICATION_REQUIRED')
    expect(anonymous.headers['cache-control']).toBe('private, no-store')

    permissions = ['products:read']
    const forbidden = await contentRequest().expect(HttpStatus.FORBIDDEN)
    expect(readResponseBody<ApiErrorBody>(forbidden).code).toBe('FORBIDDEN')

    permissions = ['product-media:read']
    mustChangePassword = true
    const passwordRequired = await contentRequest().expect(HttpStatus.FORBIDDEN)
    expect(readResponseBody<ApiErrorBody>(passwordRequired).code)
      .toBe('PASSWORD_CHANGE_REQUIRED')

    expect(findFirst).not.toHaveBeenCalled()
  })

  it('uses one anti-enumeration 404 for every association lookup miss', async () => {
    findFirst.mockResolvedValue(null)

    const response = await contentRequest().expect(HttpStatus.NOT_FOUND)

    expect(response.body).toMatchObject({
      code: 'PRODUCT_MEDIA_NOT_FOUND',
      message: '产品或媒体不存在',
    })
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(JSON.stringify(response.body)).not.toMatch(
      /objectKey|checksum|storageDriver|detachedAt|READY/u,
    )
  })

  it('returns a bodyless 304 before any internal proxy transfer', async () => {
    const initial = await contentRequest().expect(HttpStatus.OK)

    const conditional = await contentRequest()
      .set('If-None-Match', initial.headers.etag)
      .expect(HttpStatus.NOT_MODIFIED)

    expect(conditional.text).toBe('')
    expect(conditional.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=31536000, immutable',
      etag: initial.headers.etag,
      'x-content-type-options': 'nosniff',
    })
    expect(conditional.headers).not.toHaveProperty('x-accel-redirect')
    expect(findFirst).toHaveBeenCalledTimes(2)
  })

  it('returns bodyless application HEAD range metadata without opening a stream', async () => {
    const response = await contentRequest('head')
      .set('Range', 'bytes=0-0')
      .expect(HttpStatus.PARTIAL_CONTENT)

    expect(observedRange).toBe('bytes=0-0')
    expect(response.text).toBeUndefined()
    expect(response.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-length': '1',
      'content-range': `bytes 0-0/${PRIVATE_CONTENT.length}`,
      'content-type': 'image/webp',
    })
    expect(response.headers['x-accel-redirect']).toBeUndefined()
    expect(openObject).not.toHaveBeenCalled()
    expect(findFirst).toHaveBeenCalledTimes(1)
  })

  it('streams a normalized application byte range and rejects multi-range requests', async () => {
    const partial = await contentRequest()
      .set('Range', 'bytes=1-3')
      .expect(HttpStatus.PARTIAL_CONTENT)

    expect(observedRange).toBe('bytes=1-3')
    expect(partial.headers).toMatchObject({
      'content-length': '3',
      'content-range': `bytes 1-3/${PRIVATE_CONTENT.length}`,
    })
    expect(partial.body).toEqual(PRIVATE_CONTENT.subarray(1, 4))
    expect(openObject).toHaveBeenLastCalledWith(OBJECT_KEY, { end: 3, start: 1 })

    const unsatisfied = await contentRequest()
      .set('Range', 'bytes=0-1,3-4')
      .expect(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
    expect(unsatisfied.text).toBe('')
    expect(unsatisfied.headers['content-range']).toBe(
      `bytes */${PRIVATE_CONTENT.length}`,
    )
  })

  it.each([
    ['MOV', 'video/quicktime', '.mov', 'camera.mp4', 'camera.mov'],
    ['M4V', 'video/x-m4v', '.m4v', 'camera.mov', 'camera.m4v'],
    ['WebM', 'video/webm', '.webm', 'camera.webm', 'camera.webm'],
  ] as const)(
    'serves private %s using trusted MIME and canonical filename for GET/HEAD/range/cache',
    async (_label, mimeType, extension, originalFilename, downloadFilename) => {
      const objectKey = `assets/2026/08/${MEDIA_ID}${extension}`
      findFirst.mockResolvedValue(
        readyVideoContentRow(mimeType, extension, originalFilename),
      )

      const full = await contentRequest().expect(HttpStatus.OK)
      expect(full.headers).toMatchObject({
        'content-disposition': `inline; filename="${downloadFilename}"`,
        'content-length': String(PRIVATE_CONTENT.length),
        'content-type': mimeType,
      })
      expect(full.body).toEqual(PRIVATE_CONTENT)

      const partial = await contentRequest()
        .set('Range', 'bytes=1-3')
        .expect(HttpStatus.PARTIAL_CONTENT)
      expect(partial.headers).toMatchObject({
        'content-length': '3',
        'content-range': `bytes 1-3/${PRIVATE_CONTENT.length}`,
        'content-type': mimeType,
      })
      expect(openObject).toHaveBeenLastCalledWith(objectKey, { end: 3, start: 1 })

      const head = await contentRequest('head')
        .set('Range', 'bytes=0-0')
        .expect(HttpStatus.PARTIAL_CONTENT)
      expect(head.text).toBeUndefined()
      expect(head.headers).toMatchObject({
        'content-length': '1',
        'content-range': `bytes 0-0/${PRIVATE_CONTENT.length}`,
        'content-type': mimeType,
      })

      const conditional = await contentRequest()
        .set('If-None-Match', full.headers.etag)
        .expect(HttpStatus.NOT_MODIFIED)
      expect(conditional.text).toBe('')

      const unsatisfied = await contentRequest()
        .set('Range', `bytes=${PRIVATE_CONTENT.length}-`)
        .expect(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
      expect(unsatisfied.headers['content-range']).toBe(
        `bytes */${PRIVATE_CONTENT.length}`,
      )
    },
  )

  it('returns the same anti-enumeration 404 for conflicting video MIME and object suffix', async () => {
    findFirst.mockResolvedValue({
      ...readyVideoContentRow('video/quicktime', '.mov', 'camera.mov'),
      mediaAsset: {
        ...readyVideoContentRow('video/quicktime', '.mov', 'camera.mov').mediaAsset,
        objectKey: `assets/2026/08/${MEDIA_ID}.mp4`,
      },
    })

    const response = await contentRequest().expect(HttpStatus.NOT_FOUND)
    expect(response.body).toMatchObject({
      code: 'PRODUCT_MEDIA_NOT_FOUND',
      message: '产品或媒体不存在',
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /objectKey|mimeType|video\/quicktime|\.mp4/u,
    )
  })

  it('does not expose the protected internal redirect URI as an application route', async () => {
    const response = await request(application.getHttpServer())
      .get(`/_qianshu_internal_media/${OBJECT_KEY}`)
      .expect(HttpStatus.NOT_FOUND)

    expect(response.headers['x-accel-redirect']).toBeUndefined()
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('rejects malformed public UUIDs before persistence lookup', async () => {
    const response = await request(application.getHttpServer())
      .get(`/api/products/not-a-uuid/media/${MEDIA_ID}/content`)
      .set('Cookie', 'qs_session=valid')
      .expect(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(readResponseBody<ApiErrorBody>(response).code)
      .toBe('VALIDATION_FAILED')

    expect(findFirst).not.toHaveBeenCalled()
  })
})
