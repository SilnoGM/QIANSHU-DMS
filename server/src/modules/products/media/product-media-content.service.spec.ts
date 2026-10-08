import { Readable } from 'node:stream'

import { HttpStatus } from '@nestjs/common'

import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
} from '../../../generated/prisma/enums'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import type { MediaVariantService } from '../../media/media-variant.service'
import type { MediaStorage } from '../../media/media-storage'
import {
  ProductMediaContentService,
} from './product-media-content.service'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_MEDIA_ID = '22222222-2222-4222-8222-222222222222'
const CHECKSUM = 'a'.repeat(64)

function contentRow(overrides: Record<string, unknown> = {}) {
  return {
    kind: ProductMediaKind.IMAGE,
    mediaAsset: {
      checksumSha256: CHECKSUM,
      mediaType: MediaType.IMAGE,
      mimeType: 'image/webp',
      objectKey: `assets/2026/08/${PRODUCT_MEDIA_ID}.webp`,
      originalFilename: 'front "图"\r\n.webp',
      status: MediaAssetStatus.READY,
    },
    ...overrides,
  }
}

function videoContentRow(
  mimeType: string,
  extension: string,
  originalFilename: string,
) {
  return contentRow({
    kind: ProductMediaKind.VIDEO,
    mediaAsset: {
      ...contentRow().mediaAsset,
      mediaType: MediaType.VIDEO,
      mimeType,
      objectKey: `assets/2026/08/${PRODUCT_MEDIA_ID}${extension}`,
      originalFilename,
    },
  })
}

function createFixture(
  row: unknown = contentRow(),
  mode: 'application' | 'internal_redirect' = 'internal_redirect',
) {
  const findFirst = jest.fn().mockResolvedValue(row)
  const stat = jest.fn().mockResolvedValue({
    modifiedAt: new Date('2026-08-16T00:00:00.000Z'),
    sizeBytes: 6n,
  })
  const open = jest.fn().mockImplementation(
    (_objectKey: string, range?: { start: number, end: number }) => Promise.resolve({
      contentLength: BigInt(range === undefined ? 6 : range.end - range.start + 1),
      modifiedAt: new Date('2026-08-16T00:00:00.000Z'),
      sizeBytes: 6n,
      stream: Readable.from(Buffer.from('abcdef').subarray(
        range?.start ?? 0,
        (range?.end ?? 5) + 1,
      )),
    }),
  )
  const delivery = new MediaContentDeliveryService({
    open,
    stat,
  } as unknown as MediaStorage, mode)
  // 变体渲染默认返回 null（等价于派生失败），需要断言变体行为的用例再覆盖 render 结果。
  const render = jest.fn().mockResolvedValue(null)
  const variants = { render } as unknown as MediaVariantService
  const service = new ProductMediaContentService({
    productMedia: { findFirst },
  } as unknown as PrismaService, delivery, variants)
  return { findFirst, open, render, service, stat }
}

describe('ProductMediaContentService', () => {
  it('authorizes only an active READY association and returns safe internal headers', async () => {
    const fixture = createFixture()

    const result = await fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
    )

    expect(fixture.findFirst).toHaveBeenCalledWith({
      where: {
        id: PRODUCT_MEDIA_ID,
        productId: PRODUCT_ID,
        detachedAt: null,
        mediaAsset: { is: { status: MediaAssetStatus.READY } },
      },
      select: {
        kind: true,
        mediaAsset: {
          select: {
            checksumSha256: true,
            mediaType: true,
            mimeType: true,
            objectKey: true,
            originalFilename: true,
            status: true,
          },
        },
      },
    })
    expect(result.status).toBe(HttpStatus.OK)
    expect(result.headers).toMatchObject({
      'Accept-Ranges': 'bytes',
      'Content-Type': 'image/webp',
      'X-Accel-Redirect':
        `/_qianshu_internal_media/assets/2026/08/${PRODUCT_MEDIA_ID}.webp`,
      'X-Content-Type-Options': 'nosniff',
    })
    expect(result.headers['Content-Disposition']).toMatch(
      /^inline; filename="[\x20-\x21\x23-\x7e]+"; filename\*=UTF-8''[A-Za-z0-9!#$&+.^_`|~%'-]+$/u,
    )
    expect(result.headers['Content-Disposition']).not.toMatch(/[\r\n]/u)
    expect(result.headers.ETag).toMatch(/^"sha256-[A-Za-z0-9_-]{43}"$/u)
    expect(result.headers.ETag).not.toContain(CHECKSUM)
  })

  it('returns a bodyless 304 contract for strong, weak, list and wildcard matches', async () => {
    const fixture = createFixture()
    const ready = await fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
    )
    const etag = ready.headers.ETag

    for (const value of [etag, `W/${etag}`, `"other", W/${etag}`, '*']) {
      const result = await fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        value,
      )
      expect(result).toEqual({
        status: HttpStatus.NOT_MODIFIED,
        headers: {
          'Accept-Ranges': 'bytes',
          ETag: etag,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
  })

  it('streams complete application content with an explicit length and no internal redirect', async () => {
    const fixture = createFixture(contentRow(), 'application')

    const result = await fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
      undefined,
      'GET',
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.headers).toMatchObject({
      'Accept-Ranges': 'bytes',
      'Content-Length': '6',
      'Content-Type': 'image/webp',
    })
    expect(result.headers).not.toHaveProperty('X-Accel-Redirect')
    expect(result.stream).toBeInstanceOf(Readable)
    expect(fixture.stat).toHaveBeenCalledWith(
      `assets/2026/08/${PRODUCT_MEDIA_ID}.webp`,
    )
    expect(fixture.open).toHaveBeenCalledWith(
      `assets/2026/08/${PRODUCT_MEDIA_ID}.webp`,
      undefined,
    )
  })

  it.each([
    ['bytes=1-3', { end: 3, start: 1 }, 'bytes 1-3/6', '3'],
    ['bytes=2-', { end: 5, start: 2 }, 'bytes 2-5/6', '4'],
    ['bytes=-2', { end: 5, start: 4 }, 'bytes 4-5/6', '2'],
  ] as const)(
    'normalizes application range %s and returns a partial stream',
    async (rangeHeader, expectedRange, contentRange, contentLength) => {
      const fixture = createFixture(contentRow(), 'application')

      const result = await fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        undefined,
        rangeHeader,
        'GET',
      )

      expect(result.status).toBe(HttpStatus.PARTIAL_CONTENT)
      expect(result.headers).toMatchObject({
        'Content-Length': contentLength,
        'Content-Range': contentRange,
      })
      expect(fixture.open).toHaveBeenCalledWith(
        `assets/2026/08/${PRODUCT_MEDIA_ID}.webp`,
        expectedRange,
      )
    },
  )

  it('uses an ASCII fallback and RFC 5987 UTF-8 filename for renamed video downloads', async () => {
    const fixture = createFixture(
      videoContentRow(
        'video/quicktime',
        '.mov',
        '4月2日-微耕機01.mp4',
      ),
      'application',
    )

    const result = await fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
    )

    expect(result.headers['Content-Disposition']).toBe(
      'inline; filename="4_2_-_01.mov"; filename*=UTF-8\'\'4%E6%9C%882%E6%97%A5-%E5%BE%AE%E8%80%95%E6%A9%9F01.mov',
    )
  })

  it('describes application HEAD ranges without opening a body stream', async () => {
    const fixture = createFixture(contentRow(), 'application')

    const result = await fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
      'bytes=0-0',
      'HEAD',
    )

    expect(result.status).toBe(HttpStatus.PARTIAL_CONTENT)
    expect(result.headers).toMatchObject({
      'Content-Length': '1',
      'Content-Range': 'bytes 0-0/6',
    })
    expect(result.stream).toBeUndefined()
    expect(fixture.open).not.toHaveBeenCalled()
  })

  it.each(['bytes=6-', 'bytes=-0', 'bytes=0-1,3-4', 'items=0-1'])(
    'returns a bodyless 416 for invalid or unsatisfied application ranges',
    async (rangeHeader) => {
      const fixture = createFixture(contentRow(), 'application')

      const result = await fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        undefined,
        rangeHeader,
        'GET',
      )

      expect(result).toMatchObject({
        status: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
        headers: { 'Content-Range': 'bytes */6' },
      })
      expect(result.stream).toBeUndefined()
      expect(fixture.open).not.toHaveBeenCalled()
    },
  )

  it('ignores malformed or non-matching If-None-Match values', async () => {
    const fixture = createFixture()

    for (const value of [undefined, 1, 'W/not-a-tag', '"different"']) {
      const result = await fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        value,
      )
      expect(result.status).toBe(HttpStatus.OK)
      expect(result.headers['X-Accel-Redirect']).toBeDefined()
    }
  })

  it.each([
    null,
    contentRow({
      mediaAsset: {
        ...contentRow().mediaAsset,
        objectKey: `assets/../trash/${PRODUCT_MEDIA_ID}.webp`,
      },
    }),
    contentRow({
      mediaAsset: {
        ...contentRow().mediaAsset,
        mediaType: MediaType.DOCUMENT,
      },
    }),
    contentRow({
      kind: ProductMediaKind.VIDEO,
      mediaAsset: {
        ...contentRow().mediaAsset,
        mediaType: MediaType.VIDEO,
      },
    }),
    contentRow({
      mediaAsset: {
        ...contentRow().mediaAsset,
        mimeType: 'text/html',
      },
    }),
    contentRow({
      mediaAsset: {
        ...contentRow().mediaAsset,
        checksumSha256: null,
      },
    }),
  ])('returns one anti-enumeration 404 for absent or unsafe persisted content', async (row) => {
    const fixture = createFixture(row)

    await expect(fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
    )).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      code: 'PRODUCT_MEDIA_NOT_FOUND',
    })
  })

  it('supports the confirmed MP4 video response without exposing storage internals', async () => {
    const fixture = createFixture(contentRow({
      kind: ProductMediaKind.VIDEO,
      mediaAsset: {
        ...contentRow().mediaAsset,
        mediaType: MediaType.VIDEO,
        mimeType: 'video/mp4',
        objectKey: `assets/2026/08/${PRODUCT_MEDIA_ID}.mp4`,
        originalFilename: 'demo.mp4',
      },
    }))

    const result = await fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.headers).toMatchObject({
      'Content-Type': 'video/mp4',
      'X-Accel-Redirect':
        `/_qianshu_internal_media/assets/2026/08/${PRODUCT_MEDIA_ID}.mp4`,
    })
  })

  it.each([
    ['MOV', 'video/quicktime', '.mov', 'camera.mp4', 'camera.mov'],
    ['M4V', 'video/x-m4v', '.m4v', 'camera.mov', 'camera.m4v'],
    ['WebM', 'video/webm', '.webm', 'camera.webm', 'camera.webm'],
  ] as const)(
    'serves trusted %s content with canonical download suffix across GET/HEAD/range/cache flows',
    async (_label, mimeType, extension, originalFilename, downloadFilename) => {
      const fixture = createFixture(
        videoContentRow(mimeType, extension, originalFilename),
        'application',
      )

      const partial = await fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        undefined,
        'bytes=1-3',
        'GET',
      )
      expect(partial.status).toBe(HttpStatus.PARTIAL_CONTENT)
      expect(partial.headers).toMatchObject({
        'Content-Disposition': `inline; filename="${downloadFilename}"`,
        'Content-Length': '3',
        'Content-Range': 'bytes 1-3/6',
        'Content-Type': mimeType,
      })
      expect(fixture.open).toHaveBeenLastCalledWith(
        `assets/2026/08/${PRODUCT_MEDIA_ID}${extension}`,
        { end: 3, start: 1 },
      )

      const head = await fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        undefined,
        undefined,
        'HEAD',
      )
      expect(head.status).toBe(HttpStatus.OK)
      expect(head.stream).toBeUndefined()
      expect(head.headers).toMatchObject({
        'Content-Length': '6',
        'Content-Type': mimeType,
      })

      const notModified = await fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        partial.headers.ETag,
      )
      expect(notModified.status).toBe(HttpStatus.NOT_MODIFIED)
      expect(notModified.stream).toBeUndefined()

      const unsatisfied = await fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        undefined,
        'bytes=6-',
      )
      expect(unsatisfied).toMatchObject({
        status: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
        headers: { 'Content-Range': 'bytes */6' },
      })
    },
  )

  it.each([
    ['video/quicktime', '.mp4'],
    ['video/x-m4v', '.mov'],
    ['video/webm', '.mp4'],
  ] as const)(
    'returns anti-enumeration 404 when trusted %s metadata conflicts with object suffix %s',
    async (mimeType, wrongExtension) => {
      const fixture = createFixture(contentRow({
        kind: ProductMediaKind.VIDEO,
        mediaAsset: {
          ...contentRow().mediaAsset,
          mediaType: MediaType.VIDEO,
          mimeType,
          objectKey: `assets/2026/08/${PRODUCT_MEDIA_ID}${wrongExtension}`,
          originalFilename: 'camera.mp4',
        },
      }))

      await expect(fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        undefined,
      )).rejects.toMatchObject({
        code: 'PRODUCT_MEDIA_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      })
    },
  )

  it('maps database failures to one fixed safe internal error', async () => {
    const fixture = createFixture()
    fixture.findFirst.mockRejectedValue(new Error('sensitive database detail'))

    await expect(fixture.service.resolve(
      PRODUCT_ID,
      PRODUCT_MEDIA_ID,
      undefined,
    )).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      publicMessage: '服务器内部错误',
    })
  })
  describe('derived presentation variants', () => {
    const RENDERED = Buffer.from('rendered-webp-bytes')

    async function readStream(stream: Readable): Promise<Buffer> {
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk as Buffer))
      }
      return Buffer.concat(chunks)
    }

    it('serves a privately cached webp thumbnail and ignores Range on the variant path', async () => {
      const fixture = createFixture(contentRow(), 'application')
      fixture.render.mockResolvedValue(RENDERED)

      const result = await fixture.service.resolve(
        PRODUCT_ID,
        PRODUCT_MEDIA_ID,
        undefined,
        'bytes=0-1',
        'GET',
        'thumb',
      )

      expect(fixture.render).toHaveBeenCalledWith({
        checksumSha256: CHECKSUM,
        objectKey: `assets/2026/08/${PRODUCT_MEDIA_ID}.webp`,
        variant: 'thumb',
      })
      expect(result.status).toBe(HttpStatus.OK)
      expect(result.headers).toMatchObject({
        'Accept-Ranges': 'none',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Length': String(RENDERED.length),
        'Content-Type': 'image/webp',
      })
      expect(result.headers).not.toHaveProperty('Content-Range')
      expect(result.headers['Content-Disposition']).toBe(
        'inline; filename="front _.thumb.webp"',
      )
      // 变体由派生缓存承担，不再回源读取原件。
      expect(fixture.open).not.toHaveBeenCalled()
      expect(await readStream(result.stream!)).toEqual(RENDERED)
    })

    it('uses a distinct opaque ETag per variant and answers 304 without a body', async () => {
      const fixture = createFixture(contentRow(), 'application')
      fixture.render.mockResolvedValue(RENDERED)

      const original = await fixture.service.resolve(PRODUCT_ID, PRODUCT_MEDIA_ID, undefined)
      const variant = await fixture.service.resolve(
        PRODUCT_ID, PRODUCT_MEDIA_ID, undefined, undefined, 'GET', 'thumb',
      )
      expect(variant.headers.ETag).not.toBe(original.headers.ETag)

      const notModified = await fixture.service.resolve(
        PRODUCT_ID, PRODUCT_MEDIA_ID, variant.headers.ETag, undefined, 'GET', 'thumb',
      )
      expect(notModified.status).toBe(HttpStatus.NOT_MODIFIED)
      expect(notModified.headers).toMatchObject({
        'Accept-Ranges': 'none',
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: variant.headers.ETag,
      })
      expect(notModified.stream).toBeUndefined()
    })

    it('describes a variant HEAD without opening a body stream', async () => {
      const fixture = createFixture(contentRow(), 'application')
      fixture.render.mockResolvedValue(RENDERED)

      const result = await fixture.service.resolve(
        PRODUCT_ID, PRODUCT_MEDIA_ID, undefined, undefined, 'HEAD', 'thumb',
      )

      expect(result.status).toBe(HttpStatus.OK)
      expect(result.headers['Content-Length']).toBe(String(RENDERED.length))
      expect(result.stream).toBeUndefined()
    })

    it.each([
      ['thumb', videoContentRow('video/mp4', '.mp4', 'clip.mp4')],
      ['poster', contentRow()],
    ] as const)('hides %s when the variant does not match the asset media type', async (variant, row) => {
      const fixture = createFixture(row)
      fixture.render.mockResolvedValue(RENDERED)

      await expect(fixture.service.resolve(
        PRODUCT_ID, PRODUCT_MEDIA_ID, undefined, undefined, 'GET', variant,
      )).rejects.toMatchObject({
        code: 'PRODUCT_MEDIA_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      })
      // 类型不匹配时既不渲染也不回退成原件传输。
      expect(fixture.render).not.toHaveBeenCalled()
      expect(fixture.open).not.toHaveBeenCalled()
    })

    it.each(['original', 'thumbnail', 'thumbs', 'posters', 1, ['thumb']])(
      'rejects the unsupported variant value %p with a validation failure',
      async (variant) => {
        const fixture = createFixture()

        await expect(fixture.service.resolve(
          PRODUCT_ID, PRODUCT_MEDIA_ID, undefined, undefined, 'GET', variant,
        )).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        })
        expect(fixture.render).not.toHaveBeenCalled()
      },
    )

    it('falls back to the original image when thumbnail rendering fails', async () => {
      const fixture = createFixture(contentRow(), 'application')

      // 变体服务默认返回 null，等价于派生失败。
      const result = await fixture.service.resolve(
        PRODUCT_ID, PRODUCT_MEDIA_ID, undefined, undefined, 'GET', 'thumb',
      )

      expect(result.status).toBe(HttpStatus.OK)
      expect(result.headers).toMatchObject({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'image/webp',
      })
      expect(result.headers).not.toHaveProperty('Cache-Control')
      expect(fixture.open).toHaveBeenCalled()
    })

    it('never falls back to the whole video when poster rendering fails', async () => {
      const fixture = createFixture(videoContentRow('video/mp4', '.mp4', 'clip.mp4'))

      await expect(fixture.service.resolve(
        PRODUCT_ID, PRODUCT_MEDIA_ID, undefined, undefined, 'GET', 'poster',
      )).rejects.toMatchObject({
        code: 'PRODUCT_MEDIA_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      })
      expect(fixture.open).not.toHaveBeenCalled()
    })

    it('renders a poster for video assets through the same authorization path', async () => {
      const fixture = createFixture(videoContentRow('video/mp4', '.mp4', 'clip.mp4'))
      fixture.render.mockResolvedValue(RENDERED)

      const result = await fixture.service.resolve(
        PRODUCT_ID, PRODUCT_MEDIA_ID, undefined, undefined, 'GET', 'poster',
      )

      expect(fixture.render).toHaveBeenCalledWith({
        checksumSha256: CHECKSUM,
        objectKey: `assets/2026/08/${PRODUCT_MEDIA_ID}.mp4`,
        variant: 'poster',
      })
      expect(result.headers).toMatchObject({
        'Accept-Ranges': 'none',
        'Content-Type': 'image/webp',
      })
      expect(result.headers['Content-Disposition']).toBe(
        'inline; filename="clip.poster.webp"',
      )
    })
  })
})
