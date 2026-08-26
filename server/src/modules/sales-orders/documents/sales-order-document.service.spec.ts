import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { AuditService } from '../../audit/audit.service'
import type { MediaAssetService } from '../../media/media-asset.service'
import type { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import type { SalesOrderQueryService } from '../sales-order-query.service'
import type { SalesOrderDocumentMultipartParser } from './sales-order-document-multipart.parser'
import { SalesOrderDocumentService } from './sales-order-document.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DOCUMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEDIA_ASSET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function setup(documentType = 'DELIVERY_RECEIPT') {
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: ORDER_ID, fulfillmentStatus: 'SEA_TRANSIT' }]),
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: ORDER_ID, customerName: '王小明' }),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    mediaAsset: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        id: MEDIA_ASSET_ID,
        createdAt: new Date('2026-08-20T01:02:03.004Z'),
      }),
    },
    salesOrderDocument: {
      create: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: DOCUMENT_ID }),
      findFirst: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: DOCUMENT_ID, documentType }),
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(2),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
  }
  const prisma = {
    $transaction: jest.fn<
      Promise<unknown>,
      [(tx: typeof transaction) => Promise<unknown>]
    >(callback => callback(transaction)),
    salesOrderDocument: { findFirst: jest.fn() },
  }
  const media = {
    activate: jest.fn<Promise<void>, [unknown, string]>()
      .mockResolvedValue(undefined),
  }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const detail = { id: ORDER_ID }
  const query = {
    getById: jest.fn<Promise<typeof detail>, [string]>().mockResolvedValue(detail),
  }
  const service = new SalesOrderDocumentService(
    prisma as unknown as PrismaService,
    media as unknown as MediaAssetService,
    {} as MediaContentDeliveryService,
    audit as unknown as AuditService,
    query as unknown as SalesOrderQueryService,
    {} as SalesOrderDocumentMultipartParser,
  )
  return { audit, detail, media, service, transaction }
}

const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

describe('SalesOrderDocumentService', () => {
  it('creates one order-level delivery receipt without changing fulfillment state', async () => {
    const fixture = setup()

    await expect(fixture.service.submitDeliveryReceipt(
      context,
      ORDER_ID,
      { mediaAssetId: MEDIA_ASSET_ID, remark: '  外箱完好，数量已核对  ' },
    )).resolves.toEqual(fixture.detail)

    expect(fixture.media.activate).toHaveBeenCalledWith(
      fixture.transaction,
      MEDIA_ASSET_ID,
    )
    expect(fixture.transaction.salesOrderDocument.create).toHaveBeenCalledWith({
      data: {
        salesOrderId: ORDER_ID,
        mediaAssetId: MEDIA_ASSET_ID,
        paymentId: null,
        documentType: 'DELIVERY_RECEIPT',
        title: '王小明-签收单-20260820090203004',
        remark: '外箱完好,数量已核对',
        createdByUserId: ACTOR_ID,
      },
      select: { id: true },
    })
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { version: { increment: 1 } },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).not.toHaveBeenCalled()
  })

  it('rejects extra receipt fields and protects issuance/payment vouchers from detachment', async () => {
    const invalid = setup()
    await expect(invalid.service.submitDeliveryReceipt(context, ORDER_ID, {
      mediaAssetId: MEDIA_ASSET_ID,
      signedAt: '2026-08-20T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    await expect(invalid.service.submitDeliveryReceipt(context, ORDER_ID, {
      mediaAssetId: MEDIA_ASSET_ID,
      remark: '签'.repeat(501),
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    for (const documentType of ['ORDER_ISSUANCE_VOUCHER', 'PAYMENT_VOUCHER']) {
      const protectedDocument = setup(documentType)
      await expect(protectedDocument.service.detach(
        context,
        ORDER_ID,
        DOCUMENT_ID,
      )).rejects.toMatchObject({ code: 'SALES_ORDER_DOCUMENT_REQUIRED' })
      expect(protectedDocument.transaction.salesOrderDocument.update)
        .not.toHaveBeenCalled()
    }
  })
})
