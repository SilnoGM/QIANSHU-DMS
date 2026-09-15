import { randomUUID } from 'node:crypto'

import type { Prisma } from '../src/generated/prisma/client'
import type { PrismaService } from '../src/infrastructure/database/prisma.service'
import type { AuditService } from '../src/modules/audit/audit.service'
import type { MediaAssetService } from '../src/modules/media/media-asset.service'
import type { MediaContentDeliveryService } from '../src/modules/media/media-content-delivery.service'
import { MediaReconciliationPersistence } from '../src/modules/media/media-reconciliation.persistence'
import { MediaAssetReferenceRepository } from '../src/modules/media/media-reference.repository'
import { MediaAssetRetentionService } from '../src/modules/media/media-retention.service'
import type { MediaStorage } from '../src/modules/media/media-storage'
import { PurchaseOrderImageDraftService } from '../src/modules/purchase-orders/order-images/purchase-order-image-draft.service'
import type { PurchaseOrderImageRenderer } from '../src/modules/purchase-orders/order-images/purchase-order-image-renderer'
import { createPurchaseOrderImageSnapshot, hashPurchaseOrderImageSnapshot, PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION } from '../src/modules/purchase-orders/order-images/purchase-order-image-snapshot'
import type { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'

/** 旧业务回归只替代文件存在性；新图片生成和真实磁盘生命周期由独立 image-draft E2E 覆盖。 */
export function createImageReviewService(prisma: PrismaService, query: PurchaseOrderQueryService, audit: AuditService) {
  const delivery = { stat: async (objectKey: string) => {
    const asset = await prisma.mediaAsset.findUnique({ where: { objectKey } })
    return asset?.sizeBytes == null ? null : { sizeBytes: asset.sizeBytes, modifiedAt: asset.updatedAt }
  } } as unknown as MediaContentDeliveryService
  const retention = new MediaAssetRetentionService(new MediaReconciliationPersistence(prisma), new MediaAssetReferenceRepository(), {} as MediaStorage, { trashRetentionDays: 7 })
  return new PurchaseOrderImageDraftService(prisma, query, {} as PurchaseOrderImageRenderer, {} as MediaAssetService, delivery, retention, audit)
}

/** 在隔离 schema 中建立审核前置证据，仍受正式摘要校验、唯一性、引用和审核事务约束。 */
export async function createImageReviewDraft(prisma: PrismaService, query: PurchaseOrderQueryService, actorUserId: string, purchaseOrderId: string) {
  return prisma.$transaction(async transaction => {
    const detail = await query.getById(purchaseOrderId, transaction)
    const snapshot = createPurchaseOrderImageSnapshot(detail)
    const asset = await transaction.mediaAsset.create({ data: {
      mediaType: 'IMAGE', status: 'READY', storageDriver: 'local', objectKey: `assets/${randomUUID()}.png`,
      originalFilename: 'review-fixture.png', mimeType: 'image/png', sizeBytes: 1n, checksumSha256: '0'.repeat(64),
      width: 1, height: 1, createdByUserId: actorUserId,
    } })
    const draft = await transaction.purchaseOrderImageDraft.create({ data: {
      purchaseOrderId, mediaAssetId: asset.id, orderVersion: detail.version,
      snapshotHash: hashPurchaseOrderImageSnapshot(snapshot), templateVersion: PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION,
      snapshot: snapshot as unknown as Prisma.InputJsonObject, generatedByUserId: actorUserId,
    } })
    return { expectedVersion: detail.version, imageDraftId: draft.id }
  })
}
