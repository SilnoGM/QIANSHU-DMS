import { Readable } from 'node:stream'

import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { MediaAssetService } from '../media/media-asset.service'
import type { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { NotificationContentMediaService } from './notification-content-media.service'
import type { NotificationContentMediaMultipartRequest } from './notification-content-media-multipart.parser'

function requestFrom(form: FormData): NotificationContentMediaMultipartRequest {
  const response = new Response(form)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    throw new Error('Expected a multipart body')
  }
  const stream = Readable.fromWeb(response.body as never)
  return Object.assign(stream, { headers: { 'content-type': contentType } })
}

function fileForm(file: Blob = new Blob([Buffer.from('abc')], { type: 'image/png' })): FormData {
  const form = new FormData()
  form.set('file', file, 'cover.png')
  return form
}

function createService(options: {
  readonly asset?: Record<string, unknown> | null
  readonly prepared?: Record<string, unknown>
} = {}) {
  const prisma = {
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue(options.asset ?? null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ originalFilename: 'cover.png' }),
    },
  }
  const media = {
    prepare: jest.fn().mockResolvedValue(options.prepared ?? {
      id: '00000000-0000-4000-8000-000000000099',
      mediaType: 'IMAGE',
      objectKey: 'assets/2026/11/00000000-0000-4000-8000-000000000099.png',
      trustedMetadata: {
        mediaType: 'IMAGE',
        mimeType: 'image/png',
        sizeBytes: 3n,
        width: 1068,
        height: 455,
        checksumSha256: 'a'.repeat(64),
        canonicalExtension: '.png',
      },
    }),
  }
  const delivery = {
    mode: 'application',
    open: jest.fn().mockResolvedValue({ stream: Readable.from([Buffer.from('img')]) }),
    stat: jest.fn().mockResolvedValue({ sizeBytes: 3n }),
  }
  const service = new NotificationContentMediaService(
    prisma as unknown as PrismaService,
    media as unknown as MediaAssetService,
    delivery as unknown as MediaContentDeliveryService,
  )
  return { service, prisma, media, delivery }
}

const CONTEXT = {
  actorUserId: '00000000-0000-4000-8000-000000000001',
  requestId: 'request-1',
}

describe('NotificationContentMediaService', () => {
  it('uploads a notification content image into the notification pool', async () => {
    const { service, media } = createService()

    await expect(service.upload(CONTEXT, requestFrom(fileForm()))).resolves.toEqual({
      assetId: '00000000-0000-4000-8000-000000000099',
      mimeType: 'image/png',
      sizeBytes: '3',
      width: 1068,
      height: 455,
      originalFilename: 'cover.png',
    })
    expect(media.prepare).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: CONTEXT.actorUserId,
      allowedTypes: ['IMAGE'],
      pool: 'notification',
      requestedType: 'IMAGE',
    }))
  })

  it('rejects unsupported image types before preparing an asset', async () => {
    const { service, media } = createService()
    const form = fileForm(new Blob([Buffer.from('gif')], { type: 'image/gif' }))

    await expect(service.upload(CONTEXT, requestFrom(form))).rejects.toMatchObject({
      code: 'NOTIFICATION_CONTENT_MEDIA_INVALID',
    })
    expect(media.prepare).not.toHaveBeenCalled()
  })

  it('rejects extra multipart fields and a missing file', async () => {
    const { service } = createService()
    const withField = fileForm()
    withField.set('role', 'COVER')
    const withoutFile = new FormData()

    await expect(service.upload(CONTEXT, requestFrom(withField))).rejects.toMatchObject({
      code: 'NOTIFICATION_CONTENT_MEDIA_MULTIPART_INVALID',
    })
    await expect(service.upload(CONTEXT, requestFrom(withoutFile))).rejects.toMatchObject({
      code: 'NOTIFICATION_CONTENT_MEDIA_MULTIPART_INVALID',
    })
  })

  it('serves content only for assets referenced by notification content', async () => {
    const { service, delivery } = createService({
      asset: {
        checksumSha256: 'b'.repeat(64),
        mimeType: 'image/png',
        objectKey: 'assets/2026/11/00000000-0000-4000-8000-000000000099.png',
        originalFilename: 'cover.png',
      },
    })

    const result = await service.content(
      '00000000-0000-4000-8000-000000000099',
      undefined,
      'GET',
    )

    expect(result.status).toBe(200)
    expect(result.headers).toMatchObject({
      'Content-Type': 'image/png',
      'Content-Length': '3',
      'X-Content-Type-Options': 'nosniff',
    })
    expect(delivery.stat).toHaveBeenCalled()
  })

  it('returns 304 when the ETag matches', async () => {
    const { service } = createService({
      asset: {
        checksumSha256: 'b'.repeat(64),
        mimeType: 'image/png',
        objectKey: 'assets/2026/11/00000000-0000-4000-8000-000000000099.png',
        originalFilename: 'cover.png',
      },
    })
    const first = await service.content(
      '00000000-0000-4000-8000-000000000099',
      undefined,
      'HEAD',
    )

    await expect(service.content(
      '00000000-0000-4000-8000-000000000099',
      first.headers['ETag'],
      'GET',
    )).resolves.toMatchObject({ status: 304 })
  })

  it('hides unreferenced or missing assets behind 404', async () => {
    const { service } = createService()

    await expect(service.content(
      '00000000-0000-4000-8000-000000000099',
      undefined,
      'GET',
    )).rejects.toMatchObject({ code: 'NOTIFICATION_CONTENT_MEDIA_NOT_FOUND' })
  })
})
