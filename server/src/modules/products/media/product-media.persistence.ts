import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import type {
  ProductMediaKind as ProductMediaKindValue,
  ProductStatus as ProductStatusValue,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'

export interface ProductMediaUploadPreflight {
  readonly mediaCount: number
  readonly version: number
}

export interface ProductMediaProductLock {
  readonly id: string
  readonly productNo: string
  readonly status: ProductStatusValue
  readonly version: number
}

export interface ProductMediaSnapshotItem {
  readonly id: string
  readonly mediaAssetId: string
  readonly kind: ProductMediaKindValue
  readonly sortOrder: number
  readonly isPrimary: boolean
}

export class ProductMediaPersistenceStateError extends Error {
  readonly code = 'PRODUCT_MEDIA_PERSISTENCE_STATE_CHANGED'

  constructor() {
    super('Product media persistence state changed')
    this.name = 'ProductMediaPersistenceStateError'
  }
}

/**
 * ProductMedia 的 SQL/Prisma 写集中在同一 persistence。这里不解释业务错误，
 * 只确保每个条件写命中预期行数，避免绕过 Product 行锁后的状态漂移被静默吞掉。
 */
@Injectable()
export class ProductMediaPersistence {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 上传前只执行一条普通 SELECT，同时取得版本和同类型数量。查询不使用事务行锁，
   * 因而文件 streaming/validation 的长耗时不会阻塞其他 Product 写操作。
   */
  async readUploadPreflight(
    productId: string,
    kind: ProductMediaKindValue,
  ): Promise<ProductMediaUploadPreflight | null> {
    const rows = await this.prisma.$queryRaw<ProductMediaUploadPreflight[]>(Prisma.sql`
      SELECT
        product."version",
        (
          SELECT count(*)::integer
          FROM "product_media" AS media
          WHERE media."product_id" = product."id"
            AND media."kind" = CAST(${kind} AS "product_media_kind")
            AND media."detached_at" IS NULL
        ) AS "mediaCount"
      FROM "products" AS product
      WHERE product."id" = CAST(${productId} AS uuid)
    `)
    return rows[0] ?? null
  }

  /** Product 行锁是所有媒体写事务的首个业务锁，也是 expectedVersion 的最终真相源。 */
  async lockProduct(
    transaction: Prisma.TransactionClient,
    productId: string,
  ): Promise<ProductMediaProductLock | null> {
    const rows = await transaction.$queryRaw<ProductMediaProductLock[]>(Prisma.sql`
      SELECT
        "id",
        "product_no" AS "productNo",
        "status",
        "version"
      FROM "products"
      WHERE "id" = CAST(${productId} AS uuid)
      FOR UPDATE
    `)
    return rows[0] ?? null
  }

  readActiveSnapshot(
    transaction: Prisma.TransactionClient,
    productId: string,
  ): Promise<ProductMediaSnapshotItem[]> {
    return transaction.productMedia.findMany({
      where: { productId, detachedAt: null },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        mediaAssetId: true,
        kind: true,
        sortOrder: true,
        isPrimary: true,
      },
    })
  }

  async createAssociation(
    transaction: Prisma.TransactionClient,
    input: {
      readonly actorUserId: string
      readonly kind: ProductMediaKindValue
      readonly mediaAssetId: string
      readonly productId: string
      readonly sortOrder: number
    },
  ): Promise<string> {
    const created = await transaction.productMedia.create({
      data: {
        createdByUserId: input.actorUserId,
        isPrimary: false,
        kind: input.kind,
        mediaAssetId: input.mediaAssetId,
        productId: input.productId,
        sortOrder: input.sortOrder,
      },
      select: { id: true },
    })
    return created.id
  }

  /**
   * partial unique 会逐行检查排序和主图，因此不能直接把 0/1 交换。先一次性把所有
   * 有效行移入大于目标最大值的安全区并清空主图，再按完整快照写回连续顺序。
   */
  async writeCompleteLayout(
    transaction: Prisma.TransactionClient,
    input: {
      readonly imageIds: readonly string[]
      readonly items: readonly ProductMediaSnapshotItem[]
      readonly primaryImageId: string | null
      readonly productId: string
      readonly videoIds: readonly string[]
    },
  ): Promise<void> {
    const shifted = await transaction.productMedia.updateMany({
      where: { productId: input.productId, detachedAt: null },
      data: {
        isPrimary: false,
        // 有效 sortOrder 非负；items.length + 1 可保证临时值全部高于最终 0..n-1。
        sortOrder: { increment: input.items.length + 1 },
      },
    })
    if (shifted.count !== input.items.length) {
      throw new ProductMediaPersistenceStateError()
    }

    await this.writeKindLayout(
      transaction,
      input.productId,
      'IMAGE',
      input.imageIds,
      input.primaryImageId,
    )
    await this.writeKindLayout(
      transaction,
      input.productId,
      'VIDEO',
      input.videoIds,
      null,
    )
  }

  async detachAssociation(
    transaction: Prisma.TransactionClient,
    input: {
      readonly actorUserId: string
      readonly detachedAt: Date
      readonly productId: string
      readonly productMediaId: string
    },
  ): Promise<boolean> {
    const detached = await transaction.productMedia.updateMany({
      where: {
        id: input.productMediaId,
        productId: input.productId,
        detachedAt: null,
      },
      data: {
        detachedAt: input.detachedAt,
        detachedByUserId: input.actorUserId,
      },
    })
    return detached.count === 1
  }

  async bumpProductVersion(
    transaction: Prisma.TransactionClient,
    input: {
      readonly actorUserId: string
      readonly expectedVersion: number
      readonly productId: string
    },
  ): Promise<boolean> {
    const updated = await transaction.product.updateMany({
      where: { id: input.productId, version: input.expectedVersion },
      data: {
        updatedByUserId: input.actorUserId,
        version: { increment: 1 },
      },
    })
    return updated.count === 1
  }

  private async writeKindLayout(
    transaction: Prisma.TransactionClient,
    productId: string,
    kind: ProductMediaKindValue,
    ids: readonly string[],
    primaryImageId: string | null,
  ): Promise<void> {
    for (const [sortOrder, id] of ids.entries()) {
      const updated = await transaction.productMedia.updateMany({
        where: { id, productId, detachedAt: null, kind },
        data: {
          isPrimary: kind === 'IMAGE' && id === primaryImageId,
          sortOrder,
        },
      })
      if (updated.count !== 1) {
        throw new ProductMediaPersistenceStateError()
      }
    }
  }
}
