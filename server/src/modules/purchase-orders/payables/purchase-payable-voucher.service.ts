import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { PurchaseOrderDocumentService } from '../documents/purchase-order-document.service'
import type { PurchaseOrderDocumentMultipartRequest } from '../documents/purchase-order-document-multipart.parser'
import type { PurchaseOrderMutationContext } from '../purchase-order-mutation.service'
import { payableFailure, summarizePayable } from './purchase-payable.logic'

@Injectable()
export class PurchasePayableVoucherService {
  constructor(private readonly prisma: PrismaService, private readonly documents: PurchaseOrderDocumentService) {}

  async upload(context: PurchaseOrderMutationContext, payableId: string, request: PurchaseOrderDocumentMultipartRequest) {
    const payable = await this.prisma.purchaseOrderPayable.findUnique({ where: { id: payableId }, include: {
      payments: { where: { voidedAt: null }, select: { amount: true } }, purchaseOrder: { select: { orderStatus: true } },
    } })
    if (!payable) return payableFailure('PURCHASE_PAYABLE_NOT_FOUND', '采购应付款不存在', 404)
    const status = summarizePayable(payable.dueAmount.toFixed(2), payable.payments.map(payment => payment.amount.toFixed(2)), payable.closedAt !== null).status
    if (status !== 'PENDING_PAYMENT' || payable.purchaseOrder.orderStatus !== 'CONFIRMED') return payableFailure('PURCHASE_PAYABLE_STATE_CHANGED', '该款项当前不可付款，请刷新核对', 409)
    const uploaded = await this.documents.uploadTemporary(context, request, { purpose: 'PURCHASE_PAYMENT_VOUCHER', payableId })
    return { ...uploaded, mediaType: 'IMAGE' as const }
  }

  async content(payableId: string, documentId: string, ifNoneMatch: unknown, method: 'GET' | 'HEAD') {
    // 财务只有付款权限时也能查看本笔凭证；不能通过此入口读取其他订单附件。
    const document = await this.prisma.purchaseOrderDocument.findFirst({ where: {
      id: documentId, documentType: 'PAYMENT_VOUCHER', detachedAt: null, payment: { payableId },
    }, select: { purchaseOrderId: true } })
    if (!document) return payableFailure('PURCHASE_ORDER_DOCUMENT_NOT_FOUND', '付款凭证不存在', 404)
    return this.documents.resolveContent(document.purchaseOrderId, documentId, ifNoneMatch, method)
  }
}
