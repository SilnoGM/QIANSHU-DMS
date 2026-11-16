/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言调用参数。 */
import { Readable } from 'node:stream'

import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import {
  AssistantMediaDeliveryService,
  AssistantMediaRateLimiter,
} from './assistant-media-delivery.service'
import type { AssistantMediaUrlService } from './assistant-media-url'

const DELIVERY_MEDIA_ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'signed-token'

function service(options: {
  readonly verification?: { ok: true, deliveryMediaId: string } | { ok: false }
  readonly row?: Record<string, unknown> | null
  readonly limiter?: AssistantMediaRateLimiter
} = {}) {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 })
  const prisma = {
    assistantDeliveryMedia: {
      findFirst: jest.fn().mockResolvedValue(options.row === undefined
        ? {
            fetchedAt: null,
            id: DELIVERY_MEDIA_ID,
            mediaAsset: {
              mimeType: 'image/jpeg',
              objectKey: 'assets/sales/voucher.jpg',
              originalFilename: '凭证.jpg',
              sizeBytes: 1234n,
            },
          }
        : options.row),
      updateMany,
    },
  }
  const open = jest.fn().mockResolvedValue({ stream: Readable.from(['x']) })
  const url = {
    verify: jest.fn().mockReturnValue(options.verification ?? { ok: true, deliveryMediaId: DELIVERY_MEDIA_ID }),
  }
  const delivery = new AssistantMediaDeliveryService(
    prisma as unknown as PrismaService,
    url as unknown as AssistantMediaUrlService,
    { open } as unknown as MediaContentDeliveryService,
    options.limiter ?? new AssistantMediaRateLimiter(),
  )
  return { service: delivery, prisma, open, url, updateMany }
}

describe('AssistantMediaDeliveryService', () => {
  it('streams a ready image and records the first fetch', async () => {
    const { service: delivery, prisma, updateMany } = service()

    const result = await delivery.resolve(TOKEN, 'GET', '127.0.0.1')

    expect(result.status).toBe(200)
    expect(result.headers).toMatchObject({
      'Content-Type': 'image/jpeg',
      'Content-Length': '1234',
      'X-Content-Type-Options': 'nosniff',
    })
    expect(result.stream).toBeDefined()
    expect(prisma.assistantDeliveryMedia.findFirst).toHaveBeenCalledWith({
      where: {
        id: DELIVERY_MEDIA_ID,
        status: { in: ['PENDING', 'SENDING', 'ACCEPTED', 'PARTIAL'] },
        delivery: { status: { in: ['PENDING', 'SENDING', 'ACCEPTED', 'PARTIAL'] } },
        mediaAsset: {
          status: 'READY',
          deletedAt: null,
          mediaType: 'IMAGE',
          objectKey: { not: null },
          mimeType: { not: null },
          sizeBytes: { not: null },
        },
      },
      select: expect.anything(),
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: DELIVERY_MEDIA_ID, fetchedAt: null },
      data: { fetchedAt: expect.any(Date) },
    })
  })

  it('answers HEAD without opening the object', async () => {
    const { service: delivery, open } = service()

    const result = await delivery.resolve(TOKEN, 'HEAD', '127.0.0.1')

    expect(result.status).toBe(200)
    expect(result.stream).toBeUndefined()
    expect(open).not.toHaveBeenCalled()
  })

  it('returns 404 for an invalid token without touching the database', async () => {
    const { service: delivery, prisma } = service({ verification: { ok: false } })

    await expect(delivery.resolve('bad', 'GET', '127.0.0.1')).rejects.toMatchObject({
      code: 'NOTIFICATION_MEDIA_NOT_FOUND',
      status: 404,
    })
    expect(prisma.assistantDeliveryMedia.findFirst).not.toHaveBeenCalled()
  })

  it('returns 404 when the attachment or its asset is no longer usable', async () => {
    const { service: delivery } = service({ row: null })

    await expect(delivery.resolve(TOKEN, 'GET', '127.0.0.1')).rejects.toMatchObject({
      code: 'NOTIFICATION_MEDIA_NOT_FOUND',
    })
  })

  it('rate limits abusive clients per address', async () => {
    const limiter = new AssistantMediaRateLimiter()
    const { service: delivery } = service({ limiter })

    for (let index = 0; index < 60; index += 1) {
      await expect(delivery.resolve(TOKEN, 'HEAD', '203.0.113.9')).resolves.toMatchObject({ status: 200 })
    }
    await expect(delivery.resolve(TOKEN, 'HEAD', '203.0.113.9')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    })
    await expect(delivery.resolve(TOKEN, 'HEAD', '203.0.113.10')).resolves.toMatchObject({ status: 200 })
  })
})
