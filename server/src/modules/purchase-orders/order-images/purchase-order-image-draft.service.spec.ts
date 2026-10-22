import { Readable } from 'node:stream'

import type { Prisma } from '../../../generated/prisma/client'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { AuditService } from '../../audit/audit.service'
import type { MediaAssetService } from '../../media/media-asset.service'
import type { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import type { MediaAssetRetentionService } from '../../media/media-retention.service'
import type { PurchaseOrderQueryService } from '../purchase-order-query.service'
import { PurchaseOrderImageDraftService } from './purchase-order-image-draft.service'
import type { PurchaseOrderImageRenderer } from './purchase-order-image-renderer'

jest.mock('./purchase-order-image-cancellation', () => ({
  deliverCancelledPurchaseOrderImage: jest.fn(),
}))

const cancellation = jest.requireMock<{ deliverCancelledPurchaseOrderImage: jest.Mock }>(
  './purchase-order-image-cancellation',
)

jest.mock('./purchase-order-image-snapshot', () => ({
  PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION: '5',
  createPurchaseOrderImageSnapshot: (detail: { content: string }) => ({ content: detail.content, lines: [] }),
  hashPurchaseOrderImageSnapshot: (snapshot: { content: string }) => snapshot.content,
}))

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const DRAFT_ID = '33333333-3333-4333-8333-333333333333'
const ASSET_ID = '44444444-4444-4444-8444-444444444444'
const NEXT_ASSET_ID = '55555555-5555-4555-8555-555555555555'
const context = { actorUserId: ACTOR_ID, requestId: 'image-request' }
const now = new Date('2026-09-15T01:00:00.000Z')

function setup() {
  const detail = { id: ORDER_ID, orderNo: 'PO/20260915-00001', orderStatus: 'PENDING_REVIEW', version: 3, content: 'hash-one', shippingMarkText: 'BASE-1', parts: [{ status: 'PENDING_REVIEW', shipmentNo: 'PKG-1', shippingMarkText: 'BASE-1' }] }
  const existing = { id: DRAFT_ID, purchaseOrderId: ORDER_ID, purchaseOrder: { orderStatus: 'PENDING_REVIEW' }, mediaAssetId: ASSET_ID, orderVersion: 3, snapshotHash: 'hash-one', templateVersion: '5', generatedByUserId: ACTOR_ID, generatedBy: { id: ACTOR_ID, displayName: '审核人' }, createdAt: now, invalidatedAt: null, archivedAt: null, mediaAsset: { status: 'READY', deletedAt: null, mimeType: 'image/png', objectKey: 'assets/2026/09/image.png', checksumSha256: 'a'.repeat(64), originalFilename: 'purchase.png', sizeBytes: 3n } }
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue([{ id: ORDER_ID }]),
    purchaseOrderImageDraft: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(existing),
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ ...existing, mediaAssetId: NEXT_ASSET_ID }),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(existing),
      findMany: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue([existing]),
      updateMany: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ count: 1 }),
    },
    purchaseOrderDocument: { findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(null), create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ id: 'document-id' }) },
  }
  const prisma = {
    $transaction: jest.fn<Promise<unknown>, [(tx: typeof transaction) => Promise<unknown>]>(callback => callback(transaction)),
    purchaseOrderImageDraft: { findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(existing) },
    productMedia: { findMany: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue([]) },
  }
  const query = { getById: jest.fn<Promise<typeof detail>, [string, unknown?]>().mockResolvedValue(detail) }
  const renderer = { render: jest.fn<Promise<Buffer>, [unknown, unknown]>().mockResolvedValue(Buffer.from('PNG')) }
  const media = {
    prepare: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ id: NEXT_ASSET_ID }),
    activate: jest.fn<Promise<void>, [unknown, string]>().mockResolvedValue(undefined),
    fail: jest.fn<Promise<void>, [string, unknown]>().mockResolvedValue(undefined),
  }
  const delivery = { mode: 'application', stat: jest.fn<Promise<unknown>, [string]>().mockResolvedValue({ sizeBytes: 3n }), open: jest.fn<Promise<unknown>, [string]>().mockResolvedValue({ stream: Readable.from(Buffer.from('PNG')) }) }
  const retention = { markUnreferencedForTrash: jest.fn<Promise<string>, [unknown, string]>().mockResolvedValue('TRASHED') }
  const audit = { record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}) }
  const service = new PurchaseOrderImageDraftService(prisma as unknown as PrismaService, query as unknown as PurchaseOrderQueryService, renderer as unknown as PurchaseOrderImageRenderer, media as unknown as MediaAssetService, delivery as unknown as MediaContentDeliveryService, retention as unknown as MediaAssetRetentionService, audit as unknown as AuditService)
  return { service, detail, existing, transaction, prisma, query, renderer, media, delivery, retention, audit }
}

describe('PurchaseOrderImageDraftService', () => {
  beforeEach(() => cancellation.deliverCancelledPurchaseOrderImage.mockReset())

  it('resumes a persisted current draft without rendering or consuming new media', async () => {
    const fixture = setup()
    const result = await fixture.service.generate(context, ORDER_ID, { expectedVersion: 3 })
    expect(result).toMatchObject({ id: DRAFT_ID, isCurrent: true, orderVersion: 3 })
    expect(fixture.renderer.render).not.toHaveBeenCalled()
    expect(fixture.media.prepare).not.toHaveBeenCalled()
  })

  it('keeps an outdated draft visible but forbids using it for review', async () => {
    const fixture = setup()
    fixture.detail.content = 'changed'
    await expect(fixture.service.getDraft(ORDER_ID)).resolves.toMatchObject({ draft: { id: DRAFT_ID, isCurrent: false } })
    await expect(fixture.service.attachForReview(fixture.transaction as unknown as Prisma.TransactionClient, context, ORDER_ID, 3, DRAFT_ID)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_STALE' })
    expect(fixture.transaction.purchaseOrderDocument.create).not.toHaveBeenCalled()
  })

  it('leaves the old draft usable when regeneration fails', async () => {
    const fixture = setup()
    fixture.renderer.render.mockRejectedValue(new Error('renderer failed'))
    await expect(fixture.service.generate(context, ORDER_ID, { expectedVersion: 3, regenerate: true })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE' })
    expect(fixture.transaction.purchaseOrderImageDraft.update).not.toHaveBeenCalled()
    expect(fixture.retention.markUnreferencedForTrash).not.toHaveBeenCalled()
  })

  it('rejects a changed order after rendering and cleans the unused prepared asset', async () => {
    const fixture = setup()
    fixture.query.getById.mockResolvedValueOnce(fixture.detail).mockResolvedValue({ ...fixture.detail, version: 4 })
    await expect(fixture.service.generate(context, ORDER_ID, { expectedVersion: 3, regenerate: true })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(fixture.media.fail).toHaveBeenCalledWith(NEXT_ASSET_ID, 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED')
    expect(fixture.media.activate).not.toHaveBeenCalled()
  })

  it('replaces a draft only after a new image is ready, without mutating order or shipment facts', async () => {
    const fixture = setup()
    await fixture.service.generate(context, ORDER_ID, { expectedVersion: 3, regenerate: true })
    expect(fixture.media.activate).toHaveBeenCalledWith(fixture.transaction, NEXT_ASSET_ID)
    expect(fixture.transaction.purchaseOrderImageDraft.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: DRAFT_ID }, data: { invalidatedAt: expect.any(Date) as unknown } }))
    expect(fixture.retention.markUnreferencedForTrash).toHaveBeenCalledWith(fixture.transaction, ASSET_ID)
    expect(fixture.transaction.purchaseOrderImageDraft.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ purchaseOrderId: ORDER_ID, mediaAssetId: NEXT_ASSET_ID, orderVersion: 3, snapshotHash: 'hash-one' }) as unknown }))
  })

  it('archives the exact previewed asset once in the caller review transaction', async () => {
    const fixture = setup()
    await fixture.service.attachForReview(fixture.transaction as unknown as Prisma.TransactionClient, context, ORDER_ID, 3, DRAFT_ID)
    expect(fixture.transaction.purchaseOrderDocument.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mediaAssetId: ASSET_ID, documentType: 'ORDER_ISSUANCE_VOUCHER', purchaseOrderId: ORDER_ID }) as unknown }))
    expect(fixture.transaction.purchaseOrderImageDraft.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: DRAFT_ID }, data: { archivedAt: expect.any(Date) as unknown } }))
    expect(fixture.media.prepare).not.toHaveBeenCalled()
    expect(fixture.media.activate).not.toHaveBeenCalled()
  })

  it('requires a current generated image and refuses a pre-existing purchase voucher', async () => {
    const fixture = setup()
    await expect(fixture.service.attachForReview(fixture.transaction as unknown as Prisma.TransactionClient, context, ORDER_ID, 3, undefined)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_REQUIRED' })
    fixture.transaction.purchaseOrderDocument.findFirst.mockResolvedValue({ id: 'existing-voucher' })
    await expect(fixture.service.attachForReview(fixture.transaction as unknown as Prisma.TransactionClient, context, ORDER_ID, 3, DRAFT_ID)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS' })
  })

  it('invalidates pending images on order cancellation and schedules unreferenced files for cleanup', async () => {
    const fixture = setup()
    await fixture.service.invalidateForOrder(fixture.transaction as unknown as Prisma.TransactionClient, ORDER_ID)
    expect(fixture.transaction.purchaseOrderImageDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ purchaseOrderId: ORDER_ID, invalidatedAt: null, archivedAt: null }) as unknown, data: { invalidatedAt: expect.any(Date) as unknown } }))
    expect(fixture.retention.markUnreferencedForTrash).toHaveBeenCalledWith(fixture.transaction, ASSET_ID)
  })

  it('reuses a concurrent winning generation and fails only its unused prepared upload', async () => {
    const fixture = setup()
    const winningId = '66666666-6666-4666-8666-666666666666'
    fixture.transaction.purchaseOrderImageDraft.findFirst.mockResolvedValue({ ...fixture.existing, id: winningId })
    await expect(fixture.service.generate(context, ORDER_ID, { expectedVersion: 3, regenerate: true })).resolves.toMatchObject({ id: winningId, isCurrent: true })
    expect(fixture.media.fail).toHaveBeenCalledWith(NEXT_ASSET_ID, 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED')
    expect(fixture.media.activate).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderImageDraft.update).not.toHaveBeenCalled()
  })

  it('requires dispatched marks and pending review before allocating any image storage', async () => {
    const fixture = setup()
    fixture.detail.shippingMarkText = ''
    await expect(fixture.service.generate(context, ORDER_ID, { expectedVersion: 3 })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_MARKS_REQUIRED' })
    fixture.detail.shippingMarkText = 'BASE-1'
    fixture.detail.orderStatus = 'CANCELLED'
    await expect(fixture.service.generate(context, ORDER_ID, { expectedVersion: 3 })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_NOT_ALLOWED' })
    expect(fixture.media.prepare).not.toHaveBeenCalled()
    expect(fixture.renderer.render).not.toHaveBeenCalled()
  })

  it('maps persistence concurrency failures to a refreshable conflict and releases prepared media', async () => {
    const fixture = setup()
    fixture.prisma.$transaction.mockRejectedValue({ code: 'P2034' })
    await expect(fixture.service.generate(context, ORDER_ID, { expectedVersion: 3, regenerate: true })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(fixture.media.fail).toHaveBeenCalledWith(NEXT_ASSET_ID, 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED')
  })

  it('rejects missing image files before review can attach a broken voucher', async () => {
    const fixture = setup()
    fixture.delivery.stat.mockResolvedValue(null)
    await expect(fixture.service.attachForReview(fixture.transaction as unknown as Prisma.TransactionClient, context, ORDER_ID, 3, DRAFT_ID)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_UNAVAILABLE' })
    expect(fixture.transaction.purchaseOrderDocument.create).not.toHaveBeenCalled()
  })

  it('aborts replacement when the old draft asset cannot be released safely', async () => {
    const fixture = setup()
    fixture.retention.markUnreferencedForTrash.mockResolvedValue('STATE_CONFLICT')
    await expect(fixture.service.generate(context, ORDER_ID, { expectedVersion: 3, regenerate: true })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_UNAVAILABLE' })
    expect(fixture.transaction.purchaseOrderImageDraft.create).not.toHaveBeenCalled()
    expect(fixture.media.fail).toHaveBeenCalledWith(NEXT_ASSET_ID, 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED')
  })

  it('delivers PNG privately and rejects invalidated image IDs', async () => {
    const fixture = setup()
    const result = await fixture.service.resolveContent(ORDER_ID, DRAFT_ID, undefined, 'GET')
    expect(result).toMatchObject({ status: 200, headers: { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff' } })
    expect(cancellation.deliverCancelledPurchaseOrderImage).not.toHaveBeenCalled()
    fixture.prisma.purchaseOrderImageDraft.findFirst.mockResolvedValue(null)
    await expect(fixture.service.resolveContent(ORDER_ID, DRAFT_ID, undefined, 'GET')).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_DRAFT_NOT_FOUND' })
  })

  it.each(['GET', 'HEAD'] as const)('marks cancelled archived drafts on %s so their old preview URLs cannot return an unmarked image', async method => {
    const fixture = setup()
    fixture.prisma.purchaseOrderImageDraft.findFirst.mockResolvedValue({
      ...fixture.existing, archivedAt: now, purchaseOrder: { orderStatus: 'CANCELLED' },
    })
    const markedResponse = { status: 200, headers: { 'Content-Type': 'image/png', ETag: '"cancelled-image"' } }
    cancellation.deliverCancelledPurchaseOrderImage.mockResolvedValue(markedResponse)
    await expect(fixture.service.resolveContent(ORDER_ID, DRAFT_ID, '"original-image"', method)).resolves.toBe(markedResponse)
    expect(cancellation.deliverCancelledPurchaseOrderImage).toHaveBeenCalledWith(fixture.delivery, fixture.existing.mediaAsset, DRAFT_ID, '"original-image"', method)
    expect(fixture.prisma.purchaseOrderImageDraft.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ invalidatedAt: null }) as unknown,
      select: expect.objectContaining({ purchaseOrder: { select: { orderStatus: true } } }) as unknown,
    }))
    expect(fixture.delivery.open).not.toHaveBeenCalled()
  })
})
