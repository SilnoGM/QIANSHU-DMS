import type { Prisma } from '../../generated/prisma/client'
import {
  MEDIA_ASSET_REFERENCE_TABLES,
  MediaAssetReferenceRepository,
} from './media-reference.repository'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'

describe('MediaAssetReferenceRepository', () => {
  it.each(['paymentRecipientAccount', 'purchaseOrderPayment', 'containerBatch', 'slhBill'])('retains recipient code through %s even after configuration changes', async target => {
    const reader = Object.fromEntries(['productMedia', 'salesOrderDocument', 'purchaseOrderDocument', 'salesReceiptRequest', 'purchaseOrderImageDraft', 'packagingCostRequest', 'paymentRecipientAccount', 'purchaseOrderPayment', 'containerBatch', 'slhBill', 'invoiceRequest']
      .map(name => [name, { findFirst: jest.fn().mockResolvedValue(name === target ? { id: 'reference' } : null) }])) as unknown as Prisma.TransactionClient
    await expect(new MediaAssetReferenceRepository().hasActiveReferences(reader, ASSET_ID)).resolves.toBe(true)
  })
  it('protects a current purchase image draft after the review modal is closed', async () => {
    const draft = jest.fn().mockResolvedValue({ id: 'draft' })
    const reader = {
      productMedia: { findFirst: jest.fn().mockResolvedValue(null) },
      salesOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      salesReceiptRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderImageDraft: { findFirst: draft },
    } as unknown as Prisma.TransactionClient
    await expect(new MediaAssetReferenceRepository().hasActiveReferences(reader, ASSET_ID)).resolves.toBe(true)
    expect(draft).toHaveBeenCalledWith({ where: { mediaAssetId: ASSET_ID, invalidatedAt: null, archivedAt: null }, select: { id: true } })
  })
  it('retains a receipt voucher even when the request is rejected', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'rejected-request' })
    const reader = {
      productMedia: { findFirst: jest.fn().mockResolvedValue(null) },
      salesOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      salesReceiptRequest: { findFirst },
    } as unknown as Prisma.TransactionClient
    await expect(new MediaAssetReferenceRepository().hasActiveReferences(reader, ASSET_ID)).resolves.toBe(true)
    expect(findFirst).toHaveBeenCalledWith({ where: { voucherMediaAssetId: ASSET_ID }, select: { id: true } })
  })
  it('keeps the invoice document as evidence after the request is cancelled', async () => {
    const invoiceRequest = jest.fn().mockResolvedValue({ id: 'cancelled-invoice-request' })
    const reader = {
      productMedia: { findFirst: jest.fn().mockResolvedValue(null) },
      salesOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      salesReceiptRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderImageDraft: { findFirst: jest.fn().mockResolvedValue(null) },
      packagingCostRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentRecipientAccount: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      containerBatch: { findFirst: jest.fn().mockResolvedValue(null) },
      slhBill: { findFirst: jest.fn().mockResolvedValue(null) },
      invoiceRequest: { findFirst: invoiceRequest },
    } as unknown as Prisma.TransactionClient
    await expect(new MediaAssetReferenceRepository().hasActiveReferences(reader, ASSET_ID)).resolves.toBe(true)
    expect(invoiceRequest).toHaveBeenCalledWith({ where: { documentMediaAssetId: ASSET_ID }, select: { id: true } })
  })
  it('explicitly checks every implemented active media reference', async () => {
    const productMediaFindFirst = jest.fn().mockResolvedValue(null)
    const salesOrderDocumentFindFirst = jest.fn().mockResolvedValue(null)
    const purchaseOrderDocumentFindFirst = jest.fn().mockResolvedValue({
      id: 'reference-id',
    })
    const reader = {
      productMedia: { findFirst: productMediaFindFirst },
      salesOrderDocument: { findFirst: salesOrderDocumentFindFirst },
      purchaseOrderDocument: { findFirst: purchaseOrderDocumentFindFirst },
    } as unknown as Prisma.TransactionClient
    const repository = new MediaAssetReferenceRepository()

    await expect(repository.hasActiveReferences(reader, ASSET_ID)).resolves.toBe(true)

    expect(MEDIA_ASSET_REFERENCE_TABLES).toEqual([
      'product_media',
      'sales_order_documents',
      'purchase_order_documents',
      'sales_receipt_requests',
      'purchase_order_image_drafts',
      'packaging_cost_requests',
      'payment_recipient_accounts',
      'purchase_order_payments',
      'container_batches',
      'slh_bills',
      'invoice_requests',
    ])
    expect(productMediaFindFirst).toHaveBeenCalledWith({
      where: {
        detachedAt: null,
        mediaAssetId: ASSET_ID,
      },
      select: { id: true },
    })
    expect(salesOrderDocumentFindFirst).toHaveBeenCalledWith({
      where: {
        detachedAt: null,
        mediaAssetId: ASSET_ID,
      },
      select: { id: true },
    })
    expect(purchaseOrderDocumentFindFirst).toHaveBeenCalledWith({
      where: {
        detachedAt: null,
        mediaAssetId: ASSET_ID,
      },
      select: { id: true },
    })
  })

  it.each(['packagingImageMediaAssetId', 'quotationImageMediaAssetId'])('protects immutable packaging evidence referenced as %s', field => {
    const packaging = jest.fn().mockImplementation(({ where }: { where: { OR: Record<string, string>[] } }) => Promise.resolve(where.OR.some(filter => filter[field] === ASSET_ID) ? { id: 'packaging' } : null))
    const reader = {
      productMedia: { findFirst: jest.fn().mockResolvedValue(null) }, salesOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) }, salesReceiptRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderImageDraft: { findFirst: jest.fn().mockResolvedValue(null) }, packagingCostRequest: { findFirst: packaging },
    } as unknown as Prisma.TransactionClient
    return expect(new MediaAssetReferenceRepository().hasActiveReferences(reader, ASSET_ID)).resolves.toBe(true)
  })

  it('returns false when no implemented domain has an active reference', async () => {
    const reader = {
      productMedia: { findFirst: jest.fn().mockResolvedValue(null) },
      salesOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      salesReceiptRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderImageDraft: { findFirst: jest.fn().mockResolvedValue(null) },
      packagingCostRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentRecipientAccount: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      containerBatch: { findFirst: jest.fn().mockResolvedValue(null) },
      slhBill: { findFirst: jest.fn().mockResolvedValue(null) },
      invoiceRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as Prisma.TransactionClient

    await expect(
      new MediaAssetReferenceRepository().hasActiveReferences(reader, ASSET_ID),
    ).resolves.toBe(false)
  })
})
