import { Readable } from 'node:stream'

import { HttpStatus } from '@nestjs/common'

import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
} from '../../../generated/prisma/enums'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
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
  const service = new ProductMediaContentService({
    productMedia: { findFirst },
  } as unknown as PrismaService, delivery)
  return { findFirst, open, service, stat }
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
      /^inline; filename="[\x20-\x21\x23-\x7e]+"$/u,
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
})
