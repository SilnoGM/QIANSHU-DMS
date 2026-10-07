import { Readable } from 'node:stream'

import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { AuditService } from '../../audit/audit.service'
import type { MediaAssetService } from '../../media/media-asset.service'
import type { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import type { SalesOrderQueryService } from '../sales-order-query.service'
import type { SalesOrderAutomaticStateService } from '../sales-order-automatic-state.service'
import type { SalesOrderDocumentMultipartParser } from './sales-order-document-multipart.parser'
import { SalesOrderDocumentService } from './sales-order-document.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DOCUMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEDIA_ASSET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function setup(
  documentType = 'DELIVERY_RECEIPT',
  fulfillmentStatus = 'SEA_TRANSIT',
  orderStatus = 'CONFIRMED',
  parser: SalesOrderDocumentMultipartParser = {} as SalesOrderDocumentMultipartParser,
) {
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: ORDER_ID, fulfillmentStatus }]),
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({
          id: ORDER_ID,
          customerName: '王小明',
          fulfillmentStatus,
          orderStatus,
        }),
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
  const automaticState = {
    advanceToPendingReconciliationWhenEligible:
      jest.fn<Promise<boolean>, [unknown, unknown, string, string]>()
        .mockResolvedValue(false),
  }
  const service = new SalesOrderDocumentService(
    prisma as unknown as PrismaService,
    media as unknown as MediaAssetService,
    {} as MediaContentDeliveryService,
    audit as unknown as AuditService,
    query as unknown as SalesOrderQueryService,
    parser,
    automaticState as unknown as SalesOrderAutomaticStateService,
  )
  return { audit, automaticState, detail, media, query, service, transaction }
}

const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

describe('SalesOrderDocumentService', () => {
  it.each([
    [null, 'sales'],
    ['PAYMENT_VOUCHER', 'voucher'],
  ] as const)(
    'lands a temporary upload with purpose %s in the %s pool',
    async (purpose, expectedPool) => {
      const prepare = jest.fn().mockResolvedValue({
        id: MEDIA_ASSET_ID,
        mediaType: 'IMAGE',
        objectKey: `assets/dev/${expectedPool}/2026/10/${MEDIA_ASSET_ID}.png`,
        trustedMetadata: {
          canonicalExtension: '.png',
          checksumSha256: 'a'.repeat(64),
          mediaType: 'IMAGE',
          mimeType: 'image/png',
          sizeBytes: 3n,
        },
      })
      const parser = {
        parse: async (
          _request: unknown,
          handler: (input: unknown) => Promise<unknown>,
        ) => handler({
          declaredMimeType: 'image/png',
          mediaType: 'IMAGE',
          originalFilename: 'voucher.png',
          purpose,
          stream: Readable.from([Buffer.from('abc')]),
        }),
      } as unknown as SalesOrderDocumentMultipartParser
      const fixture = setup('DELIVERY_RECEIPT', 'SEA_TRANSIT', 'CONFIRMED', parser)
      Object.assign(fixture.media, { prepare })

      // 请求替身用真实 Readable：多字段解析器只读 headers，其它成员由流本体补齐。
      await fixture.service.uploadTemporary(
        context,
        Object.assign(Readable.from([Buffer.from('')]), { headers: {} }),
      )

      // 用途只影响键布局：权限与敏感级仍由服务端按业务主体独立校验。
      expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ pool: expectedPool }))
    },
  )

  it('atomically creates one delivery receipt and advances sea transit to signed', async () => {
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
      data: {
        fulfillmentStatus: 'SIGNED',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        salesOrderId: ORDER_ID,
        dimension: 'FULFILLMENT',
        fromStatus: 'SEA_TRANSIT',
        toStatus: 'SIGNED',
        reason: '业务人员上传签收单后自动确认签收',
        changedByUserId: ACTOR_ID,
      },
    })
    expect(fixture.audit.record).toHaveBeenNthCalledWith(2, fixture.transaction, {
      eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: ACTOR_ID,
      targetType: 'SALES_ORDER',
      targetId: ORDER_ID,
      requestId: 'request-1',
      metadata: { fromStatus: 'SEA_TRANSIT', toStatus: 'SIGNED' },
    })
    expect(fixture.automaticState.advanceToPendingReconciliationWhenEligible)
      .toHaveBeenCalledWith(
        fixture.transaction,
        context,
        ORDER_ID,
        'DELIVERY_RECEIPT',
      )
  })

  it('does not return a successful detail when receipt-derived state fails', async () => {
    const fixture = setup()
    fixture.automaticState.advanceToPendingReconciliationWhenEligible
      .mockRejectedValue(new Error('automatic-state-failed'))

    await expect(fixture.service.submitDeliveryReceipt(
      context,
      ORDER_ID,
      { mediaAssetId: MEDIA_ASSET_ID, remark: null },
    )).rejects.toThrow('automatic-state-failed')
    expect(fixture.query.getById).not.toHaveBeenCalled()
  })

  it.each([
    ['WAREHOUSE_ARRIVED', 'CONFIRMED', 'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID'],
    ['SEA_TRANSIT', 'CANCELLED', 'SALES_ORDER_CANCELLED'],
    ['SEA_TRANSIT', 'COMPLETED', 'SALES_ORDER_COMPLETED'],
  ])(
    'rejects receipt submission before media activation when fulfillment=%s order=%s',
    async (fulfillmentStatus, orderStatus, code) => {
      const fixture = setup('DELIVERY_RECEIPT', fulfillmentStatus, orderStatus)

      await expect(fixture.service.submitDeliveryReceipt(
        context,
        ORDER_ID,
        { mediaAssetId: MEDIA_ASSET_ID, remark: null },
      )).rejects.toMatchObject({ code })

      expect(fixture.media.activate).not.toHaveBeenCalled()
      expect(fixture.transaction.salesOrderDocument.create).not.toHaveBeenCalled()
      expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
      expect(fixture.transaction.salesOrderStatusHistory.create).not.toHaveBeenCalled()
      expect(fixture.audit.record).not.toHaveBeenCalled()
    },
  )

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
