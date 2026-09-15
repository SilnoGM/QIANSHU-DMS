import { Readable } from 'node:stream'

import sharp from 'sharp'

import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { deliverPurchaseOrderImage, readPurchaseOrderImageThumbnails } from './purchase-order-image-assets'
import type { PurchaseOrderImageSnapshot } from './purchase-order-image-snapshot'

function snapshot(ids: Array<string | null>): PurchaseOrderImageSnapshot {
  return { lines: ids.map(mainImageId => ({ mainImageId })) } as unknown as PurchaseOrderImageSnapshot
}

function setup() {
  const prisma = { productMedia: { findMany: jest.fn<Promise<unknown>, [unknown]>() } }
  const delivery = { mode: 'application', stat: jest.fn<Promise<unknown>, [string]>(), open: jest.fn<Promise<unknown>, [string]>() }
  return { prisma, delivery, prismaService: prisma as unknown as PrismaService, deliveryService: delivery as unknown as MediaContentDeliveryService }
}

describe('purchase order image private assets', () => {
  it('uses placeholders without accessing storage when products have no image', async () => {
    const fixture = setup()
    await expect(readPurchaseOrderImageThumbnails(fixture.prismaService, fixture.deliveryService, snapshot([null]))).resolves.toEqual(new Map())
    expect(fixture.prisma.productMedia.findMany).not.toHaveBeenCalled()
    expect(fixture.delivery.open).not.toHaveBeenCalled()
  })

  it('deduplicates authoritative product images and shrinks each before retaining it', async () => {
    const fixture = setup()
    const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer()
    fixture.prisma.productMedia.findMany.mockResolvedValue([{ id: 'image-1', mediaAsset: { objectKey: 'assets/2026/09/product.png', sizeBytes: BigInt(bytes.length) } }])
    fixture.delivery.open.mockResolvedValue({ stream: Readable.from(bytes) })
    const result = await readPurchaseOrderImageThumbnails(fixture.prismaService, fixture.deliveryService, snapshot(['image-1', 'image-1', null]))
    expect(fixture.prisma.productMedia.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['image-1'] }, kind: 'IMAGE', detachedAt: null, mediaAsset: { status: 'READY', deletedAt: null } } }))
    expect(fixture.delivery.open).toHaveBeenCalledTimes(1)
    expect(await sharp(result.get('image-1')).metadata()).toMatchObject({ format: 'png', width: 160 })
  })

  it('fails when a referenced image is detached instead of silently omitting it', async () => {
    const fixture = setup()
    fixture.prisma.productMedia.findMany.mockResolvedValue([])
    await expect(readPurchaseOrderImageThumbnails(fixture.prismaService, fixture.deliveryService, snapshot(['image-1']))).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })
  })

  it('rejects inconsistent storage bytes and prevents untrusted object namespaces', async () => {
    const fixture = setup()
    fixture.prisma.productMedia.findMany.mockResolvedValue([{ id: 'image-1', mediaAsset: { objectKey: 'assets/2026/09/product.png', sizeBytes: 5n } }])
    fixture.delivery.open.mockResolvedValue({ stream: Readable.from(Buffer.from('PNG')) })
    await expect(readPurchaseOrderImageThumbnails(fixture.prismaService, fixture.deliveryService, snapshot(['image-1']))).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })
    fixture.prisma.productMedia.findMany.mockResolvedValue([{ id: 'image-1', mediaAsset: { objectKey: 'https://remote.example/product.png', sizeBytes: 5n } }])
    fixture.delivery.open.mockClear()
    await expect(readPurchaseOrderImageThumbnails(fixture.prismaService, fixture.deliveryService, snapshot(['image-1']))).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })
    expect(fixture.delivery.open).not.toHaveBeenCalled()
  })

  it('answers conditional GET and HEAD without opening file streams', async () => {
    const fixture = setup()
    const asset = { objectKey: 'assets/2026/09/draft.png', checksumSha256: 'a'.repeat(64), sizeBytes: 3n }
    fixture.delivery.stat.mockResolvedValue({ sizeBytes: 3n })
    const head = await deliverPurchaseOrderImage(fixture.deliveryService, asset, 'draft', undefined, 'HEAD')
    const conditional = await deliverPurchaseOrderImage(fixture.deliveryService, asset, 'draft', head.headers.ETag, 'GET')
    expect(head).toMatchObject({ status: 200, headers: { 'Content-Length': '3', 'Content-Type': 'image/png' } })
    expect(conditional.status).toBe(304)
    expect(fixture.delivery.open).not.toHaveBeenCalled()
  })
})
