import { Prisma } from '../../../generated/prisma/client'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { PurchaseOrderDocumentService } from '../documents/purchase-order-document.service'
import type { PurchaseOrderDocumentMultipartRequest } from '../documents/purchase-order-document-multipart.parser'
import { PurchasePayableVoucherService } from './purchase-payable-voucher.service'

function setup() {
  const payable = { dueAmount: new Prisma.Decimal(10), closedAt: null, payments: [], purchaseOrder: { orderStatus: 'CONFIRMED' } }
  const prisma = { purchaseOrderPayable: { findUnique: jest.fn().mockResolvedValue(payable) }, purchaseOrderDocument: { findFirst: jest.fn().mockResolvedValue({ purchaseOrderId: 'order' }) } }
  const documents = { uploadTemporary: jest.fn().mockResolvedValue({ mediaAssetId: 'image', mediaType: 'IMAGE' }), resolveContent: jest.fn().mockResolvedValue({ status: 200, headers: {} }) }
  return { prisma, documents, service: new PurchasePayableVoucherService(prisma as unknown as PrismaService, documents as unknown as PurchaseOrderDocumentService) }
}
describe('PurchasePayableVoucherService', () => {
  it('uploads an image with a dedicated purpose only for an outstanding confirmed installment', async () => {
    const h = setup(), context = { actorUserId: 'payer', requestId: 'request' }, request = {} as PurchaseOrderDocumentMultipartRequest
    await expect(h.service.upload(context, 'payable', request)).resolves.toEqual({ mediaAssetId: 'image', mediaType: 'IMAGE' })
    expect(h.documents.uploadTemporary).toHaveBeenCalledWith(context, request, { purpose: 'PURCHASE_PAYMENT_VOUCHER', payableId: 'payable' })
  })
  it.each([null, { dueAmount: new Prisma.Decimal(0), payments: [], closedAt: null, purchaseOrder: { orderStatus: 'CONFIRMED' } }, { dueAmount: new Prisma.Decimal(10), payments: [{ amount: new Prisma.Decimal(10) }], closedAt: null, purchaseOrder: { orderStatus: 'CONFIRMED' } }])('refuses upload for missing or terminal installments', async payable => {
    const h = setup()
    h.prisma.purchaseOrderPayable.findUnique.mockResolvedValue(payable)
    await expect(h.service.upload({ actorUserId: 'payer', requestId: 'request' }, 'payable', {} as PurchaseOrderDocumentMultipartRequest)).rejects.toMatchObject({ code: payable ? 'PURCHASE_PAYABLE_STATE_CHANGED' : 'PURCHASE_PAYABLE_NOT_FOUND' })
    expect(h.documents.uploadTemporary).not.toHaveBeenCalled()
  })
  it('requires the exact payment-to-voucher association before delivering content', async () => {
    const h = setup()
    await h.service.content('payable', 'document', undefined, 'GET')
    expect(h.prisma.purchaseOrderDocument.findFirst).toHaveBeenCalledWith({ where: { id: 'document', documentType: 'PAYMENT_VOUCHER', detachedAt: null, payment: { payableId: 'payable' } }, select: { purchaseOrderId: true } })
    expect(h.documents.resolveContent).toHaveBeenCalledWith('order', 'document', undefined, 'GET')
    h.prisma.purchaseOrderDocument.findFirst.mockResolvedValue(null)
    await expect(h.service.content('other-payable', 'document', undefined, 'GET')).rejects.toMatchObject({ code: 'PURCHASE_ORDER_DOCUMENT_NOT_FOUND' })
    expect(h.documents.resolveContent).toHaveBeenCalledTimes(1)
  })
})
