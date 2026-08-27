import { PassThrough } from 'node:stream'

import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { AuditService } from '../../audit/audit.service'
import type { MediaAssetService } from '../../media/media-asset.service'
import type { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import type { PurchaseOrderQueryService } from '../purchase-order-query.service'
import type {
  PurchaseOrderDocumentMultipartParser,
} from './purchase-order-document-multipart.parser'
import { PurchaseOrderDocumentService } from './purchase-order-document.service'

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
        documentType: 'PAYMENT_VOUCHER',
      }),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
  }
  const prisma = {
    $transaction: jest.fn<
      Promise<unknown>,
      [(tx: typeof transaction) => Promise<unknown>]
    >(callback => callback(transaction)),
    purchaseOrderDocument: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        mediaAsset: {
          checksumSha256: 'a'.repeat(64),
          mimeType: 'application/pdf',
          objectKey: 'assets/2026/08/proof.pdf',
          originalFilename: '付款凭证.pdf',
        },
      }),
    },
  }
  const media = {
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
  )
  return { audit, delivery, detail, media, multipart, prisma, service, transaction }
}

const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

describe('PurchaseOrderDocumentService', () => {
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
})
