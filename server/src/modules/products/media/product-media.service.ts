import { Inject, Injectable, Optional } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  ProductMediaKind,
  type ProductMediaKind as ProductMediaKindValue,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { AuditService } from '../../audit/audit.service'
import {
  MediaAssetService,
  type PreparedMediaAsset,
} from '../../media/media-asset.service'
import type {
  MediaAssetRetentionResult,
} from '../../media/media-retention.service'
import { MediaAssetRetentionService } from '../../media/media-retention.service'
import {
  assertContinuousProductMediaKind,
  currentPrimaryImageId,
  mediaTypeForProductMedia,
  productMediaIdsFor,
  productMediaLimit,
  productMediaSnapshotResult,
  sameOrderedProductMediaIds,
  sameProductMediaIdSet,
  validateProductMediaContext,
  validateProductMediaExpectedVersion,
  validateProductMediaKind,
  validateProductMediaLayoutInput,
  type ProductMediaCommandContext,
  type ProductMediaCommandResult,
  type ProductMediaDetachInput,
  type ProductMediaLayoutInput,
  type ProductMediaUploadInput,
} from './product-media.command'
import {
  mapProductMediaCommandError,
  productMediaInternalError,
  productMediaLayoutChangedError,
  productMediaLimitExceededError,
  productMediaNotFoundError,
  productMediaStorageUnavailableError,
  productStateChangedError,
} from './product-media.errors'
import {
  ProductMediaPersistence,
  type ProductMediaProductLock,
} from './product-media.persistence'
import { PRODUCT_MEDIA_ALLOWED_TYPES } from './product-media.policy'

export type {
  ProductMediaCommandContext,
  ProductMediaCommandResult,
  ProductMediaDetachInput,
  ProductMediaLayoutInput,
  ProductMediaUploadInput,
} from './product-media.command'

interface ProductMediaServiceDependencies {
  readonly now: () => Date
}

const DEFAULT_DEPENDENCIES: ProductMediaServiceDependencies = {
  now: () => new Date(),
}

const PRODUCT_MEDIA_SERVICE_DEPENDENCIES = Symbol(
  'qianshu.product-media.service-dependencies',
)

/**
 * Product 媒体领域服务拥有 Product 锁、版本、数量、排序、主图和审计策略。
 * MediaAsset 只负责物理内容生命周期，不能自行决定 Product 归属。
 */
@Injectable()
export class ProductMediaService {
  private readonly dependencies: ProductMediaServiceDependencies

  constructor(
    private readonly prisma: PrismaService,
    private readonly persistence: ProductMediaPersistence,
    private readonly mediaAsset: MediaAssetService,
    private readonly retention: MediaAssetRetentionService,
    private readonly audit: AuditService,
    // 仅测试可直接传入稳定时钟；生产容器不注册此内部 token 时使用默认实现。
    @Optional()
    @Inject(PRODUCT_MEDIA_SERVICE_DEPENDENCIES)
    dependencyOverrides: Partial<ProductMediaServiceDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  async upload(
    context: ProductMediaCommandContext,
    productId: string,
    input: ProductMediaUploadInput,
  ): Promise<ProductMediaCommandResult> {
    const trusted = validateProductMediaContext(context)
    const kind = validateProductMediaKind(input.kind)
    const expectedVersion = validateProductMediaExpectedVersion(input.expectedVersion)
    let preparedAsset: PreparedMediaAsset | undefined

    try {
      // 快速预检只作早拒绝；文件准备完成后的 Product 行锁和复核才决定最终提交。
      const preflight = await this.persistence.readUploadPreflight(productId, kind)
      if (preflight === null) throw productMediaNotFoundError()
      if (preflight.version !== expectedVersion) throw productStateChangedError()
      if (preflight.mediaCount >= productMediaLimit(kind)) {
        throw productMediaLimitExceededError()
      }

      const prepared = await this.mediaAsset.prepare({
        actorUserId: trusted.actorUserId,
        allowedTypes: PRODUCT_MEDIA_ALLOWED_TYPES,
        declaredMimeType: input.declaredMimeType,
        originalFilename: input.originalFilename,
        pool: 'product',
        requestedType: mediaTypeForProductMedia(kind),
        stream: input.stream,
      })
      preparedAsset = prepared
      if (prepared.mediaType !== mediaTypeForProductMedia(kind)) {
        throw productMediaInternalError()
      }

      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const product = await this.requireLockedProduct(
          transaction,
          productId,
          expectedVersion,
        )
        const current = await this.persistence.readActiveSnapshot(transaction, productId)
        assertContinuousProductMediaKind(current, ProductMediaKind.IMAGE)
        assertContinuousProductMediaKind(current, ProductMediaKind.VIDEO)
        currentPrimaryImageId(current)

        const sameKind = current.filter(item => item.kind === kind)
        if (sameKind.length >= productMediaLimit(kind)) {
          throw productMediaLimitExceededError()
        }
        if (current.some(item => item.mediaAssetId === prepared.id)) {
          throw productStateChangedError()
        }

        // activate 先锁并转 READY；紧随其后的关联让 deferred trigger 在提交时验证非孤立资产。
        await this.mediaAsset.activate(transaction, prepared.id)
        const productMediaId = await this.persistence.createAssociation(transaction, {
          actorUserId: trusted.actorUserId,
          kind,
          mediaAssetId: prepared.id,
          productId,
          sortOrder: sameKind.length,
        })
        await this.bumpAndAudit(transaction, trusted, product, {
          action: 'UPLOAD_MEDIA',
          mediaType: kind,
          productMediaId,
        })
        const updated = await this.persistence.readActiveSnapshot(transaction, productId)
        return productMediaSnapshotResult(
          productId,
          product.version + 1,
          updated,
          true,
          productMediaId,
        )
      })
    }
    catch (error) {
      if (preparedAsset !== undefined) {
        try {
          await this.mediaAsset.fail(
            preparedAsset.id,
            'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
          )
        }
        catch (failureError) {
          return mapProductMediaCommandError(failureError)
        }
      }
      return mapProductMediaCommandError(error)
    }
  }

  async updateLayout(
    context: ProductMediaCommandContext,
    productId: string,
    input: ProductMediaLayoutInput,
  ): Promise<ProductMediaCommandResult> {
    const trusted = validateProductMediaContext(context)
    const layout = validateProductMediaLayoutInput(input)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const product = await this.requireLockedProduct(
          transaction,
          productId,
          layout.expectedVersion,
        )
        const current = await this.persistence.readActiveSnapshot(transaction, productId)
        const currentImageIds = productMediaIdsFor(current, ProductMediaKind.IMAGE)
        const currentVideoIds = productMediaIdsFor(current, ProductMediaKind.VIDEO)
        const primaryImageId = currentPrimaryImageId(current)

        if (
          !sameProductMediaIdSet(layout.imageIds, currentImageIds)
          || !sameProductMediaIdSet(layout.videoIds, currentVideoIds)
        ) {
          throw productMediaLayoutChangedError()
        }
        if (
          sameOrderedProductMediaIds(layout.imageIds, currentImageIds)
          && sameOrderedProductMediaIds(layout.videoIds, currentVideoIds)
          && layout.primaryImageId === primaryImageId
        ) {
          return productMediaSnapshotResult(
            productId,
            product.version,
            current,
            false,
            null,
          )
        }

        await this.persistence.writeCompleteLayout(transaction, {
          imageIds: layout.imageIds,
          items: current,
          primaryImageId: layout.primaryImageId,
          productId,
          videoIds: layout.videoIds,
        })
        await this.bumpAndAudit(transaction, trusted, product, {
          action: 'UPDATE_MEDIA_LAYOUT',
          mediaType: null,
          productMediaId: null,
        })
        const updated = await this.persistence.readActiveSnapshot(transaction, productId)
        return productMediaSnapshotResult(
          productId,
          product.version + 1,
          updated,
          true,
          null,
        )
      })
    }
    catch (error) {
      return mapProductMediaCommandError(error)
    }
  }

  async detach(
    context: ProductMediaCommandContext,
    productId: string,
    productMediaId: string,
    input: ProductMediaDetachInput,
  ): Promise<ProductMediaCommandResult> {
    const trusted = validateProductMediaContext(context)
    const expectedVersion = validateProductMediaExpectedVersion(input.expectedVersion)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const product = await this.requireLockedProduct(
          transaction,
          productId,
          expectedVersion,
        )
        const current = await this.persistence.readActiveSnapshot(transaction, productId)
        const target = current.find(item => item.id === productMediaId)
        if (target === undefined) throw productMediaNotFoundError()

        const detached = await this.persistence.detachAssociation(transaction, {
          actorUserId: trusted.actorUserId,
          detachedAt: this.dependencies.now(),
          productId,
          productMediaId,
        })
        if (!detached) throw productStateChangedError()

        const remaining = current.filter(item => item.id !== productMediaId)
        const previousPrimary = currentPrimaryImageId(current)
        await this.persistence.writeCompleteLayout(transaction, {
          imageIds: productMediaIdsFor(remaining, ProductMediaKind.IMAGE),
          items: remaining,
          primaryImageId: previousPrimary === productMediaId ? null : previousPrimary,
          productId,
          videoIds: productMediaIdsFor(remaining, ProductMediaKind.VIDEO),
        })

        await this.bumpAndAudit(transaction, trusted, product, {
          action: 'DETACH_MEDIA',
          mediaType: target.kind,
          productMediaId,
        })

        // Audit 先在数据库事务中成功，再执行可能移动物理文件的 retention；这样 Audit
        // 失败不会先把仍被回滚关联引用的 READY 文件移动到 trash。调用方仍已持有
        // Product 锁，Retention 接下来锁 MediaAsset，固定 Product -> MediaAsset 顺序。
        const retentionResult = await this.retention.trashIfUnreferenced(
          transaction,
          target.mediaAssetId,
        )
        this.requireSafeRetentionResult(retentionResult)

        const updated = await this.persistence.readActiveSnapshot(transaction, productId)
        return productMediaSnapshotResult(
          productId,
          product.version + 1,
          updated,
          true,
          productMediaId,
        )
      })
    }
    catch (error) {
      return mapProductMediaCommandError(error)
    }
  }

  private async requireLockedProduct(
    transaction: Prisma.TransactionClient,
    productId: string,
    expectedVersion: number,
  ): Promise<ProductMediaProductLock> {
    const product = await this.persistence.lockProduct(transaction, productId)
    if (product === null) throw productMediaNotFoundError()
    if (product.version !== expectedVersion) throw productStateChangedError()
    return product
  }

  private async bumpAndAudit(
    transaction: Prisma.TransactionClient,
    context: ProductMediaCommandContext,
    product: ProductMediaProductLock,
    change: {
      readonly action: 'DETACH_MEDIA' | 'UPDATE_MEDIA_LAYOUT' | 'UPLOAD_MEDIA'
      readonly mediaType: ProductMediaKindValue | null
      readonly productMediaId: string | null
    },
  ): Promise<void> {
    const bumped = await this.persistence.bumpProductVersion(transaction, {
      actorUserId: context.actorUserId,
      expectedVersion: product.version,
      productId: product.id,
    })
    if (!bumped) throw productStateChangedError()

    await this.audit.record(transaction, {
      actorType: AuditActorType.USER,
      actorUserId: context.actorUserId,
      eventType: AuditEventType.PRODUCT_UPDATED,
      metadata: {
        action: change.action,
        changedFields: 'media',
        mediaType: change.mediaType,
        previousStatus: product.status,
        previousVersion: product.version,
        productMediaId: change.productMediaId,
        productNo: product.productNo,
        status: product.status,
        version: product.version + 1,
      },
      outcome: AuditOutcome.SUCCESS,
      requestId: context.requestId,
      targetId: product.id,
      targetType: 'PRODUCT',
    })
  }

  private requireSafeRetentionResult(result: MediaAssetRetentionResult): void {
    if (result === 'TRASHED' || result === 'ACTIVE_REFERENCE') return
    if (result === 'ISOLATED') throw productMediaStorageUnavailableError()
    if (result === 'STATE_CONFLICT' || result === 'NOT_ELIGIBLE') {
      throw productStateChangedError()
    }
    throw productMediaInternalError()
  }
}
