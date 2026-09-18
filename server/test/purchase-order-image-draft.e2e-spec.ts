import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { writeFile } from 'node:fs/promises'

import sharp from 'sharp'

import { PurchaseOrderImageRenderer } from '../src/modules/purchase-orders/order-images/purchase-order-image-renderer'
import type { PurchaseOrderImageSnapshot } from '../src/modules/purchase-orders/order-images/purchase-order-image-snapshot'
import { PurchaseOrderDocumentService } from '../src/modules/purchase-orders/documents/purchase-order-document.service'
import type { PurchaseOrderDocumentMultipartParser } from '../src/modules/purchase-orders/documents/purchase-order-document-multipart.parser'

import { Prisma } from '../src/generated/prisma/client'
import { AuditService, AuditWriteFailedError, type RecordAuditEventInput } from '../src/modules/audit/audit.service'
import { createPurchaseOrderImageFixture, type PurchaseOrderImageFixture } from './purchase-order-image-draft.fixture'
import { createAtomicityFixture, createCommands, customInput, MARK_CONSUMER, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

class GenerationAuditFailure extends AuditService {
  override record(transaction: Prisma.TransactionClient, input: RecordAuditEventInput) {
    if (input.eventType === 'PURCHASE_ORDER_IMAGE_GENERATED') throw new AuditWriteFailedError()
    return super.record(transaction, input)
  }
}
class ReviewAuditFailure extends AuditService {
  override record(transaction: Prisma.TransactionClient, input: RecordAuditEventInput) {
    if (input.eventType === 'PURCHASE_ORDER_ORDER_STATUS_CHANGED') throw new AuditWriteFailedError()
    return super.record(transaction, input)
  }
}

async function readImageStream(stream: Readable | undefined): Promise<Buffer> {
  if (stream === undefined) throw new Error('Image stream is required')
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid stream chunk')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function countRedPixels(bytes: Buffer): Promise<number> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset] > 130 && data[offset] > data[offset + 1] * 1.5 && data[offset] > data[offset + 2] * 1.5) count += 1
  }
  return count
}

describe('purchase order image drafts with isolated PostgreSQL and real storage', () => {
  jest.setTimeout(120_000)
  let fixture: AtomicityFixture
  let images: PurchaseOrderImageFixture
  beforeAll(async () => { fixture = await createAtomicityFixture(); images = await createPurchaseOrderImageFixture(fixture) })
  afterAll(async () => { await images?.dispose(); await fixture?.dispose() })
  beforeEach(() => { images.renderer.render.mockReset().mockResolvedValue(images.png) })

  async function create(count = 2) {
    const input = await customInput(fixture)
    return createCommands(fixture).create(fixture.context(), { ...input,
      lines: [{ ...input.lines[0], quantity: count }],
      parts: Array.from({ length: count }, () => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
      purchaseTotalAmount: String(count * 10), balanceDueAmount: String(count * 10),
    })
  }
  async function prepare(id: string) {
    return images.buildMutations().prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 })
  }
  async function generated() {
    const id = await create()
    const detail = await prepare(id)
    const draft = await images.drafts.generate(fixture.context(), id, { expectedVersion: detail.version })
    const persisted = await fixture.prisma.purchaseOrderImageDraft.findUniqueOrThrow({ where: { id: draft.id }, include: { mediaAsset: true } })
    return { id, detail, draft, persisted }
  }
  function documents() {
    return new PurchaseOrderDocumentService(fixture.prisma, images.media, images.delivery, fixture.audit, images.query, {} as PurchaseOrderDocumentMultipartParser, images.retention)
  }

  it('prepares generated PNG through the real media validation and storage lifecycle', async () => {
    const asset = await images.media.prepare({ actorUserId: fixture.actor.id, allowedTypes: ['IMAGE'], requestedType: 'IMAGE', declaredMimeType: 'image/png', originalFilename: 'fixture.png', stream: Readable.from(images.png) })
    expect(asset.trustedMetadata.mimeType).toBe('image/png')
    await images.media.fail(asset.id, 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED')
  })

  it('dispatches one set of marks under concurrency while all shipment facts remain pending', async () => {
    const id = await create()
    const before = await fixture.prisma.numberingIssuance.count({ where: { consumerCode: MARK_CONSUMER } })
    const results = await Promise.allSettled([prepare(id), prepare(id)])
    expect(results.filter(result => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
    for (const result of results) if (result.status === 'rejected') expect(result.reason as unknown).toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
    const detail = await images.query.getById(id)
    expect(detail).toMatchObject({ version: 2, orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED' })
    expect(detail.parts).toHaveLength(2)
    expect(detail.parts.map(part => part.status)).toEqual(['PENDING_REVIEW', 'PENDING_REVIEW'])
    expect(new Set(detail.parts.map(part => part.shippingMarkText)).size).toBe(2)
    expect(await fixture.prisma.numberingIssuance.count({ where: { consumerCode: MARK_CONSUMER } })).toBe(before + 1)
    const resumed = await images.buildMutations().prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: detail.version })
    expect(resumed.shippingMarkText).toBe(detail.shippingMarkText)
    expect(resumed.version).toBe(detail.version)
    expect(await fixture.prisma.numberingIssuance.count({ where: { consumerCode: MARK_CONSUMER } })).toBe(before + 1)
  })

  it('persists a READY draft across close/reopen and ordinary cleanup without creating a purchase voucher', async () => {
    const order = await generated()
    expect(order.persisted.mediaAsset).toMatchObject({ status: 'READY', uploadExpiresAt: null, mimeType: 'image/png' })
    await expect(images.drafts.getDraft(order.id)).resolves.toMatchObject({ draft: { id: order.draft.id, isCurrent: true } })
    const result = await images.drafts.generate(fixture.context(), order.id, { expectedVersion: order.detail.version })
    expect(result.id).toBe(order.draft.id)
    expect(images.renderer.render).toHaveBeenCalledTimes(1)
    expect(await images.references.hasActiveReferences(fixture.prisma, order.persisted.mediaAssetId)).toBe(true)
    await images.reconciliation.cleanupExpiredUploads()
    expect(await fixture.prisma.mediaAsset.findUnique({ where: { id: order.persisted.mediaAssetId } })).toMatchObject({ status: 'READY' })
    expect(await fixture.prisma.purchaseOrderDocument.count({ where: { purchaseOrderId: order.id } })).toBe(0)
    const content = await images.drafts.resolveContent(order.id, order.draft.id, undefined, 'GET')
    expect(content.status).toBe(200)
    const chunks: Buffer[] = []
    for await (const chunk of content.stream!) { if (!Buffer.isBuffer(chunk)) throw new Error('Invalid stream chunk'); chunks.push(chunk) }
    expect(Buffer.concat(chunks)).toEqual(images.png)
  })

  it('concurrent image generation retains one current draft and one generated audit', async () => {
    const id = await create()
    const detail = await prepare(id)
    const results = await Promise.all([
      images.drafts.generate(fixture.context(), id, { expectedVersion: detail.version }),
      images.drafts.generate(fixture.context(), id, { expectedVersion: detail.version }),
    ])
    expect(results[0].id).toBe(results[1].id)
    expect(await fixture.prisma.purchaseOrderImageDraft.count({ where: { purchaseOrderId: id, invalidatedAt: null, archivedAt: null } })).toBe(1)
    expect(await fixture.prisma.auditEvent.count({ where: { targetId: results[0].id, eventType: 'PURCHASE_ORDER_IMAGE_GENERATED' } })).toBe(1)
  })

  it('regenerates without changing marks and releases the superseded asset only after commit', async () => {
    const order = await generated()
    const next = await images.drafts.generate(fixture.context(), order.id, { expectedVersion: order.detail.version, regenerate: true })
    expect(next.id).not.toBe(order.draft.id)
    expect(await fixture.prisma.purchaseOrderImageDraft.findUnique({ where: { id: order.draft.id } })).toMatchObject({ invalidatedAt: expect.any(Date) as unknown })
    expect(await fixture.prisma.mediaAsset.findUnique({ where: { id: order.persisted.mediaAssetId } })).toMatchObject({ status: 'TRASHED' })
    expect((await images.query.getById(order.id)).shippingMarkText).toBe(order.detail.shippingMarkText)
    expect(await images.storage.stat(order.persisted.mediaAsset.objectKey!)).not.toBeNull()
    await expect(images.drafts.resolveContent(order.id, order.draft.id, undefined, 'GET')).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_DRAFT_NOT_FOUND' })
  })

  it('retains the original draft and physical file if replacement audit rolls back after invalidation', async () => {
    const order = await generated()
    const failing = images.buildDrafts(new GenerationAuditFailure())
    await expect(failing.generate(fixture.context(), order.id, { expectedVersion: order.detail.version, regenerate: true })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE' })
    expect(await fixture.prisma.purchaseOrderImageDraft.findUnique({ where: { id: order.draft.id } })).toMatchObject({ invalidatedAt: null, archivedAt: null })
    expect(await fixture.prisma.mediaAsset.findUnique({ where: { id: order.persisted.mediaAssetId } })).toMatchObject({ status: 'READY' })
    expect(await images.storage.stat(order.persisted.mediaAsset.objectKey!)).not.toBeNull()
    expect(await fixture.prisma.purchaseOrderImageDraft.count({ where: { purchaseOrderId: order.id } })).toBe(1)
  })

  it('rejects stale order versions and marks the old image stale after a content change', async () => {
    const order = await generated()
    await fixture.prisma.purchaseOrder.update({ where: { id: order.id }, data: { remark: '更新说明', version: { increment: 1 } } })
    await expect(images.drafts.generate(fixture.context(), order.id, { expectedVersion: order.detail.version })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
    await expect(images.drafts.getDraft(order.id)).resolves.toMatchObject({ draft: { id: order.draft.id, isCurrent: false } })
    await expect(images.buildMutations().review(fixture.context(), order.id, { expectedVersion: order.detail.version + 1, imageDraftId: order.draft.id })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_STALE' })
    expect(await fixture.prisma.purchaseOrderDocument.count({ where: { purchaseOrderId: order.id } })).toBe(0)
  })

  it('archives the exact previewed PNG and activates all parts in the review transaction', async () => {
    const order = await generated()
    const result = await images.buildMutations().review(fixture.context(), order.id, { expectedVersion: order.detail.version, imageDraftId: order.draft.id })
    expect(result).toMatchObject({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING', version: order.detail.version + 1 })
    expect(result.parts.every(part => part.status === 'ACTIVE')).toBe(true)
    const document = await fixture.prisma.purchaseOrderDocument.findFirstOrThrow({ where: { purchaseOrderId: order.id, documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null } })
    expect(document.mediaAssetId).toBe(order.persisted.mediaAssetId)
    expect(await fixture.prisma.purchaseOrderImageDraft.findUnique({ where: { id: order.draft.id } })).toMatchObject({ archivedAt: expect.any(Date) as unknown, invalidatedAt: null })
    await expect(images.drafts.getDraft(order.id)).resolves.toEqual({ draft: null })
    expect(await images.references.hasActiveReferences(fixture.prisma, order.persisted.mediaAssetId)).toBe(true)
  })

  it('rolls back voucher archive and state changes together if review audit fails', async () => {
    const order = await generated()
    await expect(images.buildMutations(images.drafts, new ReviewAuditFailure()).review(fixture.context(), order.id, { expectedVersion: order.detail.version, imageDraftId: order.draft.id })).rejects.toBeInstanceOf(AuditWriteFailedError)
    expect((await images.query.getById(order.id)).orderStatus).toBe('PENDING_REVIEW')
    expect(await fixture.prisma.purchaseOrderImageDraft.findUnique({ where: { id: order.draft.id } })).toMatchObject({ archivedAt: null, invalidatedAt: null })
    expect(await fixture.prisma.purchaseOrderDocument.count({ where: { purchaseOrderId: order.id } })).toBe(0)
    expect(await images.storage.stat(order.persisted.mediaAsset.objectKey!)).not.toBeNull()
    const content = await images.drafts.resolveContent(order.id, order.draft.id, undefined, 'GET')
    expect(await readImageStream(content.stream)).toEqual(images.png)
  })

  it('marks cancelled archived images at both content URLs without replacing the stored original or honoring the old ETag', async () => {
    const order = await generated()
    await images.buildMutations().review(fixture.context(), order.id, { expectedVersion: order.detail.version, imageDraftId: order.draft.id })
    const document = await fixture.prisma.purchaseOrderDocument.findFirstOrThrow({ where: { purchaseOrderId: order.id, documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null } })
    const service = documents()
    const originalDocument = await service.resolveContent(order.id, document.id, undefined, 'GET')
    const originalDraft = await images.drafts.resolveContent(order.id, order.draft.id, undefined, 'GET')
    expect(await readImageStream(originalDocument.stream)).toEqual(images.png)
    expect(await readImageStream(originalDraft.stream)).toEqual(images.png)
    const originalAsset = await fixture.prisma.mediaAsset.findUniqueOrThrow({ where: { id: order.persisted.mediaAssetId } })
    const assetCount = await fixture.prisma.mediaAsset.count()

    await images.buildMutations().updateOrderStatus(fixture.context(), order.id, { toStatus: 'CANCELLED' })

    const cancelledDocument = await service.resolveContent(order.id, document.id, originalDocument.headers.ETag, 'GET')
    const cancelledDraft = await images.drafts.resolveContent(order.id, order.draft.id, originalDraft.headers.ETag, 'GET')
    expect(cancelledDocument.status).toBe(200)
    expect(cancelledDraft.status).toBe(200)
    expect(cancelledDocument.headers.ETag).not.toBe(originalDocument.headers.ETag)
    expect(cancelledDraft.headers.ETag).not.toBe(originalDraft.headers.ETag)
    const cancelledBytes = await readImageStream(cancelledDocument.stream)
    expect(cancelledBytes).not.toEqual(images.png)
    expect(await readImageStream(cancelledDraft.stream)).toEqual(cancelledBytes)
    expect(await sharp(cancelledBytes).metadata()).toMatchObject({ format: 'png', width: 64, height: 64 })
    expect(await countRedPixels(cancelledBytes)).toBeGreaterThan(0)
    const head = await service.resolveContent(order.id, document.id, originalDocument.headers.ETag, 'HEAD')
    expect(head).toMatchObject({ status: 200, headers: { ETag: cancelledDocument.headers.ETag, 'Content-Length': String(cancelledBytes.length) } })
    expect(head.stream).toBeUndefined()
    expect(await service.resolveContent(order.id, document.id, cancelledDocument.headers.ETag, 'GET')).toMatchObject({ status: 304 })
    expect(await images.drafts.resolveContent(order.id, order.draft.id, cancelledDraft.headers.ETag, 'GET')).toMatchObject({ status: 304 })

    expect(await fixture.prisma.mediaAsset.findUniqueOrThrow({ where: { id: order.persisted.mediaAssetId } })).toEqual(originalAsset)
    expect(await fixture.prisma.mediaAsset.count()).toBe(assetCount)
    expect(await fixture.prisma.purchaseOrderDocument.findUniqueOrThrow({ where: { id: document.id } })).toEqual(document)
    const storedOriginal = await images.storage.open(originalAsset.objectKey!)
    expect(await readImageStream(storedOriginal.stream)).toEqual(images.png)
  })

  it('leaves archived images and ETags unchanged when cancellation rolls back', async () => {
    const order = await generated()
    await images.buildMutations().review(fixture.context(), order.id, { expectedVersion: order.detail.version, imageDraftId: order.draft.id })
    const document = await fixture.prisma.purchaseOrderDocument.findFirstOrThrow({ where: { purchaseOrderId: order.id, documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null } })
    const service = documents()
    const originalDocument = await service.resolveContent(order.id, document.id, undefined, 'GET')
    const originalDraft = await images.drafts.resolveContent(order.id, order.draft.id, undefined, 'GET')
    expect(await readImageStream(originalDocument.stream)).toEqual(images.png)
    expect(await readImageStream(originalDraft.stream)).toEqual(images.png)

    await expect(images.buildMutations(images.drafts, new ReviewAuditFailure()).updateOrderStatus(fixture.context(), order.id, { toStatus: 'CANCELLED' })).rejects.toBeInstanceOf(AuditWriteFailedError)

    expect((await images.query.getById(order.id)).orderStatus).toBe('CONFIRMED')
    const unchangedDocument = await service.resolveContent(order.id, document.id, undefined, 'GET')
    const unchangedDraft = await images.drafts.resolveContent(order.id, order.draft.id, undefined, 'GET')
    expect(unchangedDocument.headers.ETag).toBe(originalDocument.headers.ETag)
    expect(unchangedDraft.headers.ETag).toBe(originalDraft.headers.ETag)
    expect(await readImageStream(unchangedDocument.stream)).toEqual(images.png)
    expect(await readImageStream(unchangedDraft.stream)).toEqual(images.png)
  })

  it('rejects review without an image and rejects direct SQL bypass of the same invariant', async () => {
    const id = await create()
    const detail = await prepare(id)
    await expect(images.buildMutations().review(fixture.context(), id, { expectedVersion: detail.version })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(fixture.prisma.$transaction(async transaction => {
      await transaction.purchaseOrder.update({ where: { id }, data: { orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING', version: { increment: 1 } } })
      await transaction.purchaseOrderPart.updateMany({ where: { purchaseOrderId: id }, data: { status: 'ACTIVE' } })
    })).rejects.toThrow()
    expect((await images.query.getById(id)).orderStatus).toBe('PENDING_REVIEW')
  })

  it('generates a real Chinese purchase image and archives the same rendered PNG through the complete pipeline', async () => {
    const renderer = new PurchaseOrderImageRenderer()
    images.renderer.render.mockImplementation((snapshot, imageBytes) => renderer.render(snapshot as PurchaseOrderImageSnapshot, imageBytes as ReadonlyMap<string, Buffer>))
    const input = await customInput(fixture)
    const id = await createCommands(fixture).create(fixture.context(), { ...input, customSupplierName: '千树测试供应商', remark: '请按货件唛头分别包装，并附采购单。', lines: [{ ...input.lines[0], name: '中文产品 · 实际采购图片验收' }] })
    const detail = await prepare(id)
    const image = await images.drafts.generate(fixture.context(), id, { expectedVersion: detail.version })
    const response = await images.drafts.resolveContent(id, image.id, undefined, 'GET')
    const chunks: Buffer[] = []
    for await (const chunk of response.stream!) { if (!Buffer.isBuffer(chunk)) throw new Error('Invalid stream chunk'); chunks.push(chunk) }
    const bytes = Buffer.concat(chunks)
    expect(await sharp(bytes).metadata()).toMatchObject({ format: 'png', width: 2100, height: 2970, density: 254 })
    if (process.env.PURCHASE_ORDER_IMAGE_E2E_OUTPUT === '1') await writeFile('/tmp/qianshu-purchase-order-image-e2e.png', bytes)
    const persisted = await fixture.prisma.purchaseOrderImageDraft.findUniqueOrThrow({ where: { id: image.id } })
    await images.buildMutations().review(fixture.context(), id, { expectedVersion: detail.version, imageDraftId: image.id })
    const document = await fixture.prisma.purchaseOrderDocument.findFirstOrThrow({ where: { purchaseOrderId: id, documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null } })
    expect(document).toMatchObject({ mediaAssetId: persisted.mediaAssetId })
    await images.buildMutations().updateOrderStatus(fixture.context(), id, { toStatus: 'CANCELLED' })
    const cancelled = await documents().resolveContent(id, document.id, undefined, 'GET')
    const cancelledBytes = await readImageStream(cancelled.stream)
    expect(await sharp(cancelledBytes).metadata()).toMatchObject({ format: 'png', width: 2100, height: 2970, density: 254 })
    expect(await countRedPixels(cancelledBytes)).toBeGreaterThan(await countRedPixels(bytes) + 100)
    if (process.env.PURCHASE_ORDER_IMAGE_E2E_OUTPUT === '1') await writeFile('/tmp/qianshu-purchase-order-cancelled-e2e.png', cancelledBytes)
  })

  it('permits the formal purchase voucher lifecycle after the draft has been archived', async () => {
    const order = await generated()
    await images.buildMutations().review(fixture.context(), order.id, { expectedVersion: order.detail.version, imageDraftId: order.draft.id })
    const document = await fixture.prisma.purchaseOrderDocument.findFirstOrThrow({ where: { purchaseOrderId: order.id, documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null } })
    const documents = new PurchaseOrderDocumentService(fixture.prisma, images.media, images.delivery, fixture.audit, images.query, {} as PurchaseOrderDocumentMultipartParser, images.retention)
    await documents.detach(fixture.context(), order.id, document.id)
    expect(await fixture.prisma.purchaseOrderDocument.findUnique({ where: { id: document.id } })).toMatchObject({ detachedAt: expect.any(Date) as unknown })
    expect(await fixture.prisma.mediaAsset.findUnique({ where: { id: order.persisted.mediaAssetId } })).toMatchObject({ status: 'TRASHED' })
    expect(await fixture.prisma.purchaseOrderImageDraft.findUnique({ where: { id: order.draft.id } })).toMatchObject({ archivedAt: expect.any(Date) as unknown, invalidatedAt: null })
  })

  it('cancels the order without reclaiming marks and invalidates its pending image', async () => {
    const order = await generated()
    const result = await images.buildMutations().updateOrderStatus(fixture.context(), order.id, { toStatus: 'CANCELLED', reason: '取消测试采购' })
    expect(result.orderStatus).toBe('CANCELLED')
    expect(result.shippingMarkText).toBe(order.detail.shippingMarkText)
    expect(result.parts.map(part => part.shippingMarkText)).toEqual(order.detail.parts.map(part => part.shippingMarkText))
    expect(result.parts.every(part => part.status === 'CANCELLED')).toBe(true)
    expect(await fixture.prisma.purchaseOrderImageDraft.findUnique({ where: { id: order.draft.id } })).toMatchObject({ invalidatedAt: expect.any(Date) as unknown, archivedAt: null })
    expect(await fixture.prisma.mediaAsset.findUnique({ where: { id: order.persisted.mediaAssetId } })).toMatchObject({ status: 'TRASHED' })
    expect(await fixture.prisma.purchaseOrderDocument.count({ where: { purchaseOrderId: order.id } })).toBe(0)
  })
})
