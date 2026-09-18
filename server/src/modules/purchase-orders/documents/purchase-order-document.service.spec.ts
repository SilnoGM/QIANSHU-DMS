import { PassThrough } from 'node:stream'

import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { AuditService } from '../../audit/audit.service'
import type { MediaAssetService } from '../../media/media-asset.service'
import type { MediaAssetRetentionService } from '../../media/media-retention.service'
import type { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import type { PurchaseOrderQueryService } from '../purchase-order-query.service'
import type {
  PurchaseOrderDocumentMultipartParser,
} from './purchase-order-document-multipart.parser'
import { PurchaseOrderDocumentService } from './purchase-order-document.service'

jest.mock('../order-images/purchase-order-image-cancellation', () => ({
  deliverCancelledPurchaseOrderImage: jest.fn(),
}))

const cancellation = jest.requireMock<{ deliverCancelledPurchaseOrderImage: jest.Mock }>(
  '../order-images/purchase-order-image-cancellation',
)

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DOCUMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEDIA_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function setup() {
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: ORDER_ID }]),
    purchaseOrder: {
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    purchaseOrderDocument: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        id: DOCUMENT_ID,
        documentType: 'PAYMENT_VOUCHER', mediaAssetId: MEDIA_ID,
      }),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ id: DOCUMENT_ID }),
    },
    mediaAsset: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ id: MEDIA_ID }),
    },
  }
  const prisma = {
    $transaction: jest.fn<
      Promise<unknown>,
      [(tx: typeof transaction) => Promise<unknown>]
    >(callback => callback(transaction)),
    purchaseOrderDocument: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        documentType: 'PAYMENT_VOUCHER',
        purchaseOrder: { orderStatus: 'CONFIRMED' },
        mediaAsset: {
          checksumSha256: 'a'.repeat(64),
          mimeType: 'application/pdf',
          objectKey: 'assets/2026/08/proof.pdf',
          originalFilename: '付款凭证.pdf',
          sizeBytes: 100n,
        },
      }),
    },
  }
  const media = {
    activate: jest.fn<Promise<void>, [unknown, string]>().mockResolvedValue(undefined),
    prepare: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
      id: MEDIA_ID,
      mediaType: 'DOCUMENT',
      trustedMetadata: {
        mimeType: 'application/pdf',
        sizeBytes: 100n,
      },
    }),
  }
  const delivery = {
    mode: 'application',
    stat: jest.fn<Promise<unknown>, [string]>()
      .mockResolvedValue({ sizeBytes: 100n }),
    open: jest.fn<Promise<unknown>, [string]>()
      .mockResolvedValue({ sizeBytes: 100n, contentLength: 100n, stream: new PassThrough() }),
  }
  const retention = { markUnreferencedForTrash: jest.fn<Promise<string>, [unknown, string]>().mockResolvedValue('TRASHED') }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const detail = { id: ORDER_ID }
  const query = {
    getById: jest.fn<Promise<typeof detail>, [string]>().mockResolvedValue(detail),
  }
  const multipart = {
    parse: jest.fn<Promise<unknown>, [unknown, (input: never) => Promise<unknown>]>()
      .mockImplementation(async (_request, handler) => handler({
        declaredMimeType: 'application/pdf',
        mediaType: 'DOCUMENT',
        originalFilename: 'proof.pdf',
        stream: new PassThrough(),
      } as never)),
  }
  const service = new PurchaseOrderDocumentService(
    prisma as unknown as PrismaService,
    media as unknown as MediaAssetService,
    delivery as unknown as MediaContentDeliveryService,
    audit as unknown as AuditService,
    query as unknown as PurchaseOrderQueryService,
    multipart as unknown as PurchaseOrderDocumentMultipartParser,
    retention as unknown as MediaAssetRetentionService,
  )
  return { audit, delivery, detail, media, multipart, prisma, retention, service, transaction }
}

const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

describe('PurchaseOrderDocumentService', () => {
  beforeEach(() => cancellation.deliverCancelledPurchaseOrderImage.mockReset())

  it.each(['ORDER_ISSUANCE_VOUCHER', 'DELIVERY_RECEIPT'])('archives %s without changing fulfillment or payments', async documentType => {
    const fixture = setup()
    fixture.transaction.purchaseOrderDocument.findFirst.mockResolvedValue(null)
    await expect(fixture.service.attach(context, ORDER_ID, {
      documentType, mediaAssetId: MEDIA_ID, remark: '归档说明',
    })).resolves.toEqual(fixture.detail)
    expect(fixture.transaction.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: {
        id: MEDIA_ID, createdByUserId: ACTOR_ID, status: 'UPLOADING',
        mediaType: { in: ['IMAGE', 'DOCUMENT'] }, deletedAt: null, objectKey: { not: null },
      },
      select: { id: true },
    })
    expect(fixture.transaction.purchaseOrderDocument.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ purchaseOrderId: ORDER_ID, paymentId: null, documentType, remark: '归档说明' }) as unknown,
    }))
    expect(fixture.media.activate).toHaveBeenCalledWith(fixture.transaction, MEDIA_ID)
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID }, data: { version: { increment: 1 } },
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction,
      expect.objectContaining({ eventType: 'PURCHASE_ORDER_DOCUMENT_ATTACHED' }))
  })

  it('rejects a second active purchase document before activating the uploaded asset', async () => {
    const fixture = setup()
    await expect(fixture.service.attach(context, ORDER_ID, {
      documentType: 'ORDER_ISSUANCE_VOUCHER', mediaAssetId: MEDIA_ID,
    })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS' })
    expect(fixture.media.activate).not.toHaveBeenCalled()
  })

  it('rejects unavailable or foreign uploads and standalone payment vouchers', async () => {
    const fixture = setup()
    fixture.transaction.mediaAsset.findFirst.mockResolvedValue(null)
    await expect(fixture.service.attach(context, ORDER_ID, {
      documentType: 'DELIVERY_RECEIPT', mediaAssetId: MEDIA_ID,
    })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE' })
    await expect(fixture.service.attach(context, ORDER_ID, {
      documentType: 'PAYMENT_VOUCHER', mediaAssetId: MEDIA_ID,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(fixture.transaction.purchaseOrderDocument.create).not.toHaveBeenCalled()
  })

  it('prepares an unassociated optional payment voucher', async () => {
    const fixture = setup()
    await expect(fixture.service.uploadTemporary(context, {} as never)).resolves.toEqual({
      mediaAssetId: MEDIA_ID,
      mediaType: 'DOCUMENT',
      mimeType: 'application/pdf',
      sizeBytes: '100',
      originalFilename: 'proof.pdf',
    })
    expect(fixture.media.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        allowedTypes: ['IMAGE', 'DOCUMENT'],
      }),
    )
  })

  it('retains a voucher linked to an actual payment', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrderDocument.findFirst.mockResolvedValue({ id: DOCUMENT_ID, documentType: 'PAYMENT_VOUCHER', mediaAssetId: MEDIA_ID, paymentId: 'payment' })
    await expect(fixture.service.detach(context, ORDER_ID, DOCUMENT_ID)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE' })
    expect(fixture.transaction.purchaseOrderDocument.update).not.toHaveBeenCalled()
  })

  it('soft-detaches a payment voucher and preserves the payment record', async () => {
    const fixture = setup()
    await expect(fixture.service.detach(
      context,
      ORDER_ID,
      DOCUMENT_ID,
    )).resolves.toEqual(fixture.detail)
    const updateInput = fixture.transaction.purchaseOrderDocument.update
      .mock.calls[0]?.[0] as {
        readonly where: { readonly id: string }
        readonly data: {
          readonly detachedAt: unknown
          readonly detachedByUserId: string
        }
      }
    expect(fixture.retention.markUnreferencedForTrash).toHaveBeenCalledWith(fixture.transaction, MEDIA_ID)
    expect(updateInput.where).toEqual({ id: DOCUMENT_ID })
    expect(updateInput.data.detachedAt).toBeInstanceOf(Date)
    expect(updateInput.data.detachedByUserId).toBe(ACTOR_ID)
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { version: { increment: 1 } },
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({ eventType: 'PURCHASE_ORDER_DOCUMENT_DETACHED' }),
    )
  })

  it('preserves a shared ready asset when another domain still references the detached voucher', async () => {
    const fixture = setup()
    fixture.retention.markUnreferencedForTrash.mockResolvedValue('ACTIVE_REFERENCE')
    await expect(fixture.service.detach(context, ORDER_ID, DOCUMENT_ID)).resolves.toEqual(fixture.detail)
  })

  it('aborts detachment when its media lifecycle changes concurrently', async () => {
    const fixture = setup()
    fixture.retention.markUnreferencedForTrash.mockResolvedValue('STATE_CONFLICT')
    await expect(fixture.service.detach(context, ORDER_ID, DOCUMENT_ID)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('resolves private content with stable headers and ETag', async () => {
    const fixture = setup()
    const response = await fixture.service.resolveContent(
      ORDER_ID,
      DOCUMENT_ID,
      undefined,
      'HEAD',
    )
    expect(response.status).toBe(200)
    expect(response.headers).toMatchObject({
      'Content-Type': 'application/pdf',
      'Content-Length': '100',
      'X-Content-Type-Options': 'nosniff',
    })
    expect(response.headers.ETag).toMatch(/^"sha256-/u)
    expect(fixture.delivery.open).not.toHaveBeenCalled()
  })

  it.each(['image/png', 'image/jpeg', 'image/webp'])('marks cancelled purchase order %s images through the protected delivery path', async mimeType => {
    const fixture = setup()
    const asset = { objectKey: 'assets/2026/09/order.png', checksumSha256: 'c'.repeat(64), sizeBytes: 100n, mimeType, originalFilename: '采购单.png' }
    fixture.prisma.purchaseOrderDocument.findFirst.mockResolvedValue({
      documentType: 'ORDER_ISSUANCE_VOUCHER', purchaseOrder: { orderStatus: 'CANCELLED' }, mediaAsset: asset,
    })
    const markedResponse = { status: 200, headers: { 'Content-Type': mimeType, ETag: '"cancelled-image"' }, stream: new PassThrough() }
    cancellation.deliverCancelledPurchaseOrderImage.mockResolvedValue(markedResponse)
    await expect(fixture.service.resolveContent(ORDER_ID, DOCUMENT_ID, '"original-image"', 'GET')).resolves.toBe(markedResponse)
    expect(cancellation.deliverCancelledPurchaseOrderImage).toHaveBeenCalledWith(fixture.delivery, asset, DOCUMENT_ID, '"original-image"', 'GET', mimeType)
    expect(fixture.prisma.purchaseOrderDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        documentType: true, purchaseOrder: { select: { orderStatus: true } },
        mediaAsset: { select: expect.objectContaining({ sizeBytes: true }) as unknown },
      }) as unknown,
    }))
    expect(fixture.delivery.open).not.toHaveBeenCalled()
  })

  it('forwards conditional HEAD requests to the cancellation-aware image delivery', async () => {
    const fixture = setup()
    const asset = { objectKey: 'assets/2026/09/order.png', checksumSha256: 'c'.repeat(64), sizeBytes: 100n, mimeType: 'image/png', originalFilename: '采购单.png' }
    fixture.prisma.purchaseOrderDocument.findFirst.mockResolvedValue({
      documentType: 'ORDER_ISSUANCE_VOUCHER', purchaseOrder: { orderStatus: 'CANCELLED' }, mediaAsset: asset,
    })
    cancellation.deliverCancelledPurchaseOrderImage.mockResolvedValue({ status: 304, headers: { ETag: '"cancelled-image"' } })
    await expect(fixture.service.resolveContent(ORDER_ID, DOCUMENT_ID, '"cancelled-image"', 'HEAD')).resolves.toMatchObject({ status: 304 })
    expect(cancellation.deliverCancelledPurchaseOrderImage).toHaveBeenCalledWith(fixture.delivery, asset, DOCUMENT_ID, '"cancelled-image"', 'HEAD', 'image/png')
  })

  it.each([
    ['CONFIRMED', 'ORDER_ISSUANCE_VOUCHER', 'image/png'],
    ['CANCELLED', 'PAYMENT_VOUCHER', 'image/png'],
    ['CANCELLED', 'DELIVERY_RECEIPT', 'image/png'],
    ['CANCELLED', 'ORDER_ISSUANCE_VOUCHER', 'application/pdf'],
  ])('preserves original content for %s / %s / %s', async (orderStatus, documentType, mimeType) => {
    const fixture = setup()
    fixture.prisma.purchaseOrderDocument.findFirst.mockResolvedValue({
      documentType, purchaseOrder: { orderStatus },
      mediaAsset: { objectKey: 'assets/2026/09/order.png', checksumSha256: 'c'.repeat(64), sizeBytes: 100n, mimeType, originalFilename: '采购单.png' },
    })
    await expect(fixture.service.resolveContent(ORDER_ID, DOCUMENT_ID, undefined, 'GET')).resolves.toMatchObject({ status: 200, headers: { 'Content-Type': mimeType } })
    expect(cancellation.deliverCancelledPurchaseOrderImage).not.toHaveBeenCalled()
    expect(fixture.delivery.open).toHaveBeenCalledWith('assets/2026/09/order.png')
  })
})
