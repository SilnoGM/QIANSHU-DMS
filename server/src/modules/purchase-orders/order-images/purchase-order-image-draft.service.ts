import { Readable } from 'node:stream'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { AuditActorType, AuditEventType, AuditOutcome } from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../../infrastructure/database/persistence-error-facts'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AuditService, AuditWriteFailedError } from '../../audit/audit.service'
import { MediaAssetLifecycleError, MediaAssetService } from '../../media/media-asset.service'
import { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { MediaAssetRetentionService } from '../../media/media-retention.service'
import { requireMediaObjectKeyNamespace } from '../../media/media-storage'
import { purchaseOrderRuleFailure } from '../domain/purchase-order-errors'
import type { PurchaseOrderDocumentContentResponse } from '../documents/purchase-order-document.service'
import type { PurchaseOrderMutationContext } from '../purchase-order-mutation.service'
import { PurchaseOrderQueryService, type PurchaseOrderDetail } from '../purchase-order-query.service'
import { deliverPurchaseOrderImage, readPurchaseOrderImageThumbnails } from './purchase-order-image-assets'
import { deliverCancelledPurchaseOrderImage } from './purchase-order-image-cancellation'
import type { PurchaseOrderImageDraftDto, PurchaseOrderImageDraftResponseDto } from './purchase-order-image-draft.dto'
import { normalizePurchaseOrderImageDraftInput, requirePurchaseOrderImageContext, requirePurchaseOrderImageUuid } from './purchase-order-image-draft.normalizer'
import { PurchaseOrderImageRenderer } from './purchase-order-image-renderer'
import { createPurchaseOrderImageSnapshot, hashPurchaseOrderImageSnapshot, PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION } from './purchase-order-image-snapshot'

const DRAFT_SELECT = {
  id: true, purchaseOrderId: true, mediaAssetId: true, orderVersion: true,
  snapshotHash: true, templateVersion: true, createdAt: true, invalidatedAt: true, archivedAt: true,
  generatedBy: { select: { id: true, displayName: true } },
  purchaseOrder: { select: { orderStatus: true } },
  mediaAsset: { select: { status: true, deletedAt: true, mimeType: true, objectKey: true, checksumSha256: true, sizeBytes: true } },
} as const satisfies Prisma.PurchaseOrderImageDraftSelect

type DraftRow = Prisma.PurchaseOrderImageDraftGetPayload<{ select: typeof DRAFT_SELECT }>
const CURRENT_DRAFT = { invalidatedAt: null, archivedAt: null } as const

function assertReviewable(detail: PurchaseOrderDetail, expectedVersion?: number): void {
  if (expectedVersion !== undefined && detail.version !== expectedVersion) {
    throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '采购订单已变更，请刷新后重试')
  }
  if (detail.orderStatus !== 'PENDING_REVIEW') return purchaseOrderRuleFailure('PURCHASE_ORDER_IMAGE_NOT_ALLOWED', '当前采购订单不允许生成或使用待审核图片')
}

function assertMarks(detail: PurchaseOrderDetail): void {
  const parts = detail.parts.filter(part => part.status !== 'CANCELLED')
  if (!detail.shippingMarkText?.trim() || parts.length === 0 || parts.some(part => !part.shippingMarkText?.trim() || !part.shipmentNo?.trim())) {
    return purchaseOrderRuleFailure('PURCHASE_ORDER_IMAGE_MARKS_REQUIRED', '请先申请并派发采购单及货件唛头')
  }
}

function isReady(row: DraftRow): boolean {
  return row.mediaAsset.status === 'READY' && row.mediaAsset.deletedAt === null && row.mediaAsset.mimeType === 'image/png' && row.mediaAsset.objectKey !== null && row.mediaAsset.checksumSha256 !== null
}

function isMatching(row: DraftRow, detail: PurchaseOrderDetail, snapshotHash: string): boolean {
  return row.invalidatedAt === null && row.archivedAt === null && row.orderVersion === detail.version && row.templateVersion === PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION && row.snapshotHash === snapshotHash && isReady(row)
}

function toDto(row: DraftRow, isCurrent: boolean): PurchaseOrderImageDraftDto {
  return {
    id: row.id, purchaseOrderId: row.purchaseOrderId, orderVersion: row.orderVersion,
    templateVersion: row.templateVersion, generatedAt: row.createdAt.toISOString(), generatedBy: row.generatedBy,
    contentUrl: `/api/purchase-orders/${row.purchaseOrderId}/order-image-drafts/${row.id}/content`, isCurrent,
  }
}

function mapGenerationError(error: unknown): never {
  if (error instanceof ApiException) throw error
  const facts = readPersistenceErrorFacts(error)
  if ((error instanceof AuditWriteFailedError && error.transactionConflict) || ['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
    throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '采购订单状态已变化，请刷新后重试')
  }
  if ((error instanceof MediaAssetLifecycleError && error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') || (error instanceof Error && 'code' in error && error.code === 'PURCHASE_ORDER_IMAGE_TOO_LARGE')) {
    return purchaseOrderRuleFailure('PURCHASE_ORDER_IMAGE_TOO_LARGE', '采购单内容超过单张图片可读尺寸，请调整后重试')
  }
  throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE', '采购单图片生成失败，请重试')
}

@Injectable()
export class PurchaseOrderImageDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: PurchaseOrderQueryService,
    private readonly renderer: PurchaseOrderImageRenderer,
    private readonly media: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly retention: MediaAssetRetentionService,
    private readonly audit: AuditService,
  ) {}

  async getDraft(rawPurchaseOrderId: unknown): Promise<PurchaseOrderImageDraftResponseDto> {
    const purchaseOrderId = requirePurchaseOrderImageUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const detail = await this.query.getById(purchaseOrderId)
    const row = await this.prisma.purchaseOrderImageDraft.findFirst({ where: { purchaseOrderId, ...CURRENT_DRAFT }, select: DRAFT_SELECT })
    if (row === null) return { draft: null }
    let isCurrent = false
    try {
      assertReviewable(detail)
      assertMarks(detail)
      isCurrent = isMatching(row, detail, hashPurchaseOrderImageSnapshot(createPurchaseOrderImageSnapshot(detail)))
    }
    catch {
      // 过期草稿仍可供用户查看；只有重新生成后才能用于当前版本的审核。
    }
    return { draft: toDto(row, isCurrent) }
  }

  async generate(context: PurchaseOrderMutationContext, rawPurchaseOrderId: unknown, input: unknown): Promise<PurchaseOrderImageDraftDto> {
    requirePurchaseOrderImageContext(context)
    const purchaseOrderId = requirePurchaseOrderImageUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const command = normalizePurchaseOrderImageDraftInput(input)
    const detail = await this.query.getById(purchaseOrderId)
    assertReviewable(detail, command.expectedVersion)
    assertMarks(detail)
    let snapshot: ReturnType<typeof createPurchaseOrderImageSnapshot>
    try { snapshot = createPurchaseOrderImageSnapshot(detail) }
    catch (error) { return mapGenerationError(error) }
    const snapshotHash = hashPurchaseOrderImageSnapshot(snapshot)
    const previous = await this.prisma.purchaseOrderImageDraft.findFirst({ where: { purchaseOrderId, ...CURRENT_DRAFT }, select: DRAFT_SELECT })
    if (!command.regenerate && previous !== null && isMatching(previous, detail, snapshotHash)) {
      await this.assertFileAvailable(previous)
      return toDto(previous, true)
    }
    let preparedId: string | undefined
    let usedPrepared = false
    try {
      // 渲染、图片解码与文件准备在事务外进行；订单行锁只覆盖最后复核和持久化。
      const images = await readPurchaseOrderImageThumbnails(this.prisma, this.delivery, snapshot)
      const image = await this.renderer.render(snapshot, images)
      const prepared = await this.media.prepare({
        actorUserId: context.actorUserId, allowedTypes: ['IMAGE'], requestedType: 'IMAGE',
        declaredMimeType: 'image/png', originalFilename: `采购单-${detail.orderNo.replaceAll('/', '-')}.png`, pool: 'purchase', stream: Readable.from(image),
      })
      preparedId = prepared.id
      const result = await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const locks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "purchase_orders" WHERE "id" = CAST(${purchaseOrderId} AS uuid) FOR UPDATE`)
        if (locks.length !== 1) throw new ApiException(HttpStatus.NOT_FOUND, 'PURCHASE_ORDER_NOT_FOUND', '采购订单不存在')
        const currentDetail = await this.query.getById(purchaseOrderId, transaction)
        assertReviewable(currentDetail, command.expectedVersion)
        assertMarks(currentDetail)
        if (hashPurchaseOrderImageSnapshot(createPurchaseOrderImageSnapshot(currentDetail)) !== snapshotHash) {
          return purchaseOrderRuleFailure('PURCHASE_ORDER_IMAGE_STALE', '采购订单内容已变更，请重新生成图片')
        }
        const current = await transaction.purchaseOrderImageDraft.findFirst({ where: { purchaseOrderId, ...CURRENT_DRAFT }, select: DRAFT_SELECT })
        // 相同内容的并发生成只保留先完成的草稿；重试不会因为两个请求先后落锁而反复替换。
        if (current !== null && isMatching(current, currentDetail, snapshotHash) && (!command.regenerate || current.id !== previous?.id)) {
          await this.assertFileAvailable(current)
          return toDto(current, true)
        }
        await this.media.activate(transaction, prepared.id)
        if (current !== null) {
          await transaction.purchaseOrderImageDraft.update({ where: { id: current.id }, data: { invalidatedAt: new Date() } })
          await this.releaseAsset(transaction, current.mediaAssetId)
        }
        const created = await transaction.purchaseOrderImageDraft.create({
          data: { purchaseOrderId, mediaAssetId: prepared.id, orderVersion: command.expectedVersion, snapshotHash, templateVersion: PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION, snapshot: snapshot as unknown as Prisma.InputJsonObject, generatedByUserId: context.actorUserId },
          select: DRAFT_SELECT,
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.PURCHASE_ORDER_IMAGE_GENERATED, outcome: AuditOutcome.SUCCESS, actorType: AuditActorType.USER,
          actorUserId: context.actorUserId, requestId: context.requestId, targetType: 'PURCHASE_ORDER_IMAGE_DRAFT', targetId: created.id,
          metadata: { purchaseOrderId, orderVersion: command.expectedVersion },
        })
        usedPrepared = true
        return toDto(created, true)
      })
      if (!usedPrepared) await this.media.fail(prepared.id, 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED')
      return result
    }
    catch (error) {
      // 激活和草稿写入共享事务；失败后prepared仍是UPLOADING，可安全交给现有失败清理机制。
      if (preparedId !== undefined) await this.media.fail(preparedId, 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED').catch(() => undefined)
      return mapGenerationError(error)
    }
  }

  /** 调用方已锁定采购单；先校验并归档预览文件，再由同一事务推进订单及货件状态。 */
  async attachForReview(transaction: Prisma.TransactionClient, context: PurchaseOrderMutationContext, purchaseOrderId: string, expectedVersion: number, rawDraftId: unknown): Promise<void> {
    requirePurchaseOrderImageContext(context)
    if (rawDraftId === undefined || rawDraftId === null) return purchaseOrderRuleFailure('PURCHASE_ORDER_IMAGE_REQUIRED', '请先生成采购单图片再确认审核')
    const draftId = requirePurchaseOrderImageUuid(rawDraftId, 'imageDraftId')
    const detail = await this.query.getById(purchaseOrderId, transaction)
    assertReviewable(detail, expectedVersion)
    assertMarks(detail)
    const draft = await transaction.purchaseOrderImageDraft.findFirst({ where: { id: draftId, purchaseOrderId, ...CURRENT_DRAFT }, select: DRAFT_SELECT })
    if (draft === null) return purchaseOrderRuleFailure('PURCHASE_ORDER_IMAGE_UNAVAILABLE', '采购单图片当前不可用，请重新生成')
    if (!isMatching(draft, detail, hashPurchaseOrderImageSnapshot(createPurchaseOrderImageSnapshot(detail)))) return purchaseOrderRuleFailure('PURCHASE_ORDER_IMAGE_STALE', '采购单图片已过期，请重新生成后审核')
    await this.assertFileAvailable(draft)
    const existing = await transaction.purchaseOrderDocument.findFirst({ where: { purchaseOrderId, documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null }, select: { id: true } })
    if (existing !== null) return purchaseOrderRuleFailure('PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS', '该采购订单已有有效采购单凭证')
    const document = await transaction.purchaseOrderDocument.create({
      data: { purchaseOrderId, mediaAssetId: draft.mediaAssetId, documentType: 'ORDER_ISSUANCE_VOUCHER', paymentId: null, title: '采购单', remark: null, createdByUserId: context.actorUserId }, select: { id: true },
    })
    await transaction.purchaseOrderImageDraft.update({ where: { id: draft.id }, data: { archivedAt: new Date() } })
    await this.audit.record(transaction, {
      eventType: AuditEventType.PURCHASE_ORDER_DOCUMENT_ATTACHED, outcome: AuditOutcome.SUCCESS, actorType: AuditActorType.USER,
      actorUserId: context.actorUserId, requestId: context.requestId, targetType: 'PURCHASE_ORDER_DOCUMENT', targetId: document.id,
      metadata: { purchaseOrderId, documentType: 'ORDER_ISSUANCE_VOUCHER' },
    })
  }

  async invalidateForOrder(transaction: Prisma.TransactionClient, purchaseOrderId: string): Promise<void> {
    const drafts = await transaction.purchaseOrderImageDraft.findMany({ where: { purchaseOrderId, ...CURRENT_DRAFT }, select: { mediaAssetId: true } })
    await transaction.purchaseOrderImageDraft.updateMany({ where: { purchaseOrderId, ...CURRENT_DRAFT }, data: { invalidatedAt: new Date() } })
    for (const draft of drafts) await this.releaseAsset(transaction, draft.mediaAssetId)
  }

  async resolveContent(purchaseOrderId: string, draftId: string, ifNoneMatch: unknown, method: 'GET' | 'HEAD'): Promise<PurchaseOrderDocumentContentResponse> {
    const draft = await this.prisma.purchaseOrderImageDraft.findFirst({
      where: { id: requirePurchaseOrderImageUuid(draftId, 'draftId'), purchaseOrderId: requirePurchaseOrderImageUuid(purchaseOrderId, 'purchaseOrderId'), invalidatedAt: null, mediaAsset: { status: 'READY', deletedAt: null, mimeType: 'image/png' } }, select: DRAFT_SELECT,
    })
    if (draft === null) throw new ApiException(HttpStatus.NOT_FOUND, 'PURCHASE_ORDER_IMAGE_DRAFT_NOT_FOUND', '采购单图片不存在')
    // 审核归档后的旧预览地址仍可读取，同样检查作废状态，避免绕过正式凭证的标记。
    if (draft.purchaseOrder.orderStatus === 'CANCELLED') {
      return deliverCancelledPurchaseOrderImage(this.delivery, draft.mediaAsset, draft.id, ifNoneMatch, method)
    }
    return deliverPurchaseOrderImage(this.delivery, draft.mediaAsset, draft.id, ifNoneMatch, method)
  }

  private async assertFileAvailable(draft: DraftRow): Promise<void> {
    try {
      const objectKey = draft.mediaAsset.objectKey
      if (!isReady(draft) || objectKey === null) throw new Error('unavailable asset')
      const stat = await this.delivery.stat(requireMediaObjectKeyNamespace(objectKey, 'assets'))
      if (stat === null || (draft.mediaAsset.sizeBytes !== null && stat.sizeBytes !== draft.mediaAsset.sizeBytes)) throw new Error('unavailable asset')
    }
    catch {
      return purchaseOrderRuleFailure('PURCHASE_ORDER_IMAGE_UNAVAILABLE', '采购单图片文件当前不可用，请重新生成')
    }
  }

  private async releaseAsset(transaction: Prisma.TransactionClient, mediaAssetId: string): Promise<void> {
    const result = await this.retention.markUnreferencedForTrash(transaction, mediaAssetId)
    if (result !== 'TRASHED' && result !== 'ACTIVE_REFERENCE') return purchaseOrderRuleFailure('PURCHASE_ORDER_IMAGE_UNAVAILABLE', '采购单图片状态已变更，请重试')
  }
}
