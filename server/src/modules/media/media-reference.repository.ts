import type { Prisma } from '../../generated/prisma/client'

/**
 * 当前系统真正实现的媒体领域引用表。
 *
 * 该常量同时被 contract test 与数据库 Trigger 测试校验。未来增加订单、采购或仓库媒体关联表时，
 * 必须在同一交付中扩展这里和数据库 Trigger，不能让新引用绕过回收保护。
 */
export const MEDIA_ASSET_REFERENCE_TABLES = Object.freeze([
  'product_media',
  'sales_order_documents',
  'purchase_order_documents',
  'sales_receipt_requests',
  'purchase_order_image_drafts',
  'packaging_cost_requests',
  'payment_recipient_accounts',
  'purchase_order_payments',
] as const)

type MediaReferenceReader = Pick<
  Prisma.TransactionClient,
  'productMedia' | 'salesOrderDocument' | 'purchaseOrderDocument' | 'salesReceiptRequest' | 'purchaseOrderImageDraft' | 'packagingCostRequest' | 'paymentRecipientAccount' | 'purchaseOrderPayment'
>

/**
 * 媒体基础设施只通过显式领域表判断引用，不使用多态 owner 或动态注册表。
 */
export class MediaAssetReferenceRepository {
  async hasActiveReferences(
    reader: MediaReferenceReader,
    assetId: string,
  ): Promise<boolean> {
    const productReference = await reader.productMedia.findFirst({
      where: {
        detachedAt: null,
        mediaAssetId: assetId,
      },
      select: { id: true },
    })
    if (productReference !== null) return true

    const salesOrderReference = await reader.salesOrderDocument.findFirst({
      where: {
        detachedAt: null,
        mediaAssetId: assetId,
      },
      select: { id: true },
    })
    if (salesOrderReference !== null) return true

    const purchaseOrderReference = await reader.purchaseOrderDocument.findFirst({
      where: {
        detachedAt: null,
        mediaAssetId: assetId,
      },
      select: { id: true },
    })
    if (purchaseOrderReference !== null) return true

    // 驳回也必须保留原始收款证据，不能按审核状态排除引用。
    const receiptReference = await reader.salesReceiptRequest.findFirst({
      where: { voucherMediaAssetId: assetId },
      select: { id: true },
    })
    if (receiptReference !== null) return true
    const imageDraftReference = await reader.purchaseOrderImageDraft.findFirst({
      where: { mediaAssetId: assetId, invalidatedAt: null, archivedAt: null },
      select: { id: true },
    })
    if (imageDraftReference !== null) return true
    const packagingReference = await reader.packagingCostRequest.findFirst({
      where: { OR: [{ packagingImageMediaAssetId: assetId }, { quotationImageMediaAssetId: assetId }] },
      select: { id: true },
    })
    if (packagingReference !== null) return true
    // 停用的收款配置仍保留；换码之后，历史付款快照单独持有当时的二维码。
    const recipientReference = await reader.paymentRecipientAccount.findFirst({ where: { qrMediaAssetId: assetId }, select: { id: true } })
    if (recipientReference !== null) return true
    return await reader.purchaseOrderPayment.findFirst({ where: { recipientQrMediaAssetId: assetId }, select: { id: true } }) !== null
  }
}
